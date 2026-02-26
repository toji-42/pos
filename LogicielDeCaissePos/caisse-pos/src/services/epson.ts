import { CartItem, ClosureSnapshot, OrderType, PrinterSettings, TaxLine } from '../types';
import { generateCashTicketXml, generateKitchenTicketXml, generateServiceTicketXml } from './ticketBuilder';
import { isUsbPrinterUrl, openUsbDrawerByUrl, printUsbTestByUrl, printUsbTicketByUrl } from './usbPrinter';

export type PrintResult = {
  ok: boolean;
  message: string;
  ticketText?: string;
};

export type PrintPayload = {
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
};

export type EpsonDiscoveryItem = {
  ip: string;
  url: string;
};

type EpsonDiscoveryOptions = {
  subnet: string;
  start?: number;
  end?: number;
  chunkSize?: number;
  timeoutMs?: number;
};

export type EpsonSendOptions = {
  idempotencyKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export type PreparedPrintJob = {
  channel: 'cash' | 'kitchen' | 'service' | 'report' | 'test';
  printerUrl: string;
  xml: string;
  ticketText: string;
};

type SendAttemptResult = {
  ok: boolean;
  message: string;
  retryable: boolean;
};

const DEFAULT_PRINT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RETRIES = 0;

const paymentMethodLabel = (value?: string) => {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return 'Non précisé';
  if (normalized === 'carte') return 'Carte';
  if (normalized === 'cb borne' || normalized === 'cb restaurant' || normalized === 'titre restaurant cb') {
    return 'CB Restaurant';
  }
  if (normalized === 'especes' || normalized === 'espèces') return 'Espèces';
  if (normalized === 'chèque vacances' || normalized === 'cheque vacances') return 'Chèque Vacances';
  return value as string;
};

const isKitchenTicketProduct = (item: CartItem['product']) =>
  item.sendToKitchen && (item.category === 'burgers' || item.category === 'snacks');

const buildKitchenItems = (payload: PrintPayload) =>
  payload.cartItems.flatMap((item) => {
    if (item.kind === 'menu' && item.menuItems?.length) {
      return item.menuItems
        .filter((mi) => isKitchenTicketProduct(mi.product))
        .map((mi) => `${item.quantity} x ${mi.product.name}`);
    }
    if (isKitchenTicketProduct(item.product)) {
      return [`${item.quantity} x ${item.product.name}`];
    }
    return [] as string[];
  });

const escapeXml = (value: string) =>
  value
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

const buildEposXml = (lines: string[], title?: string) => {
  const mergedLines = [...(title ? [title] : []), ...lines, ''].map(toTicketAscii).join('\n');
  return `
<text align="center" smooth="true"/>
<text>${escapeXml(mergedLines)}</text>
<feed line="3"/>
<cut type="feed"/>`;
};

const normalizePrinterUrl = (printerUrl: string) => printerUrl.trim().replace(/\/+$/, '');

export const buildEpsonEndpoint = (printerUrl: string) => {
  const normalized = normalizePrinterUrl(printerUrl);
  if (normalized.includes('cgi-bin/epos/service.cgi')) {
    return normalized;
  }
  return `${normalized}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;
};

export const buildEpsonEnvelope = (printXml: string) => `
<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
      ${printXml}
    </epos-print>
  </s:Body>
</s:Envelope>`;

const withTimeout = async (url: string, timeoutMs: number) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method: 'GET', signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const looksLikeEpsonEndpoint = (status: number, body: string, serverHeader: string) => {
  const bodyHint = /(epson|epos|tm-[a-z0-9-]+)/i.test(body);
  const serverHint = /(epson|epos)/i.test(serverHeader);
  if (bodyHint || serverHint) return true;
  if ((status === 401 || status === 403 || status === 405) && serverHint) return true;
  return false;
};

const probeEpsonIp = async (ip: string, timeoutMs: number): Promise<EpsonDiscoveryItem | null> => {
  const baseUrl = `http://${ip}`;
  const endpoint = buildEpsonEndpoint(baseUrl);

  try {
    const endpointResponse = await withTimeout(endpoint, timeoutMs);
    const endpointBody = (await endpointResponse.text()).slice(0, 1200);
    const endpointServer = endpointResponse.headers.get('server') ?? '';
    if (looksLikeEpsonEndpoint(endpointResponse.status, endpointBody, endpointServer)) {
      return { ip, url: baseUrl };
    }
  } catch {
    // fallback on root probe below
  }

  try {
    const rootResponse = await withTimeout(baseUrl, timeoutMs);
    const rootBody = (await rootResponse.text()).slice(0, 1200);
    const rootServer = rootResponse.headers.get('server') ?? '';
    if (looksLikeEpsonEndpoint(rootResponse.status, rootBody, rootServer)) {
      return { ip, url: baseUrl };
    }
  } catch {
    // ignore unreachable hosts
  }

  return null;
};

export const discoverEpsonPrinters = async ({
  subnet,
  start = 1,
  end = 254,
  chunkSize = 20,
  timeoutMs = 900,
}: EpsonDiscoveryOptions): Promise<EpsonDiscoveryItem[]> => {
  const normalizedSubnet = subnet.trim().replace(/\.$/, '');
  const octets = normalizedSubnet.split('.');
  if (octets.length !== 3 || octets.some((part) => !/^\d+$/.test(part) || Number(part) < 0 || Number(part) > 255)) {
    return [];
  }

  const safeStart = Math.max(1, Math.min(254, start));
  const safeEnd = Math.max(safeStart, Math.min(254, end));
  const discovered = new Map<string, EpsonDiscoveryItem>();

  for (let cursor = safeStart; cursor <= safeEnd; cursor += Math.max(1, chunkSize)) {
    const batchEnd = Math.min(safeEnd, cursor + Math.max(1, chunkSize) - 1);
    const batchIps = Array.from({ length: batchEnd - cursor + 1 }, (_, idx) => `${normalizedSubnet}.${cursor + idx}`);
    const batchResults = await Promise.all(batchIps.map((ip) => probeEpsonIp(ip, timeoutMs)));
    for (const item of batchResults) {
      if (item) discovered.set(item.ip, item);
    }
  }

  return Array.from(discovered.values()).sort((a, b) =>
    a.ip.localeCompare(b.ip, undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
  );
};

const parseEpsonResponse = (xml: string): SendAttemptResult => {
  const responseTag = xml.match(/<response\b[^>]*>/i)?.[0];
  if (!responseTag) {
    return {
      ok: false,
      message: 'Réponse imprimante invalide.',
      retryable: false,
    };
  }

  const successMatch = responseTag.match(/\bsuccess\s*=\s*"(true|false)"/i);
  if (!successMatch) {
    return {
      ok: false,
      message: 'Réponse imprimante incomplète.',
      retryable: false,
    };
  }

  const isSuccess = successMatch[1].toLowerCase() === 'true';
  if (isSuccess) {
    return { ok: true, message: 'Impression confirmée par le service.', retryable: false };
  }

  const codeMatch = responseTag.match(/\bcode\s*=\s*"([^"]*)"/i);
  const statusMatch = responseTag.match(/\bstatus\s*=\s*"([^"]*)"/i);
  const details = [codeMatch?.[1], statusMatch?.[1]].filter(Boolean).join(', ');
  return {
    ok: false,
    message: details ? `Imprimante Epson: échec (${details}).` : 'Imprimante Epson: échec retourné par le service.',
    retryable: false,
  };
};

