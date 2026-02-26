import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

import { DEFAULT_PRODUCTS } from './seedProducts';
import { MENU_PRICES_BY_SLUG } from './menuPrices';
import {
  AuditReport,
  CartItem,
  ClosureRecord,
  ClosureSnapshot,
  CreatePrintJobInput,
  DailyStats,
  LegalClosureArchive,
  LegalArchiveVerification,
  OrderToSave,
  OrderType,
  PrintJobRecord,
  PrintJobStatus,
  PrinterSettings,
  Product,
  ProductCategory,
  SaveOrderResult,
  StoredTicket,
  TaxBreakdownLine,
  UploadedProduct,
} from '../types';

const dbPromise = SQLite.openDatabaseAsync('pos_local.db');

const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  printMode: 'network_dual',
  cashPrinterUrl: '',
  kitchenPrinterUrl: '',
  usbPrinterId: '',
  usbPrinterName: '',
  serviceTicketEnabled: true,
  nightSurchargePercent: 0,
};

const ensureMenuPriceColumn = async (db: SQLite.SQLiteDatabase) => {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('products')");
  const hasMenuPrice = columns.some((col) => col.name === 'menu_price');

  if (!hasMenuPrice) {
    await db.execAsync('ALTER TABLE products ADD COLUMN menu_price REAL');
  }
};

const ensureMenuSupplementColumn = async (db: SQLite.SQLiteDatabase) => {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('products')");
  const hasMenuSupplement = columns.some((col) => col.name === 'menu_supplement');

  if (!hasMenuSupplement) {
    await db.execAsync('ALTER TABLE products ADD COLUMN menu_supplement REAL');
  }
};

const ensureSendToSalleColumn = async (db: SQLite.SQLiteDatabase) => {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('products')");
  const hasSendToSalle = columns.some((col) => col.name === 'send_to_salle');

  if (!hasSendToSalle) {
    await db.execAsync('ALTER TABLE products ADD COLUMN send_to_salle INTEGER NOT NULL DEFAULT 1');
  }
};

const ensureCashTicketTextColumn = async (db: SQLite.SQLiteDatabase) => {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('orders')");
  const hasCashTicketText = columns.some((col) => col.name === 'cash_ticket_text');

  if (!hasCashTicketText) {
    await db.execAsync('ALTER TABLE orders ADD COLUMN cash_ticket_text TEXT');
  }
};

const ensureKitchenTicketTextColumn = async (db: SQLite.SQLiteDatabase) => {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('orders')");
  const hasKitchenTicketText = columns.some((col) => col.name === 'kitchen_ticket_text');

  if (!hasKitchenTicketText) {
    await db.execAsync('ALTER TABLE orders ADD COLUMN kitchen_ticket_text TEXT');
  }
};

const ensureOrderColumn = async (db: SQLite.SQLiteDatabase, columnName: string, columnSql: string) => {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('orders')");
  const hasColumn = columns.some((col) => col.name === columnName);

  if (!hasColumn) {
    await db.execAsync(`ALTER TABLE orders ADD COLUMN ${columnSql}`);
  }
};

const peekNextTicketNumber = async (db: SQLite.SQLiteDatabase) => {
  const row = await db.getFirstAsync<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'order_sequence'`);
  const current = Number(row?.value ?? '0');
  return Number.isFinite(current) ? current + 1 : 1;
};

const setOrderSequenceAtLeast = async (db: SQLite.SQLiteDatabase, value: number) => {
  const safeValue = Math.max(0, Math.floor(value));
  await db.runAsync(
    `
      INSERT INTO app_settings (key, value)
      VALUES ('order_sequence', ?)
      ON CONFLICT(key) DO UPDATE SET value =
        CASE
          WHEN CAST(app_settings.value AS INTEGER) < excluded.value THEN excluded.value
          ELSE app_settings.value
        END
    `,
    [String(safeValue)],
  );
};

export const reserveNextTicketNumber = async (): Promise<number> => {
  const db = await dbPromise;
  await db.execAsync('BEGIN IMMEDIATE TRANSACTION');
  try {
    const next = await peekNextTicketNumber(db);
    await setOrderSequenceAtLeast(db, next);
    await db.execAsync('COMMIT');
    return next;
  } catch (error) {
    try {
      await db.execAsync('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw error;
  }
};

const buildOrderHash = async (payload: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload);

const Z_LAST_CLOSED_AT_KEY = 'z_last_closed_at';

const getCurrentPeriodStart = async (db: SQLite.SQLiteDatabase) => {
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = ?`,
    [Z_LAST_CLOSED_AT_KEY],
  );
  return row?.value || '1970-01-01T00:00:00.000Z';
};

// ── TVA computation helpers ──────────────────────────────────────────────
const SNAPSHOT_TAX_RATE_SUR_PLACE: Record<string, number> = {
  burgers: 0.1, snacks: 0.1, desserts: 0.1,
  boissons: 0.1, accompagnements: 0.1, sauces: 0.1,
};
const SNAPSHOT_TAX_RATE_A_EMPORTER: Record<string, number> = {
  burgers: 0.1, snacks: 0.1, desserts: 0.1,
  boissons: 0.055, accompagnements: 0.1, sauces: 0.1,
};
const snapshotTaxRate = (cat: string, ot: string) =>
  (ot === 'a_emporter' ? SNAPSHOT_TAX_RATE_A_EMPORTER : SNAPSHOT_TAX_RATE_SUR_PLACE)[cat] ?? 0.1;

const computeTaxBreakdownFromItems = (
  items: CartItem[],
  orderType: string,
): { rate: number; ht: number; tva: number; ttc: number }[] => {
  const allocations: { rate: number; ttc: number }[] = [];
  for (const line of items) {
    if (line.kind === 'menu' && line.menuItems?.length) {
      const menuItems = line.menuItems;
      const baseParts = menuItems.map((mi) => Math.max(mi.product.price, 0));
      const baseSum = baseParts.reduce((acc, v) => acc + v, 0);
      const divisor = baseSum > 0 ? baseSum : menuItems.length || 1;
      menuItems.forEach((mi, idx) => {
        const share = divisor ? baseParts[idx] / divisor : 1 / menuItems.length;
        const rate = snapshotTaxRate(mi.product.category, orderType);
        const ttc = line.product.price * line.quantity * share;
        allocations.push({ rate, ttc });
      });
    } else {
      const rate = snapshotTaxRate(line.product.category, orderType);
      allocations.push({ rate, ttc: line.product.price * line.quantity });
    }
  }
  const map = new Map<number, { ht: number; tva: number; ttc: number }>();
  for (const a of allocations) {
    const ht = a.ttc / (1 + a.rate);
    const tva = a.ttc - ht;
    const existing = map.get(a.rate) ?? { ht: 0, tva: 0, ttc: 0 };
    existing.ht += ht;
    existing.tva += tva;
    existing.ttc += a.ttc;
    map.set(a.rate, existing);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([rate, v]) => ({
      rate,
      ht: Number(v.ht.toFixed(2)),
      tva: Number(v.tva.toFixed(2)),
      ttc: Number(v.ttc.toFixed(2)),
    }));
};

const buildSnapshotBetween = async (
  db: SQLite.SQLiteDatabase,
  periodStart: string,
  periodEnd: string,
): Promise<ClosureSnapshot> => {
  const rows = await db.getAllAsync<{
    ticket_number: number | null;
    total: number;
    payment_method: string;
    items_json: string;
    order_type: string;
  }>(
    `
      SELECT ticket_number, total, payment_method, items_json, order_type
      FROM orders
      WHERE datetime(created_at) >= datetime(?)
        AND datetime(created_at) < datetime(?)
      ORDER BY COALESCE(ticket_number, id)
    `,
    [periodStart, periodEnd],
  );

  const paymentBreakdown: Record<string, number> = {};
  let revenue = 0;
  let lastTicketNumber = 0;

  // Aggregate TVA across all orders
  const globalTaxMap = new Map<number, { ht: number; tva: number; ttc: number }>();

  rows.forEach((row) => {
    const amount = Number(row.total ?? 0);
    revenue += amount;
    const method = row.payment_method || 'non_precise';
    paymentBreakdown[method] = Number(((paymentBreakdown[method] ?? 0) + amount).toFixed(2));
    lastTicketNumber = Math.max(lastTicketNumber, Number(row.ticket_number ?? 0));

    // Compute per-order TVA
    try {
      const items: CartItem[] = JSON.parse(row.items_json || '[]');
      const orderType = row.order_type || 'sur_place';
      const breakdown = computeTaxBreakdownFromItems(items, orderType);
      for (const line of breakdown) {
        const existing = globalTaxMap.get(line.rate) ?? { ht: 0, tva: 0, ttc: 0 };
        existing.ht += line.ht;
        existing.tva += line.tva;
        existing.ttc += line.ttc;
        globalTaxMap.set(line.rate, existing);
      }
    } catch {
      // silently skip malformed items_json
    }
  });

  const taxBreakdown: TaxBreakdownLine[] = Array.from(globalTaxMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([rate, v]) => ({
      rate,
      ht: Number(v.ht.toFixed(2)),
      tva: Number(v.tva.toFixed(2)),
      ttc: Number(v.ttc.toFixed(2)),
    }));

  return {
    periodStart,
    periodEnd,
    ordersCount: rows.length,
    revenue: Number(revenue.toFixed(2)),
    paymentBreakdown,
    lastTicketNumber,
    taxBreakdown,
  };
};

