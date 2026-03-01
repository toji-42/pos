/**
 * ticketBuilder.ts
 *
 * Génère le XML ePOS (Epson) complet pour les tickets de caisse
 * avec formatage professionnel : colonnes alignées, gras, double-hauteur,
 * inversé, tableau TVA, etc.
 *
 * Le XML produit est directement consommé par sendToEpson() dans epson.ts
 * puis envoyé à l'endpoint ePOS de l'imprimante Epson.
 */

import {
  CartItem,
  OrderType,
  TaxLine,
  TicketCustomization,
  normalizeTicketCustomization,
} from '../types';
import { CLIENT_TICKET_LOGO } from './clientTicketLogo';

// ── Config ticket ───────────────────────────────────────────────────────────
const W = 42; // largeur en caractères (80mm, police A optimisée)
const SEP = '-'.repeat(W);
const DOUBLE_SEP = '='.repeat(W);

// ── TVA ─────────────────────────────────────────────────────────────────────
const TAX_RATE_SUR_PLACE: Record<string, number> = {
  burgers: 0.1,
  snacks: 0.1,
  salades: 0.1,
  desserts: 0.1,
  boissons: 0.1,
  accompagnements: 0.1,
  sauces: 0.1,
};

const TAX_RATE_A_EMPORTER: Record<string, number> = {
  burgers: 0.1,
  snacks: 0.1,
  salades: 0.1,
  desserts: 0.1,
  boissons: 0.055,
  accompagnements: 0.1,
  sauces: 0.1,
};

const TAX_CODES: { rate: number; code: string }[] = [
  { rate: 0.055, code: 'A' },
  { rate: 0.1, code: 'B' },
  { rate: 0.2, code: 'C' },
];

const taxCodeForRate = (rate: number) =>
  TAX_CODES.find((e) => Math.abs(e.rate - rate) < 0.001)?.code ?? '?';

const taxRateForCategory = (cat: string, ot: OrderType = 'sur_place') =>
  (ot === 'a_emporter' ? TAX_RATE_A_EMPORTER : TAX_RATE_SUR_PLACE)[cat] ?? 0.1;

// ── Helpers texte ───────────────────────────────────────────────────────────
const padR = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length));
const padL = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : ' '.repeat(w - s.length) + s);
const centerStr = (s: string, w: number) => {
  if (s.length >= w) return s;
  const left = Math.floor((w - s.length) / 2);
  return ' '.repeat(left) + s + ' '.repeat(w - s.length - left);
};
const wrapText = (value: string, width: number): string[] => {
  const safeWidth = Math.max(1, width);
  const paragraphs = (value ?? '').split('\n');
  const lines: string[] = [];

  paragraphs.forEach((paragraph) => {
    const cleaned = paragraph.replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      lines.push('');
      return;
    }

    let current = '';
    const words = cleaned.split(' ');
    words.forEach((word) => {
      if (word.length > safeWidth) {
        if (current) {
          lines.push(current);
          current = '';
        }
        let remaining = word;
        while (remaining.length > safeWidth) {
          lines.push(remaining.slice(0, safeWidth));
          remaining = remaining.slice(safeWidth);
        }
        current = remaining;
        return;
      }

      if (!current) {
        current = word;
        return;
      }

      if ((current.length + 1 + word.length) <= safeWidth) {
        current += ` ${word}`;
        return;
      }

      lines.push(current);
      current = word;
    });

    if (current) {
      lines.push(current);
    }
  });

  return lines.length ? lines : [''];
};

const wrapWithPrefix = (prefix: string, content: string, width = W): string[] => {
  const safePrefix = prefix ?? '';
  const wrapped = wrapText(content, Math.max(1, width - safePrefix.length));
  return wrapped.map((chunk, index) => (index === 0
    ? `${safePrefix}${chunk}`
    : `${' '.repeat(safePrefix.length)}${chunk}`));
};

const fmtPrice = (v: number) => v.toFixed(2);
const fmtCurrency = (v: number) => `${v.toFixed(2)} EUR`;
const fmtPercent = (v: number) => {
  if (!Number.isFinite(v)) return '';
  const rounded = Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
  return `${rounded}%`;
};