const sendToEpsonOnce = async (
  endpoint: string,
  body: string,
  options: EpsonSendOptions,
): Promise<SendAttemptResult> => {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_PRINT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    'Content-Type': 'text/xml; charset=utf-8',
    Accept: 'text/xml, application/xml;q=0.9, */*;q=0.1',
  };
  if (options.idempotencyKey?.trim()) headers['X-Print-Request-Id'] = options.idempotencyKey.trim();

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    const responseText = await response.text();
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || (response.status >= 500 && response.status < 600);
      return {
        ok: false,
        message: `Erreur imprimante (${response.status}).`,
        retryable,
      };
    }

    return parseEpsonResponse(responseText);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        ok: false,
        message: `Imprimante injoignable (timeout ${Math.round(timeoutMs / 1000)}s).`,
        retryable: true,
      };
    }
    return {
      ok: false,
      message: 'Impossible de contacter l\'imprimante Epson.',
      retryable: true,
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

export const sendRawEpsonXml = async (
  printerUrl: string,
  printXml: string,
  options: EpsonSendOptions = {},
): Promise<PrintResult> => {
  if (!printerUrl.trim()) {
    return { ok: false, message: 'URL imprimante non configurée.' };
  }

  const endpoint = buildEpsonEndpoint(printerUrl);
  const body = buildEpsonEnvelope(printXml);
  const retries = Math.max(0, Math.min(3, options.maxRetries ?? DEFAULT_MAX_RETRIES));

  let lastResult: SendAttemptResult = { ok: false, message: 'Erreur impression.', retryable: false };
  for (let attempt = 0; attempt <= retries; attempt++) {
    lastResult = await sendToEpsonOnce(endpoint, body, options);
    if (lastResult.ok) {
      return { ok: true, message: lastResult.message };
    }
    if (!lastResult.retryable || attempt === retries) {
      return { ok: false, message: lastResult.message };
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  return { ok: false, message: lastResult.message };
};

const sendTicketToConfiguredPrinter = async (
  printerUrl: string,
  requestXml: string,
  ticketText: string,
  options: EpsonSendOptions = {},
): Promise<PrintResult> => {
  if (isUsbPrinterUrl(printerUrl)) {
    const usbResult = await printUsbTicketByUrl(printerUrl, ticketText, { cut: true });
    return {
      ok: usbResult.ok,
      message: usbResult.message,
      ticketText,
    };
  }

  const networkResult = await sendRawEpsonXml(printerUrl, requestXml, options);
  return {
    ...networkResult,
    ticketText,
  };
};

export const sendPreparedPrintJob = async (
  printerUrl: string,
  requestXml: string,
  ticketText?: string,
  options: EpsonSendOptions = {},
): Promise<PrintResult> => {
  return sendTicketToConfiguredPrinter(printerUrl, requestXml, ticketText ?? '', options);
};

export const buildCashTicketDocument = (payload: PrintPayload): PreparedPrintJob => {
  const { xml, text } = generateCashTicketXml({
    cartItems: payload.cartItems,
    tableLabel: payload.tableLabel,
    note: payload.note,
    total: payload.total,
    paymentMethod: payload.paymentMethod,
    seller: payload.seller,
    taxLines: payload.taxLines,
    totalHt: payload.totalHt,
    discountAmount: payload.discountAmount,
    surchargeAmount: payload.surchargeAmount,
    surchargePercent: payload.surchargePercent,
    orderType: payload.orderType,
    ticketNumber: payload.ticketNumber,
    isDuplicate: payload.isDuplicate,
  });
  return { channel: 'cash', printerUrl: '', xml, ticketText: text };
};

export const buildServiceTicketDocument = (payload: PrintPayload): PreparedPrintJob | null => {
  const { xml, text } = generateServiceTicketXml({
    cartItems: payload.cartItems,
    tableLabel: payload.tableLabel,
    note: payload.note,
    total: payload.total,
    paymentMethod: payload.paymentMethod,
    seller: payload.seller,
    taxLines: payload.taxLines,
    totalHt: payload.totalHt,
    discountAmount: payload.discountAmount,
    surchargeAmount: payload.surchargeAmount,
    surchargePercent: payload.surchargePercent,
    orderType: payload.orderType,
    ticketNumber: payload.ticketNumber,
  });
  if (!xml) return null;
  return { channel: 'service', printerUrl: '', xml, ticketText: text };
};

export const buildKitchenTicketDocuments = (
  settings: PrinterSettings,
  payload: PrintPayload,
): PreparedPrintJob[] => {
  const printerUrl = settings.kitchenPrinterUrl.trim();
  if (!printerUrl) return [];

  const { xml, text } = generateKitchenTicketXml({
    cartItems: payload.cartItems,
    tableLabel: payload.tableLabel,
    note: payload.note,
    total: payload.total,
    paymentMethod: payload.paymentMethod,
    seller: payload.seller,
    taxLines: payload.taxLines,
    totalHt: payload.totalHt,
    discountAmount: payload.discountAmount,
    orderType: payload.orderType,
    ticketNumber: payload.ticketNumber,
  });
  if (!xml.trim()) return [];
  return [{ channel: 'kitchen', printerUrl, xml, ticketText: text }];
};

export const printCashTicket = async (
  settings: PrinterSettings,
  payload: PrintPayload,
  options: EpsonSendOptions = {},
): Promise<PrintResult> => {
  const doc = buildCashTicketDocument(payload);
  return sendTicketToConfiguredPrinter(settings.cashPrinterUrl, doc.xml, doc.ticketText, options);
};

export const printKitchenTicket = async (
  settings: PrinterSettings,
  payload: PrintPayload,
  options: EpsonSendOptions = {},
): Promise<PrintResult> => {
  const kitchenDocs = buildKitchenTicketDocuments(settings, payload);
  if (!kitchenDocs.length) {
    return { ok: true, message: 'Aucun article cuisine à imprimer.' };
  }

  const results = await Promise.all(
    kitchenDocs.map((doc, index) =>
      sendTicketToConfiguredPrinter(doc.printerUrl, doc.xml, doc.ticketText, {
        ...options,
        idempotencyKey: options.idempotencyKey ? `${options.idempotencyKey}#${index + 1}` : undefined,
      }),
    ),
  );

  const failed = results.filter((r) => !r.ok);
  const ticketText = kitchenDocs.map((doc) => doc.ticketText).join('\n\n');

  if (!failed.length) {
    return {
      ok: true,
      message: kitchenDocs.length > 1
        ? `Impression cuisine envoyée sur ${kitchenDocs.length} imprimantes.`
        : 'Impression cuisine envoyée.',
      ticketText,
    };
  }

  return {
    ok: false,
    message: failed.map((f) => f.message).join(' | '),
    ticketText,
  };
};

export const printServiceTicket = async (
  settings: PrinterSettings,
  payload: PrintPayload,
  options: EpsonSendOptions = {},
): Promise<PrintResult> => {
  const doc = buildServiceTicketDocument(payload);
  if (!doc) {
    return { ok: true, message: 'Aucun article salle à imprimer.' };
  }
  return sendTicketToConfiguredPrinter(settings.cashPrinterUrl, doc.xml, doc.ticketText, options);
};

export const buildKitchenTicketText = (payload: PrintPayload) => {
  const kitchenItems = buildKitchenItems(payload);
  if (!kitchenItems.length) return 'Aucun article cuisine à imprimer.';
  const ticketNumber = payload.ticketNumber ? `Commande ${payload.ticketNumber}` : '';
  return [
    ticketNumber,
    payload.tableLabel ? `Table: ${payload.tableLabel}` : '',
    `Heure: ${new Date().toLocaleTimeString('fr-FR')}`,
    ...kitchenItems,
    payload.note ? `Note: ${payload.note}` : '',
    `Serveur: ${payload.seller}`,
  ]
    .filter(Boolean)
    .join('\n');
};

export const printTestTicket = async (
  printerUrl: string,
  label: string,
  options: EpsonSendOptions = {},
): Promise<PrintResult> => {
  if (isUsbPrinterUrl(printerUrl)) {
    const usbResult = await printUsbTestByUrl(printerUrl, label);
    return { ok: usbResult.ok, message: usbResult.message };
  }
  const now = new Date();
  const lines = [
    'TEST IMPRESSION',
    label,
    `Date: ${now.toLocaleDateString('fr-FR')} ${now.toLocaleTimeString('fr-FR')}`,
    'Connexion Epson OK',
  ];
  const xml = buildEposXml(lines, 'TEST');
  const result = await sendTicketToConfiguredPrinter(printerUrl, xml, lines.join('\n'), options);
  return { ...result, ticketText: lines.join('\n') };
};

const buildOpenDrawerXml = () => '<pulse drawer="drawer_1" time="100"/>';

export const openCashDrawer = async (
  printerUrl: string,
  options: EpsonSendOptions = {},
): Promise<PrintResult> => {
  const normalized = printerUrl.trim();
  if (!normalized) {
    return { ok: false, message: 'Imprimante caisse non configurée.' };
  }

  if (isUsbPrinterUrl(normalized)) {
    const usbResult = await openUsbDrawerByUrl(normalized);
    return {
      ok: usbResult.ok,
      message: usbResult.ok ? 'Tiroir USB déclenché.' : usbResult.message,
    };
  }

  const networkResult = await sendRawEpsonXml(normalized, buildOpenDrawerXml(), options);
  return {
    ok: networkResult.ok,
    message: networkResult.ok ? 'Tiroir réseau déclenché.' : networkResult.message,
  };
};

export const printDailyReport = async (
  settings: PrinterSettings,
  closure: ClosureSnapshot & { closedBy?: string; openedAt?: string },
  options: EpsonSendOptions = {},
): Promise<PrintResult> => {
  const PW = 32;
  const SEP32 = '*'.repeat(PW);
  const center32 = (s: string) => {
    if (s.length >= PW) return s;
    const left = Math.floor((PW - s.length) / 2);
    return ' '.repeat(left) + s;
  };
  const lr32 = (left: string, right: string) => {
    const gap = PW - left.length - right.length;
    return gap > 0 ? left + ' '.repeat(gap) + right : `${left} ${right}`;
  };
  const fmtDt = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'N/A';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `le ${dd}/${mm}/${yy} à ${hh}:${min}`;
  };
  const normalizeForCompare = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’]/g, "'")
      .toLowerCase()
      .trim();
  const classifyPaymentMethod = (label: string): 'cb' | 'especes' | 'trCarte' | 'ticketRestau' | 'chequeVacances' | 'autres' => {
    const normalized = normalizeForCompare(label);
    if (!normalized) return 'autres';
    if (normalized.includes('ticket restaurant') || normalized.includes('ticket restau')) return 'ticketRestau';
    if (
      normalized.includes('cheque vacance') ||
      normalized.includes('cheques vacances') ||
      normalized.includes('cheque-vacances') ||
      normalized.includes('ancv')
    ) {
      return 'chequeVacances';
    }
    if (
      normalized.includes('tr cb') ||
      normalized.includes('tr carte') ||
      normalized.includes('titre restaurant cb') ||
      normalized.includes('cb restaurant') ||
      normalized.includes('cb borne')
    ) {
      return 'trCarte';
    }
    if (normalized.includes('especes')) return 'especes';
    if (normalized === 'cb' || normalized.startsWith('cb ') || normalized.includes('carte')) return 'cb';
    return 'autres';
  };

  const now = new Date();
  const lines: string[] = [];

  lines.push(center32('BURGER S DECINES'));
  lines.push(center32('19 AVENUE FRANKLIN ROOSEVELT'));
  lines.push(center32('69150 DECINES-CHARPIEU'));
  lines.push(SEP32);
  lines.push(center32('Flash journée'));
  lines.push(SEP32);

  lines.push(`Imprimé  : ${fmtDt(now.toISOString())}`);
  if (closure.closedBy) lines.push(`Par      : ${closure.closedBy}`);
  lines.push(`Ouverture: ${fmtDt(closure.openedAt ?? closure.periodStart)}`);
  lines.push(`Clôture  : ${fmtDt(closure.periodEnd)}`);
  lines.push(SEP32);

  lines.push('Informations generales :');
  lines.push(lr32('Tickets      :', String(closure.ordersCount)));
  lines.push(SEP32);

  lines.push(center32('Detail reglements'));
  lines.push(SEP32);

  const breakdown = closure.paymentBreakdown ?? {};
  const agg: Record<string, number> = {};
  for (const [rawKey, totalAmount] of Object.entries(breakdown)) {
    const parts = rawKey.split(' / ');
    if (parts.length > 1) {
      for (const part of parts) {
        const match = part.match(/^(.+?)\s+([\d.,]+)\s*€?$/);
        if (!match) continue;
        const method = match[1].trim();
        const amount = parseFloat(match[2].replace(',', '.')) || 0;
        agg[method] = Number(((agg[method] ?? 0) + amount).toFixed(2));
      }
      continue;
    }
    const method = paymentMethodLabel(rawKey);
    agg[method] = Number(((agg[method] ?? 0) + totalAmount).toFixed(2));
  }

  const detailTotals = {
    cb: 0,
    especes: 0,
    trCarte: 0,
    ticketRestau: 0,
    chequeVacances: 0,
    autres: 0,
  };
  for (const [method, amount] of Object.entries(agg)) {
    const key = classifyPaymentMethod(method);
    detailTotals[key] = Number((detailTotals[key] + amount).toFixed(2));
  }
  const payTotal = Object.values(detailTotals).reduce((sum, value) => sum + value, 0);

  lines.push(lr32('CB :', `${detailTotals.cb.toFixed(2)}€`));
  lines.push(lr32('Especes :', `${detailTotals.especes.toFixed(2)}€`));
  lines.push(lr32('TR carte :', `${detailTotals.trCarte.toFixed(2)}€`));
  lines.push(lr32('Ticket restau :', `${detailTotals.ticketRestau.toFixed(2)}€`));
  lines.push(lr32('Cheque vacances :', `${detailTotals.chequeVacances.toFixed(2)}€`));
  if (detailTotals.autres > 0) {
    lines.push(lr32('Autres :', `${detailTotals.autres.toFixed(2)}€`));
  }
  lines.push(lr32('TOTAL :', `${payTotal.toFixed(2)}€`));
  lines.push(SEP32);

  const xml = buildEposXml(lines, '');
  const asciiText = lines.map(toTicketAscii).join('\n');
  return sendTicketToConfiguredPrinter(settings.cashPrinterUrl, xml, asciiText, options);
};