const getSeedMenuPrice = (slug: string, fallback?: number | null) => {
  const mapped = MENU_PRICES_BY_SLUG[slug];
  if (typeof mapped === 'number') {
    return mapped;
  }

  if (typeof fallback === 'number') {
    return fallback;
  }

  return null;
};

export const initDatabase = async () => {
  const db = await dbPromise;

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number INTEGER UNIQUE,
      created_at TEXT NOT NULL,
      user_role TEXT NOT NULL,
      user_name TEXT NOT NULL,
      items_json TEXT NOT NULL,
      subtotal REAL NOT NULL,
      discount_amount REAL NOT NULL,
      tax_amount REAL NOT NULL,
      total REAL NOT NULL,
      payment_method TEXT NOT NULL,
      order_status TEXT NOT NULL DEFAULT 'sale',
      status_reason TEXT,
      original_order_id INTEGER,
      is_copy INTEGER NOT NULL DEFAULT 0,
      previous_hash TEXT,
      entry_hash TEXT,
      table_label TEXT,
      note TEXT,
      cash_ticket_text TEXT,
      kitchen_ticket_text TEXT
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      category TEXT NOT NULL,
      send_to_kitchen INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      image_key TEXT,
      menu_price REAL
    );

    CREATE TABLE IF NOT EXISTS closures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      closed_at TEXT NOT NULL,
      closed_by TEXT NOT NULL,
      orders_count INTEGER NOT NULL,
      revenue REAL NOT NULL,
      payment_breakdown_json TEXT NOT NULL,
      last_ticket_number INTEGER NOT NULL,
      previous_signature_hash TEXT,
      signature_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS print_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      order_id INTEGER,
      ticket_number INTEGER,
      channel TEXT NOT NULL,
      printer_url TEXT NOT NULL,
      request_xml TEXT NOT NULL,
      ticket_text TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      last_error TEXT,
      last_attempt_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_print_jobs_order ON print_jobs(order_id);
  `);

  await ensureMenuPriceColumn(db);
  await ensureMenuSupplementColumn(db);
  await ensureCashTicketTextColumn(db);
  await ensureKitchenTicketTextColumn(db);
  await ensureOrderColumn(db, 'ticket_number', 'ticket_number INTEGER');
  await ensureOrderColumn(db, 'order_status', "order_status TEXT NOT NULL DEFAULT 'sale'");
  await ensureOrderColumn(db, 'status_reason', 'status_reason TEXT');
  await ensureOrderColumn(db, 'original_order_id', 'original_order_id INTEGER');
  await ensureOrderColumn(db, 'is_copy', 'is_copy INTEGER NOT NULL DEFAULT 0');
  await ensureOrderColumn(db, 'previous_hash', 'previous_hash TEXT');
  await ensureOrderColumn(db, 'entry_hash', 'entry_hash TEXT');
  await ensureOrderColumn(db, 'order_type', "order_type TEXT NOT NULL DEFAULT 'sur_place'");
  await ensureSendToSalleColumn(db);

  await db.runAsync(
    `
      UPDATE orders
      SET ticket_number = id
      WHERE ticket_number IS NULL
    `,
  );

  const maxTicket = await db.getFirstAsync<{ maxTicket: number }>(
    `SELECT COALESCE(MAX(ticket_number), 0) AS maxTicket FROM orders`,
  );
  await setOrderSequenceAtLeast(db, Number(maxTicket?.maxTicket ?? 0));

  await db.runAsync(
    `
      INSERT INTO app_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO NOTHING
    `,
    [Z_LAST_CLOSED_AT_KEY, '1970-01-01T00:00:00.000Z'],
  );

  const productCount = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM products');
  if (!productCount?.count) {
    // First time: insert all seed products
    for (const product of DEFAULT_PRODUCTS) {
      const seedMenuPrice = getSeedMenuPrice(product.slug, product.menuPrice ?? null);
      await db.runAsync(
        `
          INSERT INTO products (
            slug,
            name,
            price,
            category,
            send_to_kitchen,
            send_to_salle,
            active,
            image_key,
            menu_price,
            menu_supplement
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          product.slug,
          product.name,
          product.price,
          product.category,
          product.sendToKitchen ? 1 : 0,
          (product.sendToSalle ?? true) ? 1 : 0,
          product.active ? 1 : 0,
          product.imageKey ?? '',
          seedMenuPrice,
          product.menuSupplement ?? null,
        ],
      );
    }
  } else {
    // DB already has products — insert any missing seed products and sync categories
    for (const product of DEFAULT_PRODUCTS) {
      const existing = await db.getFirstAsync<{ id: number }>(
        `SELECT id FROM products WHERE slug = ?`,
        [product.slug],
      );
      if (!existing) {
        const seedMenuPrice = getSeedMenuPrice(product.slug, product.menuPrice ?? null);
        await db.runAsync(
          `
            INSERT INTO products (
              slug,
              name,
              price,
              category,
              send_to_kitchen,
              send_to_salle,
              active,
              image_key,
              menu_price,
              menu_supplement
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            product.slug,
            product.name,
            product.price,
            product.category,
            product.sendToKitchen ? 1 : 0,
            (product.sendToSalle ?? true) ? 1 : 0,
            product.active ? 1 : 0,
            product.imageKey ?? '',
            seedMenuPrice,
            product.menuSupplement ?? null,
          ],
        );
      } else {
        // Sync category in case it changed (e.g. agnel_chicken moved to burgers)
        await db.runAsync(
          `UPDATE products SET category = ? WHERE slug = ?`,
          [product.category, product.slug],
        );
      }
    }
  }

  for (const [slug, price] of Object.entries(MENU_PRICES_BY_SLUG)) {
    await db.runAsync(`UPDATE products SET menu_price = ? WHERE slug = ?`, [price, slug]);
  }

  // Sync menu_supplement from seed data
  for (const product of DEFAULT_PRODUCTS) {
    if (product.menuSupplement !== undefined) {
      await db.runAsync(
        `UPDATE products SET menu_supplement = ? WHERE slug = ?`,
        [product.menuSupplement, product.slug],
      );
    }
  }
};

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'article';

const normalizeCategory = (category: string): ProductCategory => {
  const normalized = category.toLowerCase();
  if (normalized === 'boissons') return 'boissons';
  if (normalized === 'desserts') return 'desserts';
  if (normalized === 'snacks') return 'snacks';
  if (normalized === 'accompagnements') return 'accompagnements';
  if (normalized === 'sauces') return 'sauces';
  return 'burgers';
};

const mapProductRow = (row: {
  id: number;
  slug: string;
  name: string;
  price: number;
  category: string;
  send_to_kitchen: number;
  send_to_salle: number | null;
  active: number;
  image_key: string | null;
  menu_price: number | null;
  menu_supplement: number | null;
}) => ({
  id: String(row.id),
  slug: row.slug,
  name: row.name,
  price: Number(row.price),
  menuPrice: typeof row.menu_price === 'number' ? Number(row.menu_price) : undefined,
  menuSupplement: typeof row.menu_supplement === 'number' ? Number(row.menu_supplement) : undefined,
  category: normalizeCategory(row.category),
  sendToKitchen: row.send_to_kitchen === 1,
  sendToSalle: row.send_to_salle !== 0,
  active: row.active === 1,
  imageKey: row.image_key || '',
});

const parseItemsJson = (itemsJson: string) => {
  try {
    const parsed = JSON.parse(itemsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parsePaymentBreakdownJson = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {} as Record<string, number>;
    }

    return Object.entries(parsed as Record<string, unknown>).reduce(
      (acc, [key, amount]) => {
        acc[key] = Number(amount ?? 0);
        return acc;
      },
      {} as Record<string, number>,
    );
  } catch {
    return {} as Record<string, number>;
  }
};

export const getProducts = async (includeInactive = false): Promise<Product[]> => {
  const db = await dbPromise;

  const rows = await db.getAllAsync<{
    id: number;
    slug: string;
    name: string;
    price: number;
    category: string;
    send_to_kitchen: number;
    send_to_salle: number | null;
    active: number;
    image_key: string | null;
    menu_price: number | null;
    menu_supplement: number | null;
  }>(
    includeInactive
      ? `SELECT id, slug, name, price, category, send_to_kitchen, send_to_salle, active, image_key, menu_price, menu_supplement FROM products ORDER BY category, name`
      : `SELECT id, slug, name, price, category, send_to_kitchen, send_to_salle, active, image_key, menu_price, menu_supplement FROM products WHERE active = 1 ORDER BY category, name`,
  );

  return rows.map(mapProductRow);
};

export const setProductActive = async (productId: string, active: boolean) => {
  const db = await dbPromise;
  await db.runAsync(`UPDATE products SET active = ? WHERE id = ?`, [active ? 1 : 0, Number(productId)]);
};

export const setCategoryKitchen = async (category: string, sendToKitchen: boolean) => {
  const db = await dbPromise;
  await db.runAsync(`UPDATE products SET send_to_kitchen = ? WHERE category = ?`, [sendToKitchen ? 1 : 0, category]);
};

export const setCategorySalle = async (category: string, sendToSalle: boolean) => {
  const db = await dbPromise;
  await db.runAsync(`UPDATE products SET send_to_salle = ? WHERE category = ?`, [sendToSalle ? 1 : 0, category]);
};

export const setProductKitchen = async (productId: string, sendToKitchen: boolean) => {
  const db = await dbPromise;
  await db.runAsync(`UPDATE products SET send_to_kitchen = ? WHERE id = ?`, [sendToKitchen ? 1 : 0, Number(productId)]);
};

export const setProductSalle = async (productId: string, sendToSalle: boolean) => {
  const db = await dbPromise;
  await db.runAsync(`UPDATE products SET send_to_salle = ? WHERE id = ?`, [sendToSalle ? 1 : 0, Number(productId)]);
};

export const createProduct = async (product: {
  name: string;
  price: number;
  menuPrice?: number;
  menuSupplement?: number;
  category: ProductCategory;
  sendToKitchen: boolean;
  sendToSalle?: boolean;
  active: boolean;
  imageKey?: string;
}): Promise<Product> => {
  const db = await dbPromise;
  const name = product.name.trim();
  const category = normalizeCategory(product.category);
  const slugBase = slugify(name);
  let slug = slugBase;
  let index = 2;

  let loopCount = 0;
  const LOOP_LIMIT = 100;
  while (true) {
    if (loopCount++ > LOOP_LIMIT) {
      throw new Error('Erreur: boucle infinie lors de la génération du slug produit. Vérifiez la base de données.');
    }
    const existing = await db.getFirstAsync<{ id: number }>(`SELECT id FROM products WHERE slug = ?`, [slug]);
    if (!existing) break;
    slug = `${slugBase}_${index}`;
    index += 1;
  }

  const result = await db.runAsync(
    `INSERT INTO products (slug, name, price, category, send_to_kitchen, send_to_salle, active, image_key, menu_price, menu_supplement)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      slug,
      name,
      product.price,
      category,
      product.sendToKitchen ? 1 : 0,
      (product.sendToSalle ?? true) ? 1 : 0,
      product.active ? 1 : 0,
      product.imageKey?.trim() ?? '',
      product.menuPrice ?? null,
      product.menuSupplement ?? null,
    ],
  );

  return {
    id: String(result.lastInsertRowId),
    slug,
    name,
    price: product.price,
    menuPrice: product.menuPrice,
    menuSupplement: product.menuSupplement,
    category,
    sendToKitchen: product.sendToKitchen,
    sendToSalle: product.sendToSalle ?? true,
    active: product.active,
    imageKey: product.imageKey?.trim() ?? '',
  };
};

export const updateProduct = async (
  productId: string,
  product: {
    name: string;
    price: number;
    menuPrice?: number;
    menuSupplement?: number;
    category: ProductCategory;
    sendToKitchen: boolean;
    sendToSalle?: boolean;
    active: boolean;
    imageKey?: string;
  },
): Promise<void> => {
  const db = await dbPromise;
  const category = normalizeCategory(product.category);

  await db.runAsync(
    `UPDATE products
     SET name = ?, price = ?, category = ?, send_to_kitchen = ?, send_to_salle = ?, active = ?,
         image_key = ?, menu_price = ?, menu_supplement = ?
     WHERE id = ?`,
    [
      product.name.trim(),
      product.price,
      category,
      product.sendToKitchen ? 1 : 0,
      (product.sendToSalle ?? true) ? 1 : 0,
      product.active ? 1 : 0,
      product.imageKey?.trim() ?? '',
      product.menuPrice ?? null,
      product.menuSupplement ?? null,
      Number(productId),
    ],
  );
};

export const deleteProduct = async (productId: string): Promise<void> => {
  const db = await dbPromise;
  await db.runAsync(`DELETE FROM products WHERE id = ?`, [Number(productId)]);
};

export const upsertUploadedProducts = async (products: UploadedProduct[]) => {
  const db = await dbPromise;

  for (const item of products) {
    const name = item.name.trim();
    if (!name || !Number.isFinite(item.price)) {
      continue;
    }

    const category = normalizeCategory(item.category);
    const sendToKitchen =
      typeof item.sendToKitchen === 'boolean' ? item.sendToKitchen : category !== 'boissons' && category !== 'desserts';
    const sendToSalle = typeof item.sendToSalle === 'boolean' ? item.sendToSalle : true;
    const active = typeof item.active === 'boolean' ? item.active : true;
    const imageKey = item.imageKey?.trim() ?? '';

    const slugBase = slugify(name);
    let slug = slugBase;
    let index = 2;

    let loopCount = 0;
    const LOOP_LIMIT = 100;
    while (true) {
      if (loopCount++ > LOOP_LIMIT) {
        throw new Error('Erreur: boucle infinie lors de la génération du slug produit (import). Vérifiez la base de données.');
      }
      const existingBySlug = await db.getFirstAsync<{ id: number; name: string }>(
        `SELECT id, name FROM products WHERE slug = ?`,
        [slug],
      );

      if (!existingBySlug || existingBySlug.name === name) {
        break;
      }

      slug = `${slugBase}_${index}`;
      index += 1;
    }

    const existingByName = await db.getFirstAsync<{ id: number }>(`SELECT id FROM products WHERE name = ?`, [name]);

    if (existingByName) {
      await db.runAsync(
        `
          UPDATE products
          SET price = ?,
              category = ?,
              send_to_kitchen = ?,
              send_to_salle = ?,
              active = ?,
              image_key = ?,
              menu_price = ?
          WHERE id = ?
        `,
        [item.price, category, sendToKitchen ? 1 : 0, sendToSalle ? 1 : 0, active ? 1 : 0, imageKey, item.menuPrice ?? null, existingByName.id],
      );
      continue;
    }

    await db.runAsync(
      `
        INSERT INTO products (slug, name, price, category, send_to_kitchen, send_to_salle, active, image_key, menu_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [slug, name, item.price, category, sendToKitchen ? 1 : 0, sendToSalle ? 1 : 0, active ? 1 : 0, imageKey, item.menuPrice ?? null],
    );
  }
};

export const saveOrder = async (order: OrderToSave): Promise<SaveOrderResult> => {
  const db = await dbPromise;
  const createdAt = new Date().toISOString();
  const orderStatus = order.orderStatus ?? 'sale';
  const statusReason = order.statusReason?.trim() || null;

  if ((orderStatus === 'cancel' || orderStatus === 'refund') && !statusReason) {
    throw new Error('Motif obligatoire pour annulation/avoir.');
  }

  const hasReservedTicket =
    typeof order.ticketNumber === 'number' &&
    Number.isFinite(order.ticketNumber) &&
    order.ticketNumber > 0 &&
    Number.isInteger(order.ticketNumber);
  const initialTicketNumber = hasReservedTicket ? Number(order.ticketNumber) : await peekNextTicketNumber(db);

  const insertWithTicketNumber = async (ticketNumber: number): Promise<SaveOrderResult> => {
    const previousHashRow = await db.getFirstAsync<{ entry_hash: string | null }>(
      `SELECT entry_hash FROM orders WHERE entry_hash IS NOT NULL ORDER BY ticket_number DESC LIMIT 1`,
    );
    const previousHash = previousHashRow?.entry_hash ?? 'GENESIS';

    const hashPayload = JSON.stringify({
      ticketNumber,
      createdAt,
      userRole: order.userRole,
      userName: order.userName,
      itemsJson: JSON.stringify(order.items),
      subtotal: order.subtotal,
      discountAmount: order.discountAmount,
      taxAmount: order.taxAmount,
      total: order.total,
      paymentMethod: order.paymentMethod,
      orderStatus,
      statusReason,
      originalOrderId: order.originalOrderId ?? null,
      isCopy: order.isCopy ? 1 : 0,
      tableLabel: order.tableLabel,
      note: order.note,
      orderType: order.orderType ?? 'sur_place',
      cashTicketText: order.cashTicketText ?? null,
      kitchenTicketText: order.kitchenTicketText ?? null,
    });
    const entryHash = await buildOrderHash(`${previousHash}|${hashPayload}`);

    const insertResult = await db.runAsync(
      `
        INSERT INTO orders (
          ticket_number,
          created_at,
          user_role,
          user_name,
          items_json,
          subtotal,
          discount_amount,
          tax_amount,
          total,
          payment_method,
          order_status,
          status_reason,
          original_order_id,
          is_copy,
          previous_hash,
          entry_hash,
          table_label,
          note,
          order_type,
          cash_ticket_text,
          kitchen_ticket_text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        ticketNumber,
        createdAt,
        order.userRole,
        order.userName,
        JSON.stringify(order.items),
        order.subtotal,
        order.discountAmount,
        order.taxAmount,
        order.total,
        order.paymentMethod,
        orderStatus,
        statusReason,
        order.originalOrderId ?? null,
        order.isCopy ? 1 : 0,
        previousHash,
        entryHash,
        order.tableLabel,
        order.note,
        order.orderType ?? 'sur_place',
        order.cashTicketText ?? null,
        order.kitchenTicketText ?? null,
      ],
    );
    await setOrderSequenceAtLeast(db, ticketNumber);

    return {
      id: Number(insertResult.lastInsertRowId ?? 0),
      ticketNumber,
    };
  };

  let ticketNumber = initialTicketNumber;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await insertWithTicketNumber(ticketNumber);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      const ticketConflict = message.includes('orders.ticket_number');
      if (!ticketConflict || attempt === 2) {
        throw error;
      }
      ticketNumber = await peekNextTicketNumber(db);
    }
  }

  throw new Error('Impossible de sauvegarder la commande.');
};