/** Ligne à 2 colonnes : label à gauche, valeur à droite */
const twoCol = (left: string, right: string, width = W) => {
  const gap = width - left.length - right.length;
  return gap > 0 ? left + ' '.repeat(gap) + right : left + ' ' + right;
};

const twoColWrapped = (left: string, right: string, width = W): string[] => {
  const line = twoCol(left, right, width);
  if (line.length <= width) return [line];
  return wrapWithPrefix(`${left} `, right, width);
};

const formatMenuDisplayName = (name: string) => {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'MENU';
  const normalized = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (normalized.startsWith('menu ')) {
    const baseLabel = trimmed.split(/\s*-\s*/)[0]?.trim();
    if (baseLabel) return baseLabel;
    return trimmed;
  }
  return `Menu ${trimmed}`;
};

// ── XML ePOS helpers ────────────────────────────────────────────────────────
const escXml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const toTicketAscii = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/€/g, ' EUR')
    .replace(/[’]/g, "'")
    .replace(/[–—]/g, '-')
    // Enforce strict printable ASCII to avoid unsupported thermal symbols.
    .replace(/[^\x20-\x7E]/g, '');

type TextOpts = {
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  dh?: boolean;
  dw?: boolean;
  reverse?: boolean;
  ul?: boolean;
};

/** Génère un élément <text> ePOS avec attributs de formatage */
const txt = (content: string, opts?: TextOpts): string => {
  const attrs: string[] = [];
  if (opts?.align) attrs.push(`align="${opts.align}"`);
  if (opts?.bold) attrs.push('bold="true"');
  if (opts?.dh) attrs.push('dh="true"');
  if (opts?.dw) attrs.push('dw="true"');
  if (opts?.reverse) attrs.push('reverse="true"');
  if (opts?.ul) attrs.push('ul="true"');
  const a = attrs.length ? ' ' + attrs.join(' ') : '';
  return `<text${a}>${escXml(toTicketAscii(content))}\n</text>`;
};

/** Plusieurs lignes avec les mêmes attributs */
const txtLines = (lines: string[], opts?: TextOpts): string =>
  lines.map((l) => txt(l, opts)).join('\n');

const feed = (n = 1) => `<feed line="${n}"/>`;
const cut = () => '<cut type="feed"/>';

// ── Colonnes produits ───────────────────────────────────────────────────────
// Layout 42 chars : Qty(2) ' ' Name(18) ' ' PU(6) ' ' TVA(2) ' ' Total(7)
//                   2+1+18+1+6+1+2+1+7 = 39... +3 = designation gets 21
// Final:  Qty(2) ' ' Name(20) PU(6) ' ' TVA(1) Total(7) = 2+1+20+6+1+1+1+7 = 39
// Let me use: Qty(2) ' ' Name(19) ' ' PU(5) ' ' Code(1) ' ' Total(6) = 2+1+19+1+5+1+1+1+6 = 37 + 5 padding
// Simplest: qty  name              pu    c  total
//           " 1  Le Cheese         7.90  B   7.90"
const COL_QTY = 2;
const COL_NAME = 19;
const COL_PU = 6;
const COL_CODE = 1;
const COL_TOTAL = 7;
// 2 + 1 + 19 + 1 + 6 + 2 + 1 + 1 + 7 = 40... close enough

const buildItemLine = (qty: number, name: string, unitPrice: number, taxCode: string, lineTotal: number): string => {
  const q = padL(String(qty), COL_QTY);
  const n = padR(name, COL_NAME);
  const p = padL(fmtPrice(unitPrice), COL_PU);
  const c = taxCode;
  const t = padL(fmtPrice(lineTotal), COL_TOTAL);
  return `${q} ${n} ${p}  ${c} ${t}`;
};

