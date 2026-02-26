import { NativeModules, Platform } from 'react-native';

export const USB_PRINTER_URL_PREFIX = 'usb://';

export type UsbPrinterDevice = {
  deviceId: number;
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  serialNumber?: string;
  deviceClass: number;
  deviceSubclass: number;
  interfaceCount: number;
};

export type UsbPermissionResult = {
  granted: boolean;
  message: string;
};

export type UsbPrintResult = {
  ok: boolean;
  message: string;
};

type NativeUsbPrinterModule = {
  listDevices: () => Promise<UsbPrinterDevice[]>;
  requestPermission: (deviceId: number) => Promise<UsbPermissionResult>;
  printText: (deviceId: number, text: string, cut?: boolean) => Promise<UsbPrintResult>;
  testPrint: (deviceId: number, label: string) => Promise<UsbPrintResult>;
  openDrawer: (deviceId: number) => Promise<UsbPrintResult>;
};

const usbModule = NativeModules.UsbPrinterModule as NativeUsbPrinterModule | undefined;

export const isUsbPrinterSupported = () => Platform.OS === 'android' && Boolean(usbModule);

export const isUsbPrinterUrl = (value: string) =>
  value.trim().toLowerCase().startsWith(USB_PRINTER_URL_PREFIX);

export const buildUsbPrinterUrl = (deviceId: string | number | null | undefined) => {
  const normalized = String(deviceId ?? '').trim();
  if (!normalized) return '';
  return `${USB_PRINTER_URL_PREFIX}${normalized}`;
};

export const extractUsbDeviceId = (printerUrl: string): number | null => {
  if (!isUsbPrinterUrl(printerUrl)) return null;
  const raw = printerUrl.trim().slice(USB_PRINTER_URL_PREFIX.length).trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

export const listUsbPrinterDevices = async (): Promise<UsbPrinterDevice[]> => {
  if (!isUsbPrinterSupported() || !usbModule) return [];
  try {
    const list = await usbModule.listDevices();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

export const requestUsbPrinterPermission = async (
  deviceId: number,
): Promise<UsbPermissionResult> => {
  if (!isUsbPrinterSupported() || !usbModule) {
    return {
      granted: false,
      message: 'Module USB indisponible (utiliser un build natif Android).',
    };
  }
  try {
    return await usbModule.requestPermission(deviceId);
  } catch {
    return { granted: false, message: 'Permission USB refusée.' };
  }
};

export const printUsbTicketByUrl = async (
  printerUrl: string,
  ticketText: string,
  options?: { cut?: boolean },
): Promise<UsbPrintResult> => {
  const deviceId = extractUsbDeviceId(printerUrl);
  if (deviceId === null) {
    return { ok: false, message: 'URL imprimante USB invalide.' };
  }
  const content = ticketText.trim();
  if (!content) {
    return { ok: false, message: 'Ticket vide pour impression USB.' };
  }
  if (!isUsbPrinterSupported() || !usbModule) {
    return {
      ok: false,
      message: 'Module USB indisponible (utiliser un build natif Android).',
    };
  }

  const permission = await requestUsbPrinterPermission(deviceId);
  if (!permission.granted) {
    return { ok: false, message: permission.message || 'Permission USB refusée.' };
  }

  try {
    return await usbModule.printText(deviceId, content, options?.cut ?? true);
  } catch {
    return { ok: false, message: 'Échec impression USB.' };
  }
};

export const printUsbTestByUrl = async (
  printerUrl: string,
  label: string,
): Promise<UsbPrintResult> => {
  const deviceId = extractUsbDeviceId(printerUrl);
  if (deviceId === null) {
    return { ok: false, message: 'URL imprimante USB invalide.' };
  }
  if (!isUsbPrinterSupported() || !usbModule) {
    return {
      ok: false,
      message: 'Module USB indisponible (utiliser un build natif Android).',
    };
  }

  const permission = await requestUsbPrinterPermission(deviceId);
  if (!permission.granted) {
    return { ok: false, message: permission.message || 'Permission USB refusée.' };
  }

  try {
    return await usbModule.testPrint(deviceId, label);
  } catch {
    return { ok: false, message: 'Échec test impression USB.' };
  }
};

export const openUsbDrawerByUrl = async (printerUrl: string): Promise<UsbPrintResult> => {
  const deviceId = extractUsbDeviceId(printerUrl);
  if (deviceId === null) {
    return { ok: false, message: 'URL imprimante USB invalide.' };
  }
  if (!isUsbPrinterSupported() || !usbModule || typeof usbModule.openDrawer !== 'function') {
    return {
      ok: false,
      message: 'Module USB indisponible pour ouverture tiroir.',
    };
  }

  const permission = await requestUsbPrinterPermission(deviceId);
  if (!permission.granted) {
    return { ok: false, message: permission.message || 'Permission USB refusée.' };
  }

  try {
    return await usbModule.openDrawer(deviceId);
  } catch {
    return { ok: false, message: 'Échec ouverture tiroir USB.' };
  }
};