const normalizePrintJobStatus = (value: string): PrintJobStatus => {
  if (value === 'processing' || value === 'printed' || value === 'failed') {
    return value;
  }
  return 'pending';
};

export const createPrintJob = async (input: CreatePrintJobInput): Promise<number> => {
  const db = await dbPromise;
  const now = new Date().toISOString();
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM print_jobs WHERE idempotency_key = ? LIMIT 1`,
    [input.idempotencyKey],
  );
  if (existing?.id) {
    return Number(existing.id);
  }

  const insertResult = await db.runAsync(
    `
      INSERT INTO print_jobs (
        created_at,
        updated_at,
        order_id,
        ticket_number,
        channel,
        printer_url,
        request_xml,
        ticket_text,
        idempotency_key,
        status,
        attempt_count,
        max_attempts,
        last_error,
        last_attempt_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL)
    `,
    [
      now,
      now,
      input.orderId ?? null,
      input.ticketNumber ?? null,
      input.channel,
      input.printerUrl.trim(),
      input.requestXml,
      input.ticketText ?? null,
      input.idempotencyKey,
      Math.max(1, Math.floor(input.maxAttempts ?? 3)),
    ],
  );
  return Number(insertResult.lastInsertRowId ?? 0);
};

export const getPendingPrintJobs = async (limit = 30): Promise<PrintJobRecord[]> => {
  const db = await dbPromise;
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await db.getAllAsync<{
    id: number;
    created_at: string;
    updated_at: string;
    order_id: number | null;
    ticket_number: number | null;
    channel: string;
    printer_url: string;
    request_xml: string;
    ticket_text: string | null;
    idempotency_key: string;
    status: string;
    attempt_count: number;
    max_attempts: number;
    last_error: string | null;
    last_attempt_at: string | null;
  }>(
    `
      SELECT
        id,
        created_at,
        updated_at,
        order_id,
        ticket_number,
        channel,
        printer_url,
        request_xml,
        ticket_text,
        idempotency_key,
        status,
        attempt_count,
        max_attempts,
        last_error,
        last_attempt_at
      FROM print_jobs
      WHERE (
        status IN ('pending', 'failed')
        OR (status = 'processing' AND (last_attempt_at IS NULL OR datetime(last_attempt_at) <= datetime('now', '-3 minutes')))
      )
        AND attempt_count < max_attempts
      ORDER BY datetime(created_at) ASC, id ASC
      LIMIT ?
    `,
    [safeLimit],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    orderId: row.order_id ?? undefined,
    ticketNumber: row.ticket_number ?? undefined,
    channel: (row.channel as PrintJobRecord['channel']) ?? 'cash',
    printerUrl: row.printer_url,
    requestXml: row.request_xml,
    ticketText: row.ticket_text ?? undefined,
    idempotencyKey: row.idempotency_key,
    status: normalizePrintJobStatus(row.status),
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: Number(row.max_attempts ?? 0),
    lastError: row.last_error ?? undefined,
    lastAttemptAt: row.last_attempt_at ?? undefined,
  }));
};

export const markPrintJobProcessing = async (jobId: number): Promise<void> => {
  const db = await dbPromise;
  const now = new Date().toISOString();
  await db.runAsync(
    `
      UPDATE print_jobs
      SET status = 'processing',
          updated_at = ?,
          last_attempt_at = ?,
          attempt_count = attempt_count + 1
      WHERE id = ?
    `,
    [now, now, jobId],
  );
};

export const markPrintJobResult = async (
  jobId: number,
  result: { ok: boolean; message?: string },
): Promise<void> => {
  const db = await dbPromise;
  const now = new Date().toISOString();
  if (result.ok) {
    await db.runAsync(
      `
        UPDATE print_jobs
        SET status = 'printed',
            updated_at = ?,
            last_error = NULL
        WHERE id = ?
      `,
      [now, jobId],
    );
    return;
  }

  await db.runAsync(
    `
      UPDATE print_jobs
      SET status = 'failed',
          updated_at = ?,
          last_error = ?
      WHERE id = ?
    `,
    [now, (result.message ?? 'Erreur impression').slice(0, 500), jobId],
  );
};

export const getPrintQueueSummary = async (): Promise<{ pending: number; failed: number }> => {
  const db = await dbPromise;
  const row = await db.getFirstAsync<{ pending: number; failed: number }>(
    `
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM print_jobs
      WHERE status IN ('pending', 'failed')
        AND attempt_count < max_attempts
    `,
  );
  return {
    pending: Number(row?.pending ?? 0),
    failed: Number(row?.failed ?? 0),
  };
};

export const getRecentTickets = async (limit = 50): Promise<StoredTicket[]> => {
  const db = await dbPromise;

  const rows = await db.getAllAsync<{
    id: number;
    ticket_number: number;
    created_at: string;
    items_json: string;
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    total: number;
    payment_method: string;
    table_label: string | null;
    note: string | null;
    order_type: string | null;
    cash_ticket_text: string | null;
    kitchen_ticket_text: string | null;
    order_status: 'sale' | 'cancel' | 'refund' | null;
    status_reason: string | null;
    original_order_id: number | null;
    is_copy: number;
    previous_hash: string | null;
    entry_hash: string | null;
  }>(
    `
        SELECT
          id,
          COALESCE(ticket_number, id) as ticket_number,
          created_at,
          items_json,
          subtotal,
          discount_amount,
          tax_amount,
          total,
          payment_method,
          table_label,
          note,
          order_type,
          cash_ticket_text,
          kitchen_ticket_text,
          order_status,
          status_reason,
          original_order_id,
          is_copy,
          previous_hash,
          entry_hash
        FROM orders
        ORDER BY datetime(created_at) DESC
        LIMIT ?
      `,
    [limit],
  );

  return rows.map((row) => ({
    id: row.id,
    ticketNumber: Number(row.ticket_number),
    createdAt: row.created_at,
    items: parseItemsJson(row.items_json),
    subtotal: Number(row.subtotal),
    discountAmount: Number(row.discount_amount),
    taxAmount: Number(row.tax_amount),
    total: Number(row.total),
    paymentMethod: row.payment_method,
    tableLabel: row.table_label ?? undefined,
    note: row.note ?? undefined,
    orderType: (row.order_type === 'a_emporter' ? 'a_emporter' : 'sur_place') as OrderType,
    cashTicketText: row.cash_ticket_text ?? undefined,
    kitchenTicketText: row.kitchen_ticket_text ?? undefined,
    orderStatus: row.order_status === 'cancel' || row.order_status === 'refund' ? row.order_status : 'sale',
    statusReason: row.status_reason ?? undefined,
    originalOrderId: row.original_order_id ?? undefined,
    isCopy: row.is_copy === 1,
    previousHash: row.previous_hash ?? undefined,
    entryHash: row.entry_hash ?? undefined,
  }));
};

export const getTodayStats = async (): Promise<DailyStats> => {
  const db = await dbPromise;

  const row = await db.getFirstAsync<{ ordersCount: number; revenue: number }>(
    `
      SELECT
        COUNT(*) AS ordersCount,
        COALESCE(SUM(total), 0) AS revenue
      FROM orders
      WHERE date(created_at, 'localtime') = date('now', 'localtime')
    `,
  );

  return {
    ordersCount: Number(row?.ordersCount ?? 0),
    revenue: Number(row?.revenue ?? 0),
  };
};

export const getWeeklyStats = async (): Promise<DailyStats> => {
  const db = await dbPromise;

  const row = await db.getFirstAsync<{ ordersCount: number; revenue: number }>(
    `
      SELECT
        COUNT(*) AS ordersCount,
        COALESCE(SUM(total), 0) AS revenue
      FROM orders
      WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-6 days')
        AND date(created_at, 'localtime') <= date('now', 'localtime')
    `,
  );

  return {
    ordersCount: Number(row?.ordersCount ?? 0),
    revenue: Number(row?.revenue ?? 0),
  };
};

export const deleteAllTickets = async () => {
  throw new Error('Suppression totale des tickets desactivee (tracabilite legale).');
};

export const getCurrentXSnapshot = async (): Promise<ClosureSnapshot> => {
  const db = await dbPromise;
  const periodStart = await getCurrentPeriodStart(db);
  const periodEnd = new Date().toISOString();
  return buildSnapshotBetween(db, periodStart, periodEnd);
};

export const closeCurrentZPeriod = async (closedBy: string): Promise<ClosureRecord> => {
  const db = await dbPromise;
  const periodStart = await getCurrentPeriodStart(db);
  const periodEnd = new Date().toISOString();
  const snapshot = await buildSnapshotBetween(db, periodStart, periodEnd);

  const previousRow = await db.getFirstAsync<{ signature_hash: string | null }>(
    `SELECT signature_hash FROM closures ORDER BY id DESC LIMIT 1`,
  );
  const previousSignatureHash = previousRow?.signature_hash ?? 'GENESIS';
  const closedAt = new Date().toISOString();

  const payload = JSON.stringify({
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    closedAt,
    closedBy,
    ordersCount: snapshot.ordersCount,
    revenue: snapshot.revenue,
    paymentBreakdown: snapshot.paymentBreakdown,
    lastTicketNumber: snapshot.lastTicketNumber,
  });
  const signatureHash = await buildOrderHash(`${previousSignatureHash}|${payload}`);

  await db.runAsync(
    `
      INSERT INTO closures (
        period_start,
        period_end,
        closed_at,
        closed_by,
        orders_count,
        revenue,
        payment_breakdown_json,
        last_ticket_number,
        previous_signature_hash,
        signature_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      snapshot.periodStart,
      snapshot.periodEnd,
      closedAt,
      closedBy,
      snapshot.ordersCount,
      snapshot.revenue,
      JSON.stringify(snapshot.paymentBreakdown),
      snapshot.lastTicketNumber,
      previousSignatureHash,
      signatureHash,
    ],
  );

  await db.runAsync(
    `
      INSERT INTO app_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    [Z_LAST_CLOSED_AT_KEY, periodEnd],
  );

  const row = await db.getFirstAsync<{ id: number }>(`SELECT last_insert_rowid() as id`);

  return {
    id: Number(row?.id ?? 0),
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    ordersCount: snapshot.ordersCount,
    revenue: snapshot.revenue,
    paymentBreakdown: snapshot.paymentBreakdown,
    lastTicketNumber: snapshot.lastTicketNumber,
    closedAt,
    closedBy,
    previousSignatureHash,
    signatureHash,
  };
};

export const buildCurrentPeriodCsv = async () => {
  const db = await dbPromise;
  const periodStart = await getCurrentPeriodStart(db);
  const periodEnd = new Date().toISOString();

  const rows = await db.getAllAsync<{
    ticket_number: number | null;
    created_at: string;
    order_status: string;
    total: number;
    payment_method: string;
    user_name: string;
    is_copy: number;
    original_order_id: number | null;
    entry_hash: string | null;
  }>(
    `
      SELECT
        ticket_number,
        created_at,
        order_status,
        total,
        payment_method,
        user_name,
        is_copy,
        original_order_id,
        entry_hash
      FROM orders
      WHERE datetime(created_at) >= datetime(?)
        AND datetime(created_at) < datetime(?)
      ORDER BY COALESCE(ticket_number, id)
    `,
    [periodStart, periodEnd],
  );

  const esc = (value: string | number | null | undefined) => {
    const raw = String(value ?? '');
    return `"${raw.replace(/"/g, '""')}"`;
  };

  const header = [
    'ticket_number',
    'created_at',
    'order_status',
    'total',
    'payment_method',
    'user_name',
    'is_copy',
    'original_order_id',
    'entry_hash',
  ];

  const lines = [header.map((h) => esc(h)).join(',')];
  rows.forEach((row) => {
    lines.push(
      [
        row.ticket_number,
        row.created_at,
        row.order_status,
        Number(row.total).toFixed(2),
        row.payment_method,
        row.user_name,
        row.is_copy,
        row.original_order_id,
        row.entry_hash,
      ]
        .map((cell) => esc(cell))
        .join(','),
    );
  });

  return {
    periodStart,
    periodEnd,
    csv: lines.join('\n'),
    rowsCount: rows.length,
  };
};