const buildItemLines = (qty: number, name: string, unitPrice: number, taxCode: string, lineTotal: number): string[] => {
  const normalizedName = (name ?? '').replace(/\s+/g, ' ').trim() || '-';
  const nameLines = wrapText(normalizedName, COL_NAME);
  const firstLine = buildItemLine(qty, nameLines[0], unitPrice, taxCode, lineTotal);
  if (nameLines.length === 1) return [firstLine];

  const continuationPrefix = ' '.repeat(COL_QTY + 1);
  const continuationLines = nameLines
    .slice(1)
    .map((line) => `${continuationPrefix}${padR(line, COL_NAME)}`);
  return [firstLine, ...continuationLines];
};

const buildHeaderLine = (): string => {
  const q = padR('Qt', COL_QTY);
  const n = padR('Designation', COL_NAME);
  const p = padL('P.U', COL_PU);
  const c = 'T';
  const t = padL('Total', COL_TOTAL);
  return `${q} ${n} ${p}  ${c} ${t}`;
};

// ── Payload ─────────────────────────────────────────────────────────────────
export type TicketPayload = {
  cartItems: CartItem[];
  tableLabel: string;
  note: string;
  total: number;
  paymentMethod?: string;
  seller: string;
  taxLines?: TaxLine[];
  totalHt?: number;
  discountAmount?: number;
  surchargeAmount?: number;
  surchargePercent?: number;
  orderType?: OrderType;
  ticketNumber?: number | string;
  isDuplicate?: boolean;
  ticketCustomization?: TicketCustomization;
};

const paymentMethodLabel = (value?: string) => {
  const n = (value ?? '').trim().toLowerCase();
  if (!n) return 'Non précisé';
  if (n === 'carte') return 'CB';
  if (n === 'cb') return 'CB';
  if (n === 'cb borne' || n === 'cb restaurant' || n === 'titre restaurant cb') return 'CB Restaurant';
  if (n === 'especes' || n === 'espèces') return 'Espèces';
  if (n === 'chèque vacances' || n === 'cheque vacances') return 'Cheque Vacances';
  return value as string;
};

const shouldHidePaymentLineForVoucherSurplus = (value?: string) => {
  const normalized = (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!normalized) return false;
  const isVoucher =
    normalized.includes('ticket restaurant') ||
    normalized.includes('ticket restau') ||
    normalized.includes('cheque vacance') ||
    normalized.includes('cheques vacances') ||
    normalized.includes('cheque-vacances');
  return isVoucher && normalized.includes('surplus');
};

const isKitchenTicketProduct = (product: CartItem['product']) =>
  product.sendToKitchen
  && (product.category === 'burgers' || product.category === 'snacks' || product.category === 'salades');

const kitchenItemLabel = (product: CartItem['product']) =>
  product.name;

// ── Génération du ticket caisse ─────────────────────────────────────────────

/**
 * Génère le XML ePOS complet (contenu intérieur de <epos-print>)
 * pour un ticket de caisse professionnel avec :
 * - En-tête centré (nom, adresse, SIRET, TVA, tél)
 * - Mode de service (SUR PLACE / À EMPORTER) en inversé + double
 * - Métadonnées (date, heure, Numero commande, vendeur)
 * - Corps avec colonnes Qté / Désignation / P.U / TVA / Total
 * - Gestion des menus (options en retrait)
 * - Bloc totaux (HT, TTC gras double, paiement)
 * - Tableau TVA récapitulatif
 * - Pied de page
 */
