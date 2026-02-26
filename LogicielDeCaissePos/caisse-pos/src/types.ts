export type Role = 'staff' | 'admin';

export type UserSession = {
  username: string;
  role: Role;
};

export type ProductCategory = 'burgers' | 'snacks' | 'desserts' | 'boissons' | 'accompagnements' | 'sauces';

export type Product = {
  id: string;
  slug?: string;
  name: string;
  price: number;
  menuPrice?: number;
  category: ProductCategory;
  sendToKitchen: boolean;
  sendToSalle: boolean;
  active: boolean;
  imageKey?: string;
  /** Extra cost when chosen as a menu side (e.g. +1€ for Cheesy) */
  menuSupplement?: number;
};

export type SeedProduct = {
  slug: string;
  name: string;
  price: number;
  menuPrice?: number;
  category: ProductCategory;
  sendToKitchen: boolean;
  sendToSalle?: boolean;
  active: boolean;
  imageKey?: string;
  menuSupplement?: number;
};

export type UploadedProduct = {
  name: string;
  price: number;
  menuPrice?: number;
  category: ProductCategory;
  sendToKitchen?: boolean;
  sendToSalle?: boolean;
  active?: boolean;
  imageKey?: string;
};

export type MenuItemRole = 'main' | 'side' | 'drink' | 'dessert' | 'sauce' | 'toy';

export type MenuItemSelection = {
  role: MenuItemRole;
  product: Product;
};

export type CartItemKind = 'product' | 'menu';

export type MenuFlowType = 'menu_burgers' | 'menu_tex_mex' | 'menu_edition_limitee' | 'menu_kids';

/** Mode de consommation – détermine les taux de TVA applicables */
export type OrderType = 'sur_place' | 'a_emporter';

export type CartItem = {
  lineId: string;
  product: Product;
  quantity: number;
  kind?: CartItemKind;
  menuItems?: MenuItemSelection[];
  menuType?: MenuFlowType;
  /** Note spécifique à cet article (ex: "sans sauce", "bien cuit") */
  note?: string;
};

export type PrintMode = 'network_dual' | 'usb_single';

export type PrinterSettings = {
  printMode: PrintMode;
  cashPrinterUrl: string;
  kitchenPrinterUrl: string;
  usbPrinterId: string;
  usbPrinterName: string;
  serviceTicketEnabled: boolean;
  /** Pourcentage de majoration nuit (0 = désactivé) */
  nightSurchargePercent: number;
};

export type DailyStats = {
  ordersCount: number;
  revenue: number;
};

export type OrderStatus = 'sale' | 'cancel' | 'refund';

export type OrderToSave = {
  /** Reserved legal ticket number (must match printed ticket number) */
  ticketNumber?: number;
  userRole: Role;
  userName: string;
  items: CartItem[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  paymentMethod: string;
  tableLabel: string;
  note: string;
  orderType: OrderType;
  cashTicketText?: string;
  kitchenTicketText?: string;
  orderStatus?: OrderStatus;
  statusReason?: string;
  originalOrderId?: number;
  isCopy?: boolean;
};

export type SaveOrderResult = {
  id: number;
  ticketNumber: number;
};

export type StoredTicket = {
  id: number;
  ticketNumber: number;
  createdAt: string;
  items: CartItem[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  paymentMethod: string;
  tableLabel?: string;
  note?: string;
  orderType?: OrderType;
  cashTicketText?: string;
  kitchenTicketText?: string;
  orderStatus: OrderStatus;
  statusReason?: string;
  originalOrderId?: number;
  isCopy: boolean;
  previousHash?: string;
  entryHash?: string;
};

export type TaxLine = {
  code: string;
  rate: number;
  base: number;
  tax: number;
  total: number;
};

export type TaxBreakdownLine = {
  rate: number;
  ht: number;
  tva: number;
  ttc: number;
};

export type ClosureSnapshot = {
  periodStart: string;
  periodEnd: string;
  ordersCount: number;
  revenue: number;
  paymentBreakdown: Record<string, number>;
  lastTicketNumber: number;
  taxBreakdown?: TaxBreakdownLine[];
};

export type ClosureRecord = ClosureSnapshot & {
  id: number;
  closedAt: string;
  closedBy: string;
  previousSignatureHash?: string;
  signatureHash: string;
};

export type AuditIssue = {
  scope: 'orders' | 'closures';
  id: number;
  message: string;
};

export type AuditReport = {
  checkedAt: string;
  ordersChecked: number;
  closuresChecked: number;
  strictSequenceOk: boolean;
  orderChainOk: boolean;
  closureChainOk: boolean;
  issues: AuditIssue[];
};

export type LegalArchiveTicket = {
  id: number;
  ticketNumber: number;
  createdAt: string;
  userRole: string;
  userName: string;
  itemsJson: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  paymentMethod: string;
  orderStatus: string;
  statusReason?: string;
  originalOrderId?: number;
  isCopy: boolean;
  tableLabel?: string;
  note?: string;
  previousHash?: string;
  entryHash?: string;
};

export type LegalClosureArchive = {
  schemaVersion: string;
  generatedAt: string;
  hashAlgorithm: 'SHA-256';
  closure: ClosureRecord;
  tickets: LegalArchiveTicket[];
  auditReport: AuditReport;
  archiveHash: string;
};

export type LegalArchiveVerification = {
  checkedAt: string;
  isValid: boolean;
  expectedHash: string;
  computedHash: string;
  schemaVersion?: string;
  closureId?: number;
  reason?: string;
};

export type PrintJobChannel = 'cash' | 'kitchen' | 'service' | 'report' | 'test';

export type PrintJobStatus = 'pending' | 'processing' | 'printed' | 'failed';

export type PrintJobRecord = {
  id: number;
  createdAt: string;
  updatedAt: string;
  orderId?: number;
  ticketNumber?: number;
  channel: PrintJobChannel;
  printerUrl: string;
  requestXml: string;
  ticketText?: string;
  idempotencyKey: string;
  status: PrintJobStatus;
  attemptCount: number;
  maxAttempts: number;
  lastError?: string;
  lastAttemptAt?: string;
};

export type CreatePrintJobInput = {
  orderId?: number;
  ticketNumber?: number;
  channel: PrintJobChannel;
  printerUrl: string;
  requestXml: string;
  ticketText?: string;
  idempotencyKey: string;
  maxAttempts?: number;
};