export const getCurrentPeriodTickets = async (): Promise<StoredTicket[]> => {
  const db = await dbPromise;
  const periodStart = await getCurrentPeriodStart(db);
  const periodEnd = new Date().toISOString();

  const rows = await db.getAllAsync<{
    id: number;
    ticket_number: number;
    created_at: string;
    items_json: string;
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    total: number;
    payment_method: string;
    table_label: string | null;
    note: string | null;
    order_type: string | null;
    cash_ticket_text: string | null;
    kitchen_ticket_text: string | null;
    order_status: 'sale' | 'cancel' | 'refund' | null;
    status_reason: string | null;
    original_order_id: number | null;
    is_copy: number;
    previous_hash: string | null;
    entry_hash: string | null;
  }>(
    `
      SELECT
        id,
        COALESCE(ticket_number, id) as ticket_number,
        created_at,
        items_json,
        subtotal,
        discount_amount,
        tax_amount,
        total,
        payment_method,
        table_label,
        note,
        order_type,
        cash_ticket_text,
        kitchen_ticket_text,
        order_status,
        status_reason,
        original_order_id,
        is_copy,
        previous_hash,
        entry_hash
      FROM orders
      WHERE datetime(created_at) >= datetime(?)
        AND datetime(created_at) < datetime(?)
      ORDER BY COALESCE(ticket_number, id) DESC
    `,
    [periodStart, periodEnd],
  );

  return rows.map((row) => ({
    id: row.id,
    ticketNumber: Number(row.ticket_number),
    createdAt: row.created_at,
    items: parseItemsJson(row.items_json),
    subtotal: Number(row.subtotal),
    discountAmount: Number(row.discount_amount),
    taxAmount: Number(row.tax_amount),
    total: Number(row.total),
    paymentMethod: row.payment_method,
    tableLabel: row.table_label ?? undefined,
    note: row.note ?? undefined,
    orderType: (row.order_type === 'a_emporter' ? 'a_emporter' : 'sur_place') as OrderType,
    cashTicketText: row.cash_ticket_text ?? undefined,
    kitchenTicketText: row.kitchen_ticket_text ?? undefined,
    orderStatus: row.order_status === 'cancel' || row.order_status === 'refund' ? row.order_status : 'sale',
    statusReason: row.status_reason ?? undefined,
    originalOrderId: row.original_order_id ?? undefined,
    isCopy: row.is_copy === 1,
    previousHash: row.previous_hash ?? undefined,
    entryHash: row.entry_hash ?? undefined,
  }));
};