export const generateCashTicketXml = (payload: TicketPayload): { xml: string; text: string } => {
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR');
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const orderType = payload.orderType ?? 'sur_place';
  const orderTypeLabel = orderType === 'a_emporter' ? 'A EMPORTER' : 'SUR PLACE';
  const ticketNum = payload.ticketNumber ?? now.getTime().toString().slice(-6);
  const customization = normalizeTicketCustomization(payload.ticketCustomization);
  const bannerFeed = customization.compactMode ? 1 : 2;
  const finalFeed = customization.compactMode ? 2 : 4;
  const headerLines = [
    customization.businessName,
    customization.businessAddress,
    customization.businessSiret,
    customization.businessTvaIntra,
    customization.businessPhone,
  ].filter(Boolean);

  const xmlParts: string[] = [];
  const textParts: string[] = []; // version texte brut pour archivage

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. EN-TÊTE
  // ═══════════════════════════════════════════════════════════════════════════
  if (customization.showLogo) {
    xmlParts.push(
      `<image align="center" width="${CLIENT_TICKET_LOGO.width}" height="${CLIENT_TICKET_LOGO.height}" mode="${CLIENT_TICKET_LOGO.mode}" color="color_1">${CLIENT_TICKET_LOGO.dataBase64}</image>`,
    );
    xmlParts.push(feed(1));
  }
  headerLines.forEach((headerLine, headerIndex) => {
    wrapText(headerLine, W).forEach((line, lineIndex) => {
      const isMainLine = headerIndex === 0 && lineIndex === 0;
      xmlParts.push(txt(line, {
        align: 'center',
        ...(isMainLine ? { dh: true } : {}),
        ...((isMainLine || customization.headerBold) ? { bold: true } : {}),
      }));
      textParts.push(centerStr(line, W));
    });
  });
  if (headerLines.length > 0) {
    xmlParts.push(txt('', { align: 'center' }));
    textParts.push('');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. MODE DE SERVICE
  // ═══════════════════════════════════════════════════════════════════════════
  // Le bandeau inversé en double-hauteur prend 2x l'espace vertical.
  // On ajoute un feed après pour ne pas chevaucher la ligne suivante.
  const serviceLabel = ` ${orderTypeLabel} `;
  xmlParts.push(txt(serviceLabel, { align: 'center', bold: true, dh: true, reverse: true }));
  xmlParts.push(feed(bannerFeed));

  textParts.push(centerStr(`*** ${orderTypeLabel} ***`, W), '');

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. MÉTADONNÉES
  // ═══════════════════════════════════════════════════════════════════════════
  const metaLines: string[] = [
    `Date: ${dateStr}  Heure: ${timeStr}`,
    `Commande ${ticketNum}`,
  ];
  if (customization.showTable && payload.tableLabel) {
    metaLines.push(`Table: ${payload.tableLabel}`);
  }
  if (customization.showSeller && payload.seller) {
    metaLines.push(`Vendeur: ${payload.seller}`);
  }

  const wrappedMetaLines = metaLines.flatMap((line) => wrapText(line, W));
  xmlParts.push(txtLines(wrappedMetaLines, { align: 'center' }));
  textParts.push(...wrappedMetaLines.map((line) => centerStr(line, W)));

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. CORPS DE COMMANDE
  // ═══════════════════════════════════════════════════════════════════════════
  xmlParts.push(txt(SEP, { align: 'left' }));
  xmlParts.push(txt(buildHeaderLine(), { align: 'left', bold: true }));
  xmlParts.push(txt(SEP, { align: 'left' }));

  textParts.push(SEP, buildHeaderLine(), SEP);

  const itemLines: string[] = [];

  payload.cartItems.forEach((item) => {
    const isMenu = item.kind === 'menu' && item.menuItems?.length;

    // Taux TVA : pour un menu, on prend la catégorie du produit principal
    const rate = isMenu
      ? taxRateForCategory(item.menuItems![0].product.category, orderType)
      : taxRateForCategory(item.product.category, orderType);
    const code = taxCodeForRate(rate);
    const lineTotal = item.product.price * item.quantity;
    const unitPrice = item.product.price;

    const displayName = isMenu ? 'Menu' : item.product.name;
    const lines = buildItemLines(item.quantity, displayName, unitPrice, code, lineTotal);
    lines.forEach((line) => {
      xmlParts.push(txt(line, { align: 'left' }));
      itemLines.push(line);
    });

    // Sous-éléments d'un menu (en retrait, sans prix)
    if (isMenu && item.menuItems) {
      item.menuItems.forEach((mi) => {
        wrapWithPrefix(`     x${item.quantity} `, mi.product.name, W).forEach((subLine) => {
          xmlParts.push(txt(subLine, { align: 'left' }));
          itemLines.push(subLine);
        });
      });
    }

    // Note spécifique à cet article
    if (item.note) {
      wrapWithPrefix('  NOTE MODIF: ', item.note, W).forEach((noteLine) => {
        xmlParts.push(txt(noteLine, { align: 'left', bold: true }));
        itemLines.push(noteLine);
      });
    }
  });

  textParts.push(...itemLines);

  xmlParts.push(txt(SEP, { align: 'left' }));
  textParts.push(SEP);

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. BLOC TOTAUX
  // ═══════════════════════════════════════════════════════════════════════════
  const totalHt = typeof payload.totalHt === 'number' ? payload.totalHt : payload.total / 1.1;
  const taxLines = payload.taxLines ?? [];

  // Total HT
  twoColWrapped('Total HT :', fmtCurrency(totalHt)).forEach((htLine) => {
    xmlParts.push(txt(htLine, { align: 'left' }));
    textParts.push(htLine);
  });

  // Détail TVA par taux (résumé inline)
  taxLines.forEach((tl) => {
    twoColWrapped(`  TVA ${(tl.rate * 100).toFixed(1)}% :`, fmtCurrency(tl.tax)).forEach((tvaLine) => {
      xmlParts.push(txt(tvaLine, { align: 'left' }));
      textParts.push(tvaLine);
    });
  });

  // Séparateur double
  xmlParts.push(txt(DOUBLE_SEP, { align: 'left' }));
  textParts.push(DOUBLE_SEP);

  // TOTAL TTC — gras + double hauteur
  twoColWrapped('TOTAL TTC :', fmtCurrency(payload.total)).forEach((ttcLine, idx) => {
    xmlParts.push(txt(ttcLine, { align: 'left', bold: true, ...(idx === 0 ? { dh: true } : {}) }));
    textParts.push(ttcLine);
  });

  // Séparateur double
  xmlParts.push(txt(DOUBLE_SEP, { align: 'left' }));
  textParts.push(DOUBLE_SEP);

  // Remise éventuelle
  if (payload.discountAmount && payload.discountAmount > 0) {
    twoColWrapped('Remise :', `-${fmtCurrency(payload.discountAmount)}`).forEach((discLine) => {
      xmlParts.push(txt(discLine, { align: 'left' }));
      textParts.push(discLine);
    });
  }

  // Majoration nuit éventuelle
  if (payload.surchargeAmount && payload.surchargeAmount > 0) {
    const surchargeLabel = payload.surchargePercent && payload.surchargePercent > 0
      ? `Majoration nuit (${fmtPercent(payload.surchargePercent)}) :`
      : 'Majoration nuit :';
    twoColWrapped(surchargeLabel, `+${fmtCurrency(payload.surchargeAmount)}`).forEach((surchLine) => {
      xmlParts.push(txt(surchLine, { align: 'left', bold: true }));
      textParts.push(surchLine);
    });
  }

  // Mode de paiement
  if (customization.showPaymentLine && !shouldHidePaymentLineForVoucherSurplus(payload.paymentMethod)) {
    twoColWrapped('Paiement :', paymentMethodLabel(payload.paymentMethod)).forEach((payLine) => {
      xmlParts.push(txt(payLine, { align: 'left', bold: true }));
      textParts.push(payLine);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. TABLEAU TVA RÉCAPITULATIF
  // ═══════════════════════════════════════════════════════════════════════════
  if (customization.showTaxTable && taxLines.length > 0) {
    xmlParts.push(txt('', {}));
    xmlParts.push(txt(SEP, { align: 'left' }));
    textParts.push('', SEP);

    // En-tête tableau TVA
    // Code  Taux   Base HT     TVA     TTC
    const taxHeader = `Code  Taux   Base HT     TVA     TTC`;
    xmlParts.push(txt(taxHeader, { align: 'left', bold: true }));
    textParts.push(taxHeader);

    xmlParts.push(txt(SEP, { align: 'left' }));
    textParts.push(SEP);

    taxLines.forEach((tl) => {
      const codePart = padR(tl.code, 4);
      const ratePart = padR(`${(tl.rate * 100).toFixed(1)}%`, 6);
      const basePart = padL(fmtPrice(tl.base), 8);
      const taxPart = padL(fmtPrice(tl.tax), 8);
      const ttcPart = padL(fmtPrice(tl.total), 8);
      const taxRowLine = `  ${codePart}${ratePart} ${basePart} ${taxPart} ${ttcPart}`;

      xmlParts.push(txt(taxRowLine, { align: 'left' }));
      textParts.push(taxRowLine);
    });

    xmlParts.push(txt(SEP, { align: 'left' }));
    textParts.push(SEP);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. PIED DE PAGE
  // ═══════════════════════════════════════════════════════════════════════════
  xmlParts.push(txt('', {}));

  // DUPLICATA conditionnel
  if (payload.isDuplicate) {
    xmlParts.push(txt('*** DUPLICATA ***', { align: 'center', bold: true, dh: true }));
    textParts.push('', '*** DUPLICATA ***');
  }

  if (customization.footerLine1) {
    xmlParts.push(txt(customization.footerLine1, {
      align: 'center',
      ...(customization.footerBold ? { bold: true } : {}),
    }));
    textParts.push('', customization.footerLine1);
  }

  if (customization.footerLine2) {
    xmlParts.push(txt(customization.footerLine2, {
      align: 'center',
      ...(customization.footerBold ? { bold: true } : {}),
    }));
    textParts.push(customization.footerLine2);
  }

  // Feed + coupe
  xmlParts.push(feed(finalFeed));
  xmlParts.push(cut());

  return {
    xml: xmlParts.join('\n'),
    text: textParts.map(toTicketAscii).join('\n'),
  };
};

// ── Ticket de salle (service / client) ──────────────────────────────────────

/**
 * Génère le XML ePOS pour un ticket de salle destiné au serveur / client.
 * Imprimé sur l'imprimante de caisse, il contient :
 * - Numéro de commande en gros (double hauteur + gras)
 * - Table, mode de service, heure, serveur
 * - Liste de TOUS les articles commandés (sans prix)
 * - Note éventuelle
 * Pas d'informations fiscales (SIRET, TVA détaillée, etc.)
 */
export const generateServiceTicketXml = (payload: TicketPayload): { xml: string; text: string } => {
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR');
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const orderType = payload.orderType ?? 'sur_place';
  const orderTypeLabel = orderType === 'a_emporter' ? 'A EMPORTER' : 'SUR PLACE';
  const ticketNum = payload.ticketNumber ?? now.getTime().toString().slice(-6);
  const customization = normalizeTicketCustomization(payload.ticketCustomization);
  const bannerFeed = customization.compactMode ? 1 : 2;
  const finalFeed = customization.compactMode ? 2 : 4;

  const xmlParts: string[] = [];
  const textParts: string[] = [];

  // ── Titre ──
  xmlParts.push(txt('BON PREPA SALLE', { align: 'center', bold: true, dh: true }));
  xmlParts.push(txt('', {}));
  textParts.push('BON PREPA SALLE', '');

  // ── Mode service (bandeau inversé) ──
  xmlParts.push(txt(` ${orderTypeLabel} `, { align: 'center', bold: true, dh: true, reverse: true }));
  xmlParts.push(feed(bannerFeed));
  textParts.push(centerStr(`*** ${orderTypeLabel} ***`, W), '');

  // ── Numéro commande bien visible ──
  const numLabel = `Commande ${ticketNum}`;
  xmlParts.push(txt(numLabel, { align: 'center', bold: true, dh: true, dw: true }));
  xmlParts.push(feed(1));
  textParts.push(centerStr(`>>> ${numLabel} <<<`, W), '');

  // ── Table (grosse si présente) ──
  if (customization.showTable && payload.tableLabel) {
    wrapText(`Table: ${payload.tableLabel}`, W).forEach((line, idx) => {
      xmlParts.push(txt(line, { align: 'center', bold: true, ...(idx === 0 ? { dh: true } : {}) }));
      textParts.push(centerStr(line, W));
    });
    xmlParts.push(feed(1));
    textParts.push('');
  }

  // ── Métadonnées ──
  const meta: string[] = [twoCol(`Date: ${dateStr}`, `Heure: ${timeStr}`)];
  if (customization.showSeller && payload.seller) {
    meta.push(`Serveur: ${payload.seller}`);
  }
  const wrappedMeta = meta.flatMap((line) => wrapText(line, W));
  xmlParts.push(txtLines(wrappedMeta, { align: 'left' }));
  textParts.push(...wrappedMeta);

  xmlParts.push(txt(SEP, { align: 'left' }));
  textParts.push(SEP);

  // ── Articles ── (uniquement ceux marqués sendToSalle)
  let hasSalleItems = false;
  payload.cartItems.forEach((item) => {
    const isMenu = item.kind === 'menu' && item.menuItems?.length;
    if (isMenu) {
      // Pour un menu, on affiche les sous-éléments marqués salle
      const salleSubItems = item.menuItems?.filter((mi) => mi.product.sendToSalle !== false) ?? [];
      if (salleSubItems.length > 0 || item.product.sendToSalle !== false) {
        hasSalleItems = true;
        wrapWithPrefix(`${item.quantity}x `, formatMenuDisplayName(item.product.name), W).forEach((menuLine) => {
          xmlParts.push(txt(menuLine, { align: 'left', bold: true }));
          textParts.push(menuLine);
        });

        salleSubItems.forEach((mi) => {
          wrapWithPrefix('   - ', mi.product.name, W).forEach((subLine) => {
            xmlParts.push(txt(subLine, { align: 'left' }));
            textParts.push(subLine);
          });
        });

        // Note spécifique à ce menu
        if (item.note) {
          wrapWithPrefix('  NOTE MODIF: ', item.note, W).forEach((noteLine) => {
            xmlParts.push(txt(noteLine, { align: 'left', bold: true }));
            textParts.push(noteLine);
          });
        }
      }
    } else if (item.product.sendToSalle !== false) {
      hasSalleItems = true;
      wrapWithPrefix(`${item.quantity}x `, item.product.name, W).forEach((line) => {
        xmlParts.push(txt(line, { align: 'left', bold: true }));
        textParts.push(line);
      });

      // Note spécifique à cet article
      if (item.note) {
        wrapWithPrefix('  NOTE MODIF: ', item.note, W).forEach((noteLine) => {
          xmlParts.push(txt(noteLine, { align: 'left', bold: true }));
          textParts.push(noteLine);
        });
      }
    }
  });

  if (!hasSalleItems) {
    return { xml: '', text: '' };
  }

  xmlParts.push(txt(SEP, { align: 'left' }));
  textParts.push(SEP);

  // ── Note ──
  if (payload.note) {
    wrapWithPrefix('NOTE: ', payload.note, W).forEach((line, idx) => {
      xmlParts.push(txt(line, { align: 'left', bold: true, ...(idx === 0 ? { dh: true } : {}) }));
      textParts.push(line);
    });
    xmlParts.push(txt('', {}));
    textParts.push('');
  }

  if (customization.footerLine1) {
    xmlParts.push(txt(customization.footerLine1, {
      align: 'center',
      ...(customization.footerBold ? { bold: true } : {}),
    }));
    textParts.push(customization.footerLine1);
  }
  if (customization.footerLine2) {
    xmlParts.push(txt(customization.footerLine2, {
      align: 'center',
      ...(customization.footerBold ? { bold: true } : {}),
    }));
    textParts.push(customization.footerLine2);
  }

  xmlParts.push(feed(finalFeed));
  xmlParts.push(cut());

  return {
    xml: xmlParts.join('\n'),
    text: textParts.map(toTicketAscii).join('\n'),
  };
};

// ── Ticket cuisine ──────────────────────────────────────────────────────────

export const generateKitchenTicketXml = (payload: TicketPayload): { xml: string; text: string } => {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const orderType = payload.orderType ?? 'sur_place';
  const orderTypeLabel = orderType === 'a_emporter' ? 'A EMPORTER' : 'SUR PLACE';
  const ticketNum = payload.ticketNumber ?? now.getTime().toString().slice(-6);
  const customization = normalizeTicketCustomization(payload.ticketCustomization);
  const bannerFeed = customization.compactMode ? 1 : 2;
  const finalFeed = customization.compactMode ? 2 : 4;

  const xmlParts: string[] = [];
  const textParts: string[] = [];

  // Titre
  xmlParts.push(txt('BON PREPA CUISINE', { align: 'center', bold: true, dh: true }));
  xmlParts.push(txt('', {}));
  textParts.push('BON PREPA CUISINE', '');

  // Mode service
  xmlParts.push(txt(` ${orderTypeLabel} `, { align: 'center', bold: true, dh: true, reverse: true }));
  // Double-height reverse banner occupies 2 vertical lines — add feed to avoid overlap
  xmlParts.push(feed(bannerFeed));
  textParts.push(centerStr(`*** ${orderTypeLabel} ***`, W), '');

  // Numero de commande pour faire le lien avec le ticket de salle
  const orderNumberLine = `Commande ${ticketNum}`;
  xmlParts.push(txt(orderNumberLine, { align: 'center', bold: true, dh: true, dw: true }));
  xmlParts.push(feed(1));
  textParts.push(orderNumberLine, '');

  // Métadonnées
  const meta: string[] = [`Heure: ${timeStr}`];
  if (customization.showTable && payload.tableLabel) {
    meta.push(`Table: ${payload.tableLabel}`);
  }
  if (customization.showSeller && payload.seller) {
    meta.push(`Vendeur: ${payload.seller}`);
  }

  const wrappedMeta = meta.flatMap((line) => wrapText(line, W));
  xmlParts.push(txtLines(wrappedMeta, { align: 'left' }));
  textParts.push(...wrappedMeta);

  xmlParts.push(txt(SEP, { align: 'left' }));
  textParts.push(SEP);

  // Articles cuisine
  let hasKitchenItems = false;
  payload.cartItems.forEach((item) => {
    if (item.kind === 'menu' && item.menuItems?.length) {
      // Pour un menu, on n'affiche que les articles cuisine (sans ligne "MENU")
      const kitchenSubs = item.menuItems.filter((mi) => isKitchenTicketProduct(mi.product));
      if (kitchenSubs.length > 0) {
        hasKitchenItems = true;
        kitchenSubs.forEach((mi) => {
          wrapWithPrefix(`${item.quantity}x `, kitchenItemLabel(mi.product), W).forEach((line) => {
            xmlParts.push(txt(line, { align: 'left', bold: true, dh: true }));
            textParts.push(line);
          });
        });

        // Note spécifique à ce menu
        if (item.note) {
          wrapWithPrefix('  NOTE MODIF: ', item.note, W).forEach((noteLine) => {
            xmlParts.push(txt(noteLine, { align: 'left', bold: true, dh: true }));
            textParts.push(noteLine);
          });
        }
      }
    } else if (isKitchenTicketProduct(item.product)) {
      hasKitchenItems = true;
      wrapWithPrefix(`${item.quantity}x `, kitchenItemLabel(item.product), W).forEach((line) => {
        xmlParts.push(txt(line, { align: 'left', bold: true, dh: true }));
        textParts.push(line);
      });

      // Note spécifique à cet article
      if (item.note) {
        wrapWithPrefix('  NOTE MODIF: ', item.note, W).forEach((noteLine) => {
          xmlParts.push(txt(noteLine, { align: 'left', bold: true, dh: true }));
          textParts.push(noteLine);
        });
      }
    }
  });

  if (!hasKitchenItems) {
    return { xml: '', text: '' };
  }

  xmlParts.push(txt(SEP, { align: 'left' }));
  textParts.push(SEP);

  if (customization.footerLine1) {
    xmlParts.push(txt(customization.footerLine1, {
      align: 'center',
      ...(customization.footerBold ? { bold: true } : {}),
    }));
    textParts.push(customization.footerLine1);
  }
  if (customization.footerLine2) {
    xmlParts.push(txt(customization.footerLine2, {
      align: 'center',
      ...(customization.footerBold ? { bold: true } : {}),
    }));
    textParts.push(customization.footerLine2);
  }

  xmlParts.push(feed(finalFeed));
  xmlParts.push(cut());

  return {
    xml: xmlParts.join('\n'),
    text: textParts.map(toTicketAscii).join('\n'),
  };
};