export const getRecentClosures = async (limit = 20): Promise<ClosureRecord[]> => {
  const db = await dbPromise;

  const rows = await db.getAllAsync<{
    id: number;
    period_start: string;
    period_end: string;
    closed_at: string;
    closed_by: string;
    orders_count: number;
    revenue: number;
    payment_breakdown_json: string;
    last_ticket_number: number;
    previous_signature_hash: string | null;
    signature_hash: string;
  }>(
    `
      SELECT
        id,
        period_start,
        period_end,
        closed_at,
        closed_by,
        orders_count,
        revenue,
        payment_breakdown_json,
        last_ticket_number,
        previous_signature_hash,
        signature_hash
      FROM closures
      ORDER BY id DESC
      LIMIT ?
    `,
    [limit],
  );

  return Promise.all(rows.map(async (row) => {
    // Compute tax breakdown for this closure's period
    let taxBreakdown: TaxBreakdownLine[] | undefined;
    try {
      const orderRows = await db.getAllAsync<{ items_json: string; order_type: string }>(
        `SELECT items_json, order_type FROM orders
         WHERE datetime(created_at) >= datetime(?)
           AND datetime(created_at) < datetime(?)`,
        [row.period_start, row.period_end],
      );
      const globalTaxMap = new Map<number, { ht: number; tva: number; ttc: number }>();
      for (const or of orderRows) {
        try {
          const items: CartItem[] = JSON.parse(or.items_json || '[]');
          const bd = computeTaxBreakdownFromItems(items, or.order_type || 'sur_place');
          for (const line of bd) {
            const existing = globalTaxMap.get(line.rate) ?? { ht: 0, tva: 0, ttc: 0 };
            existing.ht += line.ht; existing.tva += line.tva; existing.ttc += line.ttc;
            globalTaxMap.set(line.rate, existing);
          }
        } catch { /* skip malformed */ }
      }
      taxBreakdown = Array.from(globalTaxMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([rate, v]) => ({
          rate,
          ht: Number(v.ht.toFixed(2)),
          tva: Number(v.tva.toFixed(2)),
          ttc: Number(v.ttc.toFixed(2)),
        }));
    } catch { /* non-blocking */ }

    return {
      id: row.id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      closedAt: row.closed_at,
      closedBy: row.closed_by,
      ordersCount: Number(row.orders_count),
      revenue: Number(row.revenue),
      paymentBreakdown: parsePaymentBreakdownJson(row.payment_breakdown_json),
      lastTicketNumber: Number(row.last_ticket_number),
      previousSignatureHash: row.previous_signature_hash ?? undefined,
      signatureHash: row.signature_hash,
      taxBreakdown,
    };
  }));
};

export const runIntegrityAudit = async (): Promise<AuditReport> => {
  const db = await dbPromise;
  const issues: AuditReport['issues'] = [];

  const orderRows = await db.getAllAsync<{
    id: number;
    ticket_number: number | null;
    created_at: string;
    user_role: string;
    user_name: string;
    items_json: string;
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    total: number;
    payment_method: string;
    order_status: string;
    status_reason: string | null;
    original_order_id: number | null;
    is_copy: number;
    table_label: string | null;
    note: string | null;
    order_type: string | null;
    cash_ticket_text: string | null;
    kitchen_ticket_text: string | null;
    previous_hash: string | null;
    entry_hash: string | null;
  }>(
    `
      SELECT
        id,
        ticket_number,
        created_at,
        user_role,
        user_name,
        items_json,
        subtotal,
        discount_amount,
        tax_amount,
        total,
        payment_method,
        order_status,
        status_reason,
        original_order_id,
        is_copy,
        table_label,
        note,
        order_type,
        cash_ticket_text,
        kitchen_ticket_text,
        previous_hash,
        entry_hash
      FROM orders
      ORDER BY COALESCE(ticket_number, id)
    `,
  );

  let strictSequenceOk = true;
  let orderChainOk = true;
  let expectedPreviousHash = 'GENESIS';
  let previousTicketNumber = 0;

  for (const row of orderRows) {
    const ticketNumber = Number(row.ticket_number ?? row.id);
    if (previousTicketNumber && ticketNumber !== previousTicketNumber + 1) {
      strictSequenceOk = false;
      issues.push({
        scope: 'orders',
        id: row.id,
        message: `Séquence ticket rompue: attendu ${previousTicketNumber + 1}, trouvé ${ticketNumber}`,
      });
    }
    previousTicketNumber = ticketNumber;

    const rowPreviousHash = row.previous_hash ?? 'GENESIS';
    if (rowPreviousHash !== expectedPreviousHash) {
      orderChainOk = false;
      issues.push({
        scope: 'orders',
        id: row.id,
        message: 'Rupture de chaînage previous_hash.',
      });
    }

    const payload = JSON.stringify({
      ticketNumber,
      createdAt: row.created_at,
      userRole: row.user_role,
      userName: row.user_name,
      itemsJson: row.items_json,
      subtotal: Number(row.subtotal),
      discountAmount: Number(row.discount_amount),
      taxAmount: Number(row.tax_amount),
      total: Number(row.total),
      paymentMethod: row.payment_method,
      orderStatus: row.order_status,
      statusReason: row.status_reason,
      originalOrderId: row.original_order_id,
      isCopy: row.is_copy,
      tableLabel: row.table_label ?? undefined,
      note: row.note ?? undefined,
      orderType: row.order_type ?? 'sur_place',
      cashTicketText: row.cash_ticket_text,
      kitchenTicketText: row.kitchen_ticket_text,
    });
    const computedEntryHash = await buildOrderHash(`${rowPreviousHash}|${payload}`);
    if (!row.entry_hash || row.entry_hash !== computedEntryHash) {
      orderChainOk = false;
      issues.push({
        scope: 'orders',
        id: row.id,
        message: 'Hash ticket invalide.',
      });
    }

    expectedPreviousHash = row.entry_hash ?? computedEntryHash;
  }

  const closureRows = await db.getAllAsync<{
    id: number;
    period_start: string;
    period_end: string;
    closed_at: string;
    closed_by: string;
    orders_count: number;
    revenue: number;
    payment_breakdown_json: string;
    last_ticket_number: number;
    previous_signature_hash: string | null;
    signature_hash: string;
  }>(
    `
      SELECT
        id,
        period_start,
        period_end,
        closed_at,
        closed_by,
        orders_count,
        revenue,
        payment_breakdown_json,
        last_ticket_number,
        previous_signature_hash,
        signature_hash
      FROM closures
      ORDER BY id
    `,
  );

  let closureChainOk = true;
  let expectedPreviousSignature = 'GENESIS';

  for (const row of closureRows) {
    const prev = row.previous_signature_hash ?? 'GENESIS';
    if (prev !== expectedPreviousSignature) {
      closureChainOk = false;
      issues.push({
        scope: 'closures',
        id: row.id,
        message: 'Rupture previous_signature_hash.',
      });
    }

    const payload = JSON.stringify({
      periodStart: row.period_start,
      periodEnd: row.period_end,
      closedAt: row.closed_at,
      closedBy: row.closed_by,
      ordersCount: Number(row.orders_count),
      revenue: Number(row.revenue),
      paymentBreakdown: parsePaymentBreakdownJson(row.payment_breakdown_json),
      lastTicketNumber: Number(row.last_ticket_number),
    });
    const computedSignature = await buildOrderHash(`${prev}|${payload}`);

    if (row.signature_hash !== computedSignature) {
      closureChainOk = false;
      issues.push({
        scope: 'closures',
        id: row.id,
        message: 'Signature clôture invalide.',
      });
    }

    expectedPreviousSignature = row.signature_hash;
  }

  return {
    checkedAt: new Date().toISOString(),
    ordersChecked: orderRows.length,
    closuresChecked: closureRows.length,
    strictSequenceOk,
    orderChainOk,
    closureChainOk,
    issues,
  };
};

export const buildLegalClosureArchive = async (closureId?: number): Promise<LegalClosureArchive> => {
  const db = await dbPromise;

  const closure = closureId
    ? await db.getFirstAsync<{
      id: number;
      period_start: string;
      period_end: string;
      closed_at: string;
      closed_by: string;
      orders_count: number;
      revenue: number;
      payment_breakdown_json: string;
      last_ticket_number: number;
      previous_signature_hash: string | null;
      signature_hash: string;
    }>(
      `
          SELECT
            id,
            period_start,
            period_end,
            closed_at,
            closed_by,
            orders_count,
            revenue,
            payment_breakdown_json,
            last_ticket_number,
            previous_signature_hash,
            signature_hash
          FROM closures
          WHERE id = ?
          LIMIT 1
        `,
      [closureId],
    )
    : await db.getFirstAsync<{
      id: number;
      period_start: string;
      period_end: string;
      closed_at: string;
      closed_by: string;
      orders_count: number;
      revenue: number;
      payment_breakdown_json: string;
      last_ticket_number: number;
      previous_signature_hash: string | null;
      signature_hash: string;
    }>(
      `
          SELECT
            id,
            period_start,
            period_end,
            closed_at,
            closed_by,
            orders_count,
            revenue,
            payment_breakdown_json,
            last_ticket_number,
            previous_signature_hash,
            signature_hash
          FROM closures
          ORDER BY id DESC
          LIMIT 1
        `,
    );

  if (!closure) {
    throw new Error('Aucune clôture Z disponible pour archive.');
  }

  const ticketRows = await db.getAllAsync<{
    id: number;
    ticket_number: number | null;
    created_at: string;
    user_role: string;
    user_name: string;
    items_json: string;
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    total: number;
    payment_method: string;
    order_status: string;
    status_reason: string | null;
    original_order_id: number | null;
    is_copy: number;
    table_label: string | null;
    note: string | null;
    previous_hash: string | null;
    entry_hash: string | null;
  }>(
    `
      SELECT
        id,
        ticket_number,
        created_at,
        user_role,
        user_name,
        items_json,
        subtotal,
        discount_amount,
        tax_amount,
        total,
        payment_method,
        order_status,
        status_reason,
        original_order_id,
        is_copy,
        table_label,
        note,
        previous_hash,
        entry_hash
      FROM orders
      WHERE datetime(created_at) >= datetime(?)
        AND datetime(created_at) < datetime(?)
      ORDER BY COALESCE(ticket_number, id)
    `,
    [closure.period_start, closure.period_end],
  );

  const archiveClosure: ClosureRecord = {
    id: closure.id,
    periodStart: closure.period_start,
    periodEnd: closure.period_end,
    closedAt: closure.closed_at,
    closedBy: closure.closed_by,
    ordersCount: Number(closure.orders_count),
    revenue: Number(closure.revenue),
    paymentBreakdown: parsePaymentBreakdownJson(closure.payment_breakdown_json),
    lastTicketNumber: Number(closure.last_ticket_number),
    previousSignatureHash: closure.previous_signature_hash ?? undefined,
    signatureHash: closure.signature_hash,
  };

  const tickets = ticketRows.map((row) => ({
    id: row.id,
    ticketNumber: Number(row.ticket_number ?? row.id),
    createdAt: row.created_at,
    userRole: row.user_role,
    userName: row.user_name,
    itemsJson: row.items_json,
    subtotal: Number(row.subtotal),
    discountAmount: Number(row.discount_amount),
    taxAmount: Number(row.tax_amount),
    total: Number(row.total),
    paymentMethod: row.payment_method,
    orderStatus: row.order_status,
    statusReason: row.status_reason ?? undefined,
    originalOrderId: row.original_order_id ?? undefined,
    isCopy: row.is_copy === 1,
    tableLabel: row.table_label ?? undefined,
    note: row.note ?? undefined,
    previousHash: row.previous_hash ?? undefined,
    entryHash: row.entry_hash ?? undefined,
  }));

  const auditReport = await runIntegrityAudit();
  const generatedAt = new Date().toISOString();

  const payload = {
    schemaVersion: '1.0.0',
    generatedAt,
    hashAlgorithm: 'SHA-256' as const,
    closure: archiveClosure,
    tickets,
    auditReport,
  };

  const archiveHash = await buildOrderHash(JSON.stringify(payload));

  return {
    ...payload,
    archiveHash,
  };
};

export const verifyLegalClosureArchive = async (rawArchive: unknown): Promise<LegalArchiveVerification> => {
  const checkedAt = new Date().toISOString();

  if (!rawArchive || typeof rawArchive !== 'object' || Array.isArray(rawArchive)) {
    return {
      checkedAt,
      isValid: false,
      expectedHash: '',
      computedHash: '',
      reason: 'Format archive invalide.',
    };
  }

  const archive = rawArchive as Partial<LegalClosureArchive>;
  if (typeof archive.archiveHash !== 'string' || !archive.archiveHash) {
    return {
      checkedAt,
      isValid: false,
      expectedHash: '',
      computedHash: '',
      schemaVersion: typeof archive.schemaVersion === 'string' ? archive.schemaVersion : undefined,
      closureId:
        archive.closure && typeof archive.closure === 'object' && typeof archive.closure.id === 'number'
          ? archive.closure.id
          : undefined,
      reason: 'archiveHash absent.',
    };
  }

  const payload = {
    schemaVersion: archive.schemaVersion,
    generatedAt: archive.generatedAt,
    hashAlgorithm: archive.hashAlgorithm,
    closure: archive.closure,
    tickets: archive.tickets,
    auditReport: archive.auditReport,
  };
  const computedHash = await buildOrderHash(JSON.stringify(payload));
  const isValid = computedHash === archive.archiveHash;

  return {
    checkedAt,
    isValid,
    expectedHash: archive.archiveHash,
    computedHash,
    schemaVersion: typeof archive.schemaVersion === 'string' ? archive.schemaVersion : undefined,
    closureId:
      archive.closure && typeof archive.closure === 'object' && typeof archive.closure.id === 'number'
        ? archive.closure.id
        : undefined,
    reason: isValid ? undefined : 'Hash global archive invalide.',
  };
};

export const restoreDatabaseFromBackup = async (backupUri: string) => {
  const db = await dbPromise;
  const sqliteDir = `${FileSystem.documentDirectory ?? ''}SQLite`;
  if (!sqliteDir) {
    throw new Error('Répertoire SQLite introuvable.');
  }

  await FileSystem.makeDirectoryAsync(sqliteDir, { intermediates: true });
  const restoreFilePath = `${sqliteDir}/restore_source.db`;

  const existingTmp = await FileSystem.getInfoAsync(restoreFilePath);
  if (existingTmp.exists) {
    await FileSystem.deleteAsync(restoreFilePath, { idempotent: true });
  }

  await FileSystem.copyAsync({ from: backupUri, to: restoreFilePath });

  const copiedTmp = await FileSystem.getInfoAsync(restoreFilePath);
  if (!copiedTmp.exists) {
    throw new Error('Copie de la sauvegarde impossible.');
  }

  const escapedPath = restoreFilePath.replace(/'/g, "''");
  await db.execAsync(`ATTACH DATABASE '${escapedPath}' AS restore_db`);

  try {
    const requiredTables = await db.getAllAsync<{ name: string }>(
      `
        SELECT name
        FROM restore_db.sqlite_master
        WHERE type = 'table'
          AND name IN ('orders', 'app_settings', 'products', 'closures')
      `,
    );
    const optionalTables = await db.getAllAsync<{ name: string }>(
      `
        SELECT name
        FROM restore_db.sqlite_master
        WHERE type = 'table'
          AND name IN ('print_jobs')
      `,
    );

    if (requiredTables.length < 4) {
      throw new Error('La sauvegarde ne contient pas les tables requises.');
    }

    await db.execAsync('BEGIN IMMEDIATE');
    try {
      await db.execAsync('PRAGMA foreign_keys = OFF');

      await db.runAsync('DELETE FROM orders');
      await db.runAsync('DELETE FROM closures');
      await db.runAsync('DELETE FROM products');
      await db.runAsync('DELETE FROM app_settings');
      await db.runAsync('DELETE FROM print_jobs');

      await db.runAsync(
        `
          INSERT INTO orders (
            id,
            ticket_number,
            created_at,
            user_role,
            user_name,
            items_json,
            subtotal,
            discount_amount,
            tax_amount,
            total,
            payment_method,
            order_status,
            status_reason,
            original_order_id,
            is_copy,
            previous_hash,
            entry_hash,
            table_label,
            note,
            cash_ticket_text,
            kitchen_ticket_text
          )
          SELECT
            id,
            ticket_number,
            created_at,
            user_role,
            user_name,
            items_json,
            subtotal,
            discount_amount,
            tax_amount,
            total,
            payment_method,
            order_status,
            status_reason,
            original_order_id,
            is_copy,
            previous_hash,
            entry_hash,
            table_label,
            note,
            cash_ticket_text,
            kitchen_ticket_text
          FROM restore_db.orders
        `,
      );

      await db.runAsync(
        `
          INSERT INTO closures (
            id,
            period_start,
            period_end,
            closed_at,
            closed_by,
            orders_count,
            revenue,
            payment_breakdown_json,
            last_ticket_number,
            previous_signature_hash,
            signature_hash
          )
          SELECT
            id,
            period_start,
            period_end,
            closed_at,
            closed_by,
            orders_count,
            revenue,
            payment_breakdown_json,
            last_ticket_number,
            previous_signature_hash,
            signature_hash
          FROM restore_db.closures
        `,
      );

      await db.runAsync(
        `
          INSERT INTO products (
            id,
            slug,
            name,
            price,
            category,
            send_to_kitchen,
            send_to_salle,
            active,
            image_key,
            menu_price
          )
          SELECT
            id,
            slug,
            name,
            price,
            category,
            send_to_kitchen,
            COALESCE(send_to_salle, 1),
            active,
            image_key,
            menu_price
          FROM restore_db.products
        `,
      );

      await db.runAsync(
        `
          INSERT INTO app_settings (key, value)
          SELECT key, value FROM restore_db.app_settings
        `,
      );

      const hasPrintJobsBackup = optionalTables.some((row) => row.name === 'print_jobs');
      if (hasPrintJobsBackup) {
        await db.runAsync(
          `
            INSERT INTO print_jobs (
              id,
              created_at,
              updated_at,
              order_id,
              ticket_number,
              channel,
              printer_url,
              request_xml,
              ticket_text,
              idempotency_key,
              status,
              attempt_count,
              max_attempts,
              last_error,
              last_attempt_at
            )
            SELECT
              id,
              created_at,
              updated_at,
              order_id,
              ticket_number,
              channel,
              printer_url,
              request_xml,
              ticket_text,
              idempotency_key,
              status,
              attempt_count,
              max_attempts,
              last_error,
              last_attempt_at
            FROM restore_db.print_jobs
          `,
        );
      }

      const maxTicket = await db.getFirstAsync<{ maxTicket: number }>(
        `SELECT COALESCE(MAX(ticket_number), 0) AS maxTicket FROM orders`,
      );

      await setOrderSequenceAtLeast(db, Number(maxTicket?.maxTicket ?? 0));

      const maxClosureEnd = await db.getFirstAsync<{ period_end: string | null }>(
        `SELECT period_end FROM closures ORDER BY id DESC LIMIT 1`,
      );

      await db.runAsync(
        `
          INSERT INTO app_settings (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `,
        [Z_LAST_CLOSED_AT_KEY, maxClosureEnd?.period_end ?? '1970-01-01T00:00:00.000Z'],
      );

      await db.execAsync('COMMIT');
    } catch (error) {
      await db.execAsync('ROLLBACK');
      throw error;
    } finally {
      await db.execAsync('PRAGMA foreign_keys = ON');
    }
  } finally {
    await db.execAsync('DETACH DATABASE restore_db');
    await FileSystem.deleteAsync(restoreFilePath, { idempotent: true });
  }
};

export const getPrinterSettings = async (): Promise<PrinterSettings> => {
  const db = await dbPromise;

  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM app_settings');

  const settings = rows.reduce(
    (acc, row) => {
      if (row.key === 'cash_printer_url') {
        acc.cashPrinterUrl = row.value;
      }
      if (row.key === 'kitchen_printer_url') {
        acc.kitchenPrinterUrl = row.value;
      }
      if (row.key === 'print_mode') {
        acc.printMode = row.value === 'usb_single' ? 'usb_single' : 'network_dual';
      }
      if (row.key === 'usb_printer_id') {
        acc.usbPrinterId = row.value;
      }
      if (row.key === 'usb_printer_name') {
        acc.usbPrinterName = row.value;
      }
      if (row.key === 'service_ticket_enabled') {
        acc.serviceTicketEnabled = row.value === '1';
      }
      if (row.key === 'night_surcharge_percent') {
        const parsed = parseFloat(row.value);
        acc.nightSurchargePercent = Number.isFinite(parsed) ? parsed : 0;
      }

      return acc;
    },
    { ...DEFAULT_PRINTER_SETTINGS },
  );

  return settings;
};

export const savePrinterSettings = async (settings: PrinterSettings) => {
  const db = await dbPromise;

  await db.runAsync(
    `INSERT INTO app_settings (key, value)
     VALUES ('cash_printer_url', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [settings.cashPrinterUrl.trim()],
  );

  await db.runAsync(
    `INSERT INTO app_settings (key, value)
     VALUES ('kitchen_printer_url', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [settings.kitchenPrinterUrl.trim()],
  );

  await db.runAsync(
    `INSERT INTO app_settings (key, value)
     VALUES ('print_mode', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [settings.printMode === 'usb_single' ? 'usb_single' : 'network_dual'],
  );

  await db.runAsync(
    `INSERT INTO app_settings (key, value)
     VALUES ('usb_printer_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [settings.usbPrinterId.trim()],
  );

  await db.runAsync(
    `INSERT INTO app_settings (key, value)
     VALUES ('usb_printer_name', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [settings.usbPrinterName.trim()],
  );

  await db.runAsync(
    `INSERT INTO app_settings (key, value)
     VALUES ('service_ticket_enabled', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [settings.serviceTicketEnabled ? '1' : '0'],
  );

  await db.runAsync(
    `INSERT INTO app_settings (key, value)
     VALUES ('night_surcharge_percent', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(settings.nightSurchargePercent ?? 0)],
  );

  await db.runAsync(
    `DELETE FROM app_settings WHERE key IN ('proxy_token', 'kitchen_printer_routes_json')`,
  );
};

export const saveUserPin = async (username: string, pin: string) => {
  const db = await dbPromise;
  const key = `user_pin_${username}`;
  await db.runAsync(
    `INSERT INTO app_settings (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, pin],
  );
};

export const loadUserPins = async (): Promise<Record<string, string>> => {
  const db = await dbPromise;
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings WHERE key LIKE 'user_pin_%'`,
  );
  const pins: Record<string, string> = {};
  for (const row of rows) {
    const username = row.key.replace('user_pin_', '');
    pins[username] = row.value;
  }
  return pins;
};

// ── Ouverture de caisse ──

export type CaisseOpenState = {
  isOpen: boolean;
  openedAt: string | null;
  openedBy: string | null;
};

const CAISSE_OPEN_KEY = 'caisse_open_state';

export const getCaisseOpenState = async (): Promise<CaisseOpenState> => {
  const db = await dbPromise;
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = ?`,
    [CAISSE_OPEN_KEY],
  );
  if (row?.value) {
    try {
      return JSON.parse(row.value);
    } catch {
      // corrupted – treat as closed
    }
  }
  return { isOpen: false, openedAt: null, openedBy: null };
};

export const setCaisseOpenState = async (state: CaisseOpenState): Promise<void> => {
  const db = await dbPromise;
  await db.runAsync(
    `INSERT INTO app_settings (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [CAISSE_OPEN_KEY, JSON.stringify(state)],
  );
};

export const openCaisse = async (username: string): Promise<CaisseOpenState> => {
  const state: CaisseOpenState = {
    isOpen: true,
    openedAt: new Date().toISOString(),
    openedBy: username,
  };
  await setCaisseOpenState(state);
  return state;
};

export const closeCaisseState = async (): Promise<void> => {
  await setCaisseOpenState({ isOpen: false, openedAt: null, openedBy: null });
};
