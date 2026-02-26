console.log('[APP] ===== Module loading start =====');
import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import * as Network from 'expo-network';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  BackHandler,
  Linking,
  useWindowDimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Modal,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { authenticateByCode, applyUserPins, getUsernames } from './src/auth/users';
import { MENU_PRICES_BY_SLUG } from './src/data/menuPrices';
import {
  buildLegalClosureArchive,
  runIntegrityAudit,
  restoreDatabaseFromBackup,
  verifyLegalClosureArchive,
  buildCurrentPeriodCsv,
  closeCurrentZPeriod,
  createProduct,
  deleteAllTickets,
  deleteProduct,
  getCurrentXSnapshot,
  getRecentClosures,
  getPrinterSettings,
  getProducts,
  getRecentTickets,
  getFlashReportStats,
  getTodayStats,
  getWeeklyStats,
  initDatabase,
  saveOrder,
  savePrinterSettings,
  saveUserPin,
  loadUserPins,
  setProductActive,
  updateProduct,
} from './src/data/database';
import {
  buildKitchenTicketText,
  discoverEpsonPrinters,
  EpsonDiscoveryItem,
  printCashTicket,
  printFlashReport,
  printKitchenTicket,
  printTestTicket,
} from './src/services/epson';
import {
  AuditReport,
  CartItem,
  ClosureRecord,
  ClosureSnapshot,
  DailyStats,
  LegalArchiveVerification,
  OrderStatus,
  OrderType,
  PrinterSettings,
  Product,
  ProductCategory,
  TaxLine,
  StoredTicket,
  UserSession,
} from './src/types';

const COLORS = {
  background: '#030303',
  card: '#0A0A0A',
  cardSoft: '#111111',
  accent: '#39FF5A',
  accentSoft: '#102417',
  text: '#F3FFF6',
  muted: '#93A598',
  danger: '#D84C4C',
};

const TAX_RATE_SUR_PLACE: Record<ProductCategory, number> = {
  burgers: 0.1,
  snacks: 0.1,
  desserts: 0.1,
  boissons: 0.1,
  accompagnements: 0.1,
  sauces: 0.1,
};

const TAX_RATE_A_EMPORTER: Record<ProductCategory, number> = {
  burgers: 0.1,
  snacks: 0.1,
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

const getTaxCode = (rate: number) => TAX_CODES.find((entry) => entry.rate === rate)?.code ?? '?';

const CATEGORIES: ProductCategory[] = ['burgers', 'snacks', 'accompagnements', 'desserts', 'boissons', 'sauces'];

const CATEGORY_LABELS: Record<ProductCategory, string> = {
  burgers: 'Burgers',
  snacks: 'Snacks',
  accompagnements: 'Accompagnements',
  desserts: 'Desserts',
  boissons: 'Boissons',
  sauces: 'Sauces',
};

type SidebarSection = 'vente' | 'stock' | 'tickets' | 'parametres';
type SaleTunnelStep = 'menu' | 'burger' | 'snack' | 'accompagnement' | 'dessert' | 'boisson' | 'sauce';
type MenuFlowType = 'menu_burgers' | 'menu_tex_mex' | 'menu_kids';
type MenuStage = 'main' | 'side' | 'drink' | 'sauce' | 'dessert' | 'toy';
type ToastType = 'success' | 'error';
type TicketPreviewMode = 'caisse' | 'cuisine';
type TicketCorrectionMode = 'cancel';

const SALE_TUNNEL_STEPS: Record<SaleTunnelStep, { label: string; icon: string; categories: ProductCategory[] }> = {
  menu: { label: 'Menu', icon: '', categories: ['burgers', 'snacks'] },
  burger: { label: '', icon: '🍔', categories: ['burgers'] },
  snack: { label: '', icon: '🍗', categories: ['snacks'] },
  accompagnement: { label: '', icon: '🍟', categories: ['accompagnements'] },
  dessert: { label: '', icon: '🍩', categories: ['desserts'] },
  boisson: { label: '', icon: '🥤', categories: ['boissons'] },
  sauce: { label: '', icon: '🍅', categories: ['sauces'] },
};

const MENU_FLOW_LABELS: Record<MenuFlowType, string> = {
  menu_burgers: "Menu Burger'S",
  menu_tex_mex: 'Menu Tex Mex',
  menu_kids: "Menu Kid'S",
};

const MENU_CLASSIQUE_STAGES: MenuStage[] = ['main', 'side', 'drink', 'sauce'];
const MENU_KIDS_STAGES: MenuStage[] = ['main', 'side', 'drink', 'dessert', 'toy'];

const MENU_STAGE_LABELS: Record<MenuStage, string> = {
  main: 'Principal',
  side: 'Accompagnement',
  drink: 'Boisson',
  sauce: 'Sauce',
  dessert: 'Dessert',
  toy: 'Jouet',
};

const THERMAL_RECEIPT_WIDTH = 302;
const THERMAL_RECEIPT_THUMB_WIDTH = 170;

const PRODUCT_IMAGES: Record<string, number> = {
  badoit: require('./assets/products/badoit.avif'),
  balboa: require('./assets/products/balboa.avif'),
  brownie: require('./assets/products/brownie.avif'),
  cheesy_fries: require('./assets/products/cheesy_fries.png'),
  cheesy_pots: require('./assets/products/cheesy_pots.png'),
  chicken_fils: require('./assets/products/chicken_fils.png'),
  compote: require('./assets/products/compote.png'),
  cookie: require('./assets/products/cookie.avif'),
  cordoba: require('./assets/products/cordoba.avif'),
  crusty_pankas: require('./assets/products/crusty_pankas.png'),
  donuts: require('./assets/products/donuts.avif'),
  fish: require('./assets/products/fish.avif'),
  florin: require('./assets/products/florin.avif'),
  frites: require('./assets/products/frites.avif'),
  lagnel: require('./assets/products/lagnel.avif'),
  le_bigs: require('./assets/products/le_bigs.avif'),
  le_buck: require('./assets/products/le_buck.avif'),
  le_cheese: require('./assets/products/le_cheese.avif'),
  le_croqs: require('./assets/products/le_croqs.png'),
  le_double_cents: require('./assets/products/le_double_cents.avif'),
  le_double_cheese: require('./assets/products/le_double_cheese.avif'),
  le_doublon: require('./assets/products/le_doublon.avif'),
  le_kina_original: require('./assets/products/le_kina_original.webp'),
  le_pound: require('./assets/products/le_pound.avif'),
  le_riyal: require('./assets/products/le_riyal.avif'),
  le_triple_cheese: require('./assets/products/le_triple_cheese.avif'),
  les_nuggets: require('./assets/products/les_nuggets.avif'),
  les_satays: require('./assets/products/les_satays.png'),
  likuta: require('./assets/products/likuta.avif'),
  lipton: require('./assets/products/lipton.png'),
  moelleux_choco: require('./assets/products/moelleux_choco.avif'),
  muffin_chocolat: require('./assets/products/muffin_chocolat.png'),
  oasis: require('./assets/products/oasis.png'),
  orangina: require('./assets/products/orangina.avif'),
  pago_fraise: require('./assets/products/pago_fraise.avif'),
  pago_multivitaminé: require('./assets/products/pago_multivitaminé.png'),
  pankas_naan: require('./assets/products/pankas_naan.avif'),
  pepsi: require('./assets/products/pepsi.avif'),
  potatoes: require('./assets/products/potatoes.avif'),
  red_bull: require('./assets/products/red_bull.avif'),
  sakitori_spicy: require('./assets/products/sakitori_spicy.png'),
  sundae: require('./assets/products/sundae.avif'),
  volvic: require('./assets/products/volvic.png'),
  volvic_fraise: require('./assets/products/volvic_fraise.png'),
  lécu_dor: require('./assets/products/lécu_dor.avif'),
};

console.log('[APP] PRODUCT_IMAGES loaded OK, keys:', Object.keys(PRODUCT_IMAGES).length);

const EMPTY_SETTINGS: PrinterSettings = {
  cashPrinterUrl: '',
  kitchenPrinterUrl: '',
};

const LoginScreen = ({ onLogin }: { onLogin: (session: UserSession) => void }) => {
  const [code, setCode] = useState('');
  const { width, height } = useWindowDimensions();
  const isCompactLogin = width < 360 || height < 500;

  const appendDigit = (digit: string) => {
    setCode((prev) => (prev.length >= 4 ? prev : `${prev}${digit}`));
  };

  const removeDigit = () => {
    setCode((prev) => prev.slice(0, -1));
  };

  const clearCode = () => {
    setCode('');
  };

  const handleLogin = () => {
    if (code.length < 4) {
      Alert.alert('Code incomplet', 'Entre un code à 4 chiffres.');
      return;
    }

    const user = authenticateByCode(code);
    if (!user) {
      Alert.alert('Connexion refusée', 'Code invalide.');
      clearCode();
      return;
    }

    onLogin({ username: user.username, role: user.role });
  };

  const keypadItems = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: 20 }}>
        <View style={styles.loginBox}>
          <Text style={styles.title}>Caisse Android</Text>
          <Text style={styles.subtitle}>Entre ton code d'accès</Text>

          <View style={styles.codeDisplay}>
            <Text style={styles.codeDisplayText}>{code ? '●'.repeat(code.length) + '−'.repeat(4 - code.length) : '− − − −'}</Text>
          </View>

          <View style={[styles.keypadGrid, isCompactLogin && styles.keypadGridCompact]}>
            {keypadItems.map((item) => (
              <Pressable
                key={item}
                style={[
                  styles.keypadKey,
                  isCompactLogin && styles.keypadKeyCompact,
                  item === 'C' && styles.keypadKeyDanger,
                ]}
                onPress={() => {
                  if (item === 'C') {
                    clearCode();
                    return;
                  }
                  if (item === '⌫') {
                    removeDigit();
                    return;
                  }

                  appendDigit(item);
                }}
              >
                <Text style={[styles.keypadKeyText, isCompactLogin && styles.keypadKeyTextCompact]}>{item}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={[styles.loginPrimaryBtn, code.length < 4 && styles.primaryBtnDisabled]}
            onPress={handleLogin}
            disabled={code.length < 4}
          >
            <Text style={styles.loginPrimaryBtnText}>Se connecter</Text>
          </Pressable>


        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

type PosScreenProps = {
  session: UserSession;
  onLogout: () => void;
};

const PosScreen = ({ session, onLogout }: PosScreenProps) => {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState('');
  const [isPrintingFlash, setIsPrintingFlash] = useState(false);
  const [debugStatus, setDebugStatus] = useState('Starting...');
  const [activeSection, setActiveSection] = useState<SidebarSection>('vente');
  const [saleStep, setSaleStep] = useState<SaleTunnelStep>('menu');
  const [menuFlowType, setMenuFlowType] = useState<MenuFlowType>('menu_burgers');
  const [menuStage, setMenuStage] = useState<MenuStage>('main');
  const [selectedMenuMainId, setSelectedMenuMainId] = useState<string | null>(null);
  const [selectedMenuSideId, setSelectedMenuSideId] = useState<string | null>(null);
  const [selectedMenuDrinkId, setSelectedMenuDrinkId] = useState<string | null>(null);
  const [selectedMenuSauceId, setSelectedMenuSauceId] = useState<string | null>(null);
  const [selectedMenuDessertId, setSelectedMenuDessertId] = useState<string | null>(null);
  const [selectedMenuToyId, setSelectedMenuToyId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [tableLabel, setTableLabel] = useState('');
  const [orderType, setOrderType] = useState<OrderType>('sur_place');
  const [note, setNote] = useState('');
  const [customPaymentMethod, setCustomPaymentMethod] = useState('');
  const [otherPayModalVisible, setOtherPayModalVisible] = useState(false);
  const [trCbModalVisible, setTrCbModalVisible] = useState(false);
  const [settings, setSettings] = useState<PrinterSettings>(EMPTY_SETTINGS);
  const [stats, setStats] = useState<DailyStats>({ ordersCount: 0, revenue: 0 });
  const [weeklyStats, setWeeklyStats] = useState<DailyStats>({ ordersCount: 0, revenue: 0 });
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<ToastType>('success');
  const [tickets, setTickets] = useState<StoredTicket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [ticketPreviewMode, setTicketPreviewMode] = useState<TicketPreviewMode>('caisse');
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [isSendingKitchen, setIsSendingKitchen] = useState(false);
  const [payingMethod, setPayingMethod] = useState<string | null>(null);
  const [isDeletingTickets, setIsDeletingTickets] = useState(false);
  const [isReprintingCopy, setIsReprintingCopy] = useState(false);
  const [correctionModalVisible, setCorrectionModalVisible] = useState(false);
  const [correctionMode, setCorrectionMode] = useState<TicketCorrectionMode>('cancel');
  const [correctionReason, setCorrectionReason] = useState('');
  const [isSavingCorrection, setIsSavingCorrection] = useState(false);
  const [xSnapshot, setXSnapshot] = useState<ClosureSnapshot | null>(null);
  const [zClosures, setZClosures] = useState<ClosureRecord[]>([]);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [isRunningAudit, setIsRunningAudit] = useState(false);
  const [isLoadingClosures, setIsLoadingClosures] = useState(false);
  const [isLoadingXReport, setIsLoadingXReport] = useState(false);
  const [isClosingZReport, setIsClosingZReport] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isExportingAudit, setIsExportingAudit] = useState(false);
  const [isExportingLegalArchive, setIsExportingLegalArchive] = useState(false);
  const [isVerifyingLegalArchive, setIsVerifyingLegalArchive] = useState(false);
  const [isBackingUpDatabase, setIsBackingUpDatabase] = useState(false);
  const [isRestoringDatabase, setIsRestoringDatabase] = useState(false);
  const [legalArchiveVerification, setLegalArchiveVerification] = useState<LegalArchiveVerification | null>(null);
  const [isOpeningExports, setIsOpeningExports] = useState(false);
  const [isCopyingExportsPath, setIsCopyingExportsPath] = useState(false);
  const [lastCopiedExportsPath, setLastCopiedExportsPath] = useState('');
  const [isDiscoveringPrinters, setIsDiscoveringPrinters] = useState(false);
  const [isTestingCashPrinter, setIsTestingCashPrinter] = useState(false);
  const [isTestingKitchenPrinter, setIsTestingKitchenPrinter] = useState(false);
  const [scanSubnet, setScanSubnet] = useState('');
  const [scanStart, setScanStart] = useState('1');
  const [scanEnd, setScanEnd] = useState('254');
  const [discoveredPrinters, setDiscoveredPrinters] = useState<EpsonDiscoveryItem[]>([]);
  const [productFormVisible, setProductFormVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formName, setFormName] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formMenuPrice, setFormMenuPrice] = useState('');
  const [formMenuSupplement, setFormMenuSupplement] = useState('');
  const [formCategory, setFormCategory] = useState<ProductCategory>('burgers');
  const [formSendToKitchen, setFormSendToKitchen] = useState(true);
  const [formActive, setFormActive] = useState(true);
  const [formImageKey, setFormImageKey] = useState('');
  const [formImageUri, setFormImageUri] = useState('');
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [stockFilter, setStockFilter] = useState<ProductCategory | 'all'>('all');
  const [stockSearch, setStockSearch] = useState('');
  const [showTaxDetails, setShowTaxDetails] = useState(false);

  const sanitizeFilePart = (value: string) => value.replace(/[:.]/g, '-').replace(/\s+/g, '_');

  const buildAuditFileSuffix = (meta?: { periodStart?: string; periodEnd?: string; lastTicketNumber?: number }) => {
    const periodStart = meta?.periodStart ? sanitizeFilePart(meta.periodStart) : 'na';
    const periodEnd = meta?.periodEnd ? sanitizeFilePart(meta.periodEnd) : 'na';
    const lastTicket = typeof meta?.lastTicketNumber === 'number' ? String(meta.lastTicketNumber) : 'na';
    return `period_${periodStart}_to_${periodEnd}_last_${lastTicket}`;
  };

  const writeAuditJsonExport = async (
    report: AuditReport,
    filePrefix: string,
    meta?: { periodStart?: string; periodEnd?: string; lastTicketNumber?: number },
  ) => {
    const baseDir = `${FileSystem.documentDirectory ?? ''}exports`;
    if (!baseDir) {
      throw new Error('export-dir-unavailable');
    }

    await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
    const safeDate = sanitizeFilePart(report.checkedAt);
    const suffix = buildAuditFileSuffix(meta);
    const filePath = `${baseDir}/${filePrefix}_${suffix}_${safeDate}.json`;
    await FileSystem.writeAsStringAsync(filePath, JSON.stringify(report, null, 2), {
      encoding: FileSystem.EncodingType.UTF8,
    });

    return filePath;
  };

  const loadProductsData = async () => {
    const [activeProducts, withInactive] = await Promise.all([getProducts(false), getProducts(true)]);
    setProducts(activeProducts);
    setAllProducts(withInactive);
  };

  const loadRecentTickets = async () => {
    if (session.role !== 'admin') {
      return;
    }

    const recent = await getRecentTickets(50);
    setTickets(recent);
    setSelectedTicketId((prev) => {
      if (prev && recent.some((ticket) => ticket.id === prev)) {
        return prev;
      }

      return recent[0]?.id ?? null;
    });
    setTicketPreviewMode('caisse');
  };

  const loadRecentClosures = async () => {
    if (session.role !== 'admin' || isLoadingClosures) {
      return;
    }

    setIsLoadingClosures(true);
    try {
      const closures = await getRecentClosures(10);
      setZClosures(closures);
    } finally {
      setIsLoadingClosures(false);
    }
  };

  const formatTicketDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString('fr-FR');
  };

  const formatPaymentMethodLabel = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'carte') {
      return 'Carte';
    }
    if (normalized === 'especes' || normalized === 'espèces') {
      return 'Espèces';
    }

    return value || 'Non précisé';
  };

  const extractSubnetFromUrl = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    const withoutProtocol = trimmed.replace(/^https?:\/\//i, '');
    const host = withoutProtocol.split('/')[0]?.split(':')[0] ?? '';
    const parts = host.split('.');
    if (parts.length !== 4) {
      return '';
    }

    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  };

  const extractSubnetFromIp = (value: string) => {
    const trimmed = value.trim();
    const parts = trimmed.split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
      return '';
    }

    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  };

  const showToast = (text: string, type: ToastType = 'success') => {
    setMessageType(type);
    setMessage(text);
  };

  const handlePrintFlashReport = async () => {
    if (isPrintingFlash) return;
    setIsPrintingFlash(true);
    try {
      const flashStats = await getFlashReportStats();
      const result = await printFlashReport(settings.cashPrinterUrl, flashStats, session.username);
      if (result.ok) {
        showToast('Rapport Flash imprimé', 'success');
      } else {
        showToast(`Erreur impression: ${result.message}`, 'error');
      }
    } catch (error) {
      console.error(error);
      showToast('Erreur génération rapport', 'error');
    } finally {
      setIsPrintingFlash(false);
    }
  };

  const [changePinUser, setChangePinUser] = useState('');
  const [changePinValue, setChangePinValue] = useState('');
  const [changePinConfirm, setChangePinConfirm] = useState('');

  useEffect(() => {
    const bootstrap = async () => {
      try {
        setDebugStatus('1/5 initDatabase...');
        console.log('[BOOT] 1/5 initDatabase…');
        await initDatabase();

        setDebugStatus('2/5 loading settings & stats...');
        console.log('[BOOT] 2a/5 loading settings...');
        const loadedSettings = await getPrinterSettings();

        setDebugStatus('2b/5 loading todayStats...');
        console.log('[BOOT] 2b/5 loading today stats...');
        const todayStats = await getTodayStats();

        setDebugStatus('2c/5 loading weeklyStats...');
        console.log('[BOOT] 2c/5 loading weekly stats...');
        const currentWeekStats = await getWeeklyStats();

        setDebugStatus('3/5 loading products...');
        console.log('[BOOT] 3/5 loading products…');
        await loadProductsData();

        setDebugStatus('4/5 loading user pins...');
        console.log('[BOOT] 4/5 loading user pins…');
        const savedPins = await loadUserPins();
        console.log('[BOOT] 4/5 loaded user pins:', Object.keys(savedPins).length);
        if (Object.keys(savedPins).length) {
          applyUserPins(savedPins);
        }
        setSettings(loadedSettings);
        setStats(todayStats);
        setWeeklyStats(currentWeekStats);
        if (session.role === 'admin') {
          setDebugStatus('4b/5 loading recent tickets...');
          console.log('[BOOT] 4b/5 loading tickets (admin)…');
          await loadRecentTickets();
        }
        setDebugStatus('5/5 Ready!');
        console.log('[BOOT] 5/5 bootstrap complete ✓');
        setInitError('');
      } catch (err) {
        console.error('[BOOT] ✗ bootstrap error:', err);
        setDebugStatus(`Error: ${String(err)}`);
        setInitError('Erreur au démarrage. Vérifie la base locale puis redémarre l\'application.');
      } finally {
        setReady(true);
      }
    };

    bootstrap();
  }, []);

  useEffect(() => {
    if (activeSection === 'tickets' && session.role === 'admin') {
      loadRecentTickets();
    }
  }, [activeSection, session.role]);

  useEffect(() => {
    if (activeSection === 'parametres' && session.role === 'admin') {
      loadRecentClosures();
    }
  }, [activeSection, session.role]);

  useEffect(() => {
    const autoFillSubnet = async () => {
      if (activeSection !== 'parametres' || session.role !== 'admin' || scanSubnet.trim()) {
        return;
      }

      try {
        const ip = await Network.getIpAddressAsync();
        const fromIp = extractSubnetFromIp(ip);
        if (fromIp) {
          setScanSubnet(fromIp);
          return;
        }
      } catch {
        // fallback below
      }

      const fromCash = extractSubnetFromUrl(settings.cashPrinterUrl);
      const fromKitchen = extractSubnetFromUrl(settings.kitchenPrinterUrl);
      const fallback = fromCash || fromKitchen;
      if (fallback) {
        setScanSubnet(fallback);
      }
    };

    autoFillSubnet();
  }, [activeSection, session.role, scanSubnet, settings.cashPrinterUrl, settings.kitchenPrinterUrl]);

  useEffect(() => {
    if (!message) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setMessage('');
    }, 3500);

    return () => clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    const handler = () => {
      if (activeSection !== 'vente') {
        setActiveSection('vente');
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'vente' && !isSidebarVisible) {
      setIsSidebarVisible(true);
    }
  }, [activeSection]);

  const filteredProducts = useMemo(
    () => products.filter((product) => SALE_TUNNEL_STEPS[saleStep].categories.includes(product.category)),
    [products, saleStep],
  );

  const menuMainProducts = useMemo(() => {
    if (menuFlowType === 'menu_burgers') {
      // Menu Burger'S: only burgers with a menu price
      return products.filter(
        (p) =>
          p.category === 'burgers' &&
          (p.menuPrice !== undefined || (p.slug && MENU_PRICES_BY_SLUG[p.slug] !== undefined)),
      );
    }
    if (menuFlowType === 'menu_tex_mex') {
      // Menu Tex Mex: only snacks with a menu price
      return products.filter(
        (p) =>
          p.category === 'snacks' &&
          (p.menuPrice !== undefined || (p.slug && MENU_PRICES_BY_SLUG[p.slug] !== undefined)),
      );
    }
    // Menu Kid'S: produits enfants autorisés
    const KIDS_MAIN_SLUGS = ['nugget_s_x4', 'croq_s', 'burger', 'cheese'];
    return products.filter(
      (p) =>
        (p.category === 'burgers' || p.category === 'snacks') &&
        KIDS_MAIN_SLUGS.includes(p.slug ?? ''),
    );
  }, [menuFlowType, products]);

  const menuSideProducts = useMemo(() => {
    if (menuFlowType === 'menu_kids') {
      return products.filter(
        (p) => p.category === 'accompagnements' && p.slug === 'frites_kid',
      );
    }
    return products.filter(
      (p) => p.category === 'accompagnements' && p.slug !== 'frites_kid',
    );
  }, [menuFlowType, products]);

  const menuDrinkProducts = useMemo(() => {
    if (menuFlowType === 'menu_kids') {
      const KIDS_DRINK_SLUGS = ['oasis_kid_s', 'volvic_50cl'];
      return products.filter(
        (p) => p.category === 'boissons' && KIDS_DRINK_SLUGS.includes(p.slug ?? ''),
      );
    }
    return products.filter((p) => p.category === 'boissons');
  }, [menuFlowType, products]);

  const menuSauceProducts = useMemo(
    () => products.filter((p) => p.category === 'sauces'),
    [products],
  );

  const menuDessertProducts = useMemo(() => {
    if (menuFlowType === 'menu_kids') {
      const KIDS_DESSERT_SLUGS = ['tronches_de_cake', 'compote'];
      return products.filter(
        (p) => p.category === 'desserts' && KIDS_DESSERT_SLUGS.includes(p.slug ?? ''),
      );
    }
    return products.filter((p) => p.category === 'desserts');
  }, [menuFlowType, products]);

  const menuToyProducts = useMemo(
    () => [
      { id: 'toy_garcon', slug: 'toy_garcon', name: 'Jouet Garçon', price: 0, menuSupplement: undefined as number | undefined, category: 'desserts' as ProductCategory, sendToKitchen: false, active: true, imageKey: '' },
      { id: 'toy_fille', slug: 'toy_fille', name: 'Jouet Fille', price: 0, menuSupplement: undefined as number | undefined, category: 'desserts' as ProductCategory, sendToKitchen: false, active: true, imageKey: '' },
    ],
    [],
  );

  const currentMenuStages = menuFlowType === 'menu_kids' ? MENU_KIDS_STAGES : MENU_CLASSIQUE_STAGES;

  const menuDisplayedProducts = useMemo(() => {
    if (menuStage === 'main') return menuMainProducts;
    if (menuStage === 'side') return menuSideProducts;
    if (menuStage === 'drink') return menuDrinkProducts;
    if (menuStage === 'sauce') return menuSauceProducts;
    if (menuStage === 'dessert') return menuDessertProducts;
    if (menuStage === 'toy') return menuToyProducts;
    return menuMainProducts;
  }, [menuStage, menuMainProducts, menuSideProducts, menuDrinkProducts, menuSauceProducts, menuDessertProducts, menuToyProducts]);

  const selectedMenuMain = useMemo(
    () => products.find((p) => p.id === selectedMenuMainId) ?? null,
    [products, selectedMenuMainId],
  );
  const selectedMenuSide = useMemo(
    () => [...products, ...menuToyProducts].find((p) => p.id === selectedMenuSideId) ?? null,
    [products, menuToyProducts, selectedMenuSideId],
  );
  const selectedMenuDrink = useMemo(
    () => products.find((p) => p.id === selectedMenuDrinkId) ?? null,
    [products, selectedMenuDrinkId],
  );
  const selectedMenuSauce = useMemo(
    () => products.find((p) => p.id === selectedMenuSauceId) ?? null,
    [products, selectedMenuSauceId],
  );
  const selectedMenuDessert = useMemo(
    () => products.find((p) => p.id === selectedMenuDessertId) ?? null,
    [products, selectedMenuDessertId],
  );
  const selectedMenuToy = useMemo(
    () => menuToyProducts.find((p) => p.id === selectedMenuToyId) ?? null,
    [menuToyProducts, selectedMenuToyId],
  );

  const currentStageIndex = currentMenuStages.indexOf(menuStage);
  const totalStages = currentMenuStages.length;

  const canOpenStage = (stage: MenuStage): boolean => {
    const index = currentMenuStages.indexOf(stage);
    if (index <= 0) return true;
    // Each prior stage must have a selection
    for (let i = 0; i < index; i++) {
      const priorStage = currentMenuStages[i];
      if (priorStage === 'main' && !selectedMenuMainId) return false;
      if (priorStage === 'side' && !selectedMenuSideId) return false;
      if (priorStage === 'drink' && !selectedMenuDrinkId) return false;
      if (priorStage === 'sauce' && !selectedMenuSauceId) return false;
      if (priorStage === 'dessert' && !selectedMenuDessertId) return false;
    }
    return true;
  };

  const menuStageHint = `Étape ${currentStageIndex + 1}/${totalStages}: choisis ${MENU_STAGE_LABELS[menuStage].toLowerCase()}${currentStageIndex === totalStages - 1 ? ' (le menu sera ajouté automatiquement)' : ''
    }`;

  const getTaxRateForCategory = (category: ProductCategory) => {
    const map = orderType === 'a_emporter' ? TAX_RATE_A_EMPORTER : TAX_RATE_SUR_PLACE;
    return map[category] ?? 0.1;
  };

  const buildLineId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const hasCartItems = cart.length > 0;

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
    [selectedTicketId, tickets],
  );

  const selectedTicketPreviewText = useMemo(() => {
    if (!selectedTicket) {
      return 'Sélectionne un ticket pour voir le détail.';
    }

    if (ticketPreviewMode === 'cuisine') {
      return selectedTicket.kitchenTicketText ?? 'Ticket cuisine non disponible pour cette commande.';
    }

    return selectedTicket.cashTicketText ?? 'Ticket caisse sans texte enregistré.';
  }, [selectedTicket, ticketPreviewMode]);

  const canCorrectSelectedTicket = selectedTicket?.orderStatus === 'sale' && !selectedTicket?.isCopy;

  const getTicketTypeLabel = (ticket: StoredTicket) => {
    if (ticket.orderStatus === 'cancel') {
      return 'ANNULATION';
    }
    if (ticket.isCopy) {
      return 'DUPLICATA';
    }

    return 'VENTE';
  };

  const getProductImage = (product: Product) => {
    if (!product.imageKey) {
      return null;
    }
    if (product.imageKey.startsWith('file://')) {
      return { uri: product.imageKey };
    }
    return PRODUCT_IMAGES[product.imageKey] ?? null;
  };

  const pickProductImage = async () => {
    const permResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permResult.granted) {
      showToast('Permission galerie refusée.', 'error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;

    const sourceUri = result.assets[0].uri;
    const destDir = `${FileSystem.documentDirectory}product_images/`;
    const dirInfo = await FileSystem.getInfoAsync(destDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });
    }
    const fileName = `product_${Date.now()}.jpg`;
    const destUri = `${destDir}${fileName}`;
    await FileSystem.copyAsync({ from: sourceUri, to: destUri });

    setFormImageUri(destUri);
    setFormImageKey(destUri);
  };

  const removeProductImage = () => {
    setFormImageUri('');
    setFormImageKey('');
  };

  const totals = useMemo(() => {
    let rawTotalTtc = 0;
    const allocations: { rate: number; ttc: number }[] = [];

    const pushAllocation = (rate: number, ttc: number) => {
      rawTotalTtc += ttc;
      allocations.push({ rate, ttc });
    };

    for (const line of cart) {
      if (line.kind === 'menu' && line.menuItems?.length) {
        const menuItems = line.menuItems;
        const baseParts = menuItems.map((mi) => Math.max(mi.product.price, 0));
        const baseSum = baseParts.reduce((acc, value) => acc + value, 0);
        const divisor = baseSum > 0 ? baseSum : menuItems.length || 1;

        menuItems.forEach((mi, idx) => {
          const share = divisor ? baseParts[idx] / divisor : 1 / menuItems.length;
          const rate = getTaxRateForCategory(mi.product.category);
          const ttc = line.product.price * line.quantity * share;
          pushAllocation(rate, ttc);
        });
        continue;
      }

      const rate = getTaxRateForCategory(line.product.category);
      pushAllocation(rate, line.product.price * line.quantity);
    }

    const discountAmount = 0;

    const taxMap = new Map<number, TaxLine>();
    allocations.forEach((alloc) => {
      const base = alloc.ttc / (1 + alloc.rate);
      const tax = alloc.ttc - base;
      const existing = taxMap.get(alloc.rate) ?? {
        code: getTaxCode(alloc.rate),
        rate: alloc.rate,
        base: 0,
        tax: 0,
        total: 0,
      };

      existing.base += base;
      existing.tax += tax;
      existing.total += alloc.ttc;
      taxMap.set(alloc.rate, existing);
    });

    const taxLines = Array.from(taxMap.values()).sort((a, b) => a.rate - b.rate);
    const totalHt = taxLines.reduce((acc, line) => acc + line.base, 0);
    const totalTtc = rawTotalTtc;
    const taxAmount = totalTtc - totalHt;

    return { rawTotalTtc, discountAmount, totalHt, taxAmount, totalTtc, taxLines };
  }, [cart, orderType]);

  const { rawTotalTtc, discountAmount, totalHt, taxAmount, totalTtc, taxLines } = totals;

  const lineTotal = (line: CartItem) => line.product.price * line.quantity;

  const addProductToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((line) => line.kind !== 'menu' && line.product.id === product.id);

      if (existing) {
        return prev.map((line) =>
          line.lineId === existing.lineId ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }

      return [...prev, { lineId: product.id, product, quantity: 1, kind: 'product' }];
    });
  };

  const handleMenuFlowChange = (flow: MenuFlowType) => {
    setMenuFlowType(flow);
    resetComposedMenu();
  };

  const resetComposedMenu = () => {
    setMenuStage('main');
    setSelectedMenuMainId(null);
    setSelectedMenuSideId(null);
    setSelectedMenuDrinkId(null);
    setSelectedMenuSauceId(null);
    setSelectedMenuDessertId(null);
    setSelectedMenuToyId(null);
  };

  const resolveMenuClassiquePrice = (main: Product, side: Product) => {
    const bySlug = main.slug ? MENU_PRICES_BY_SLUG[main.slug] : undefined;
    const mapped = main.menuPrice ?? bySlug;
    const supplement = side.menuSupplement ?? 0;

    if (typeof mapped === 'number') {
      return Number((mapped + supplement).toFixed(2));
    }

    // Fallback: main.price + 3.80 (average menu uplift) + supplement
    return Number((main.price + 3.80 + supplement).toFixed(2));
  };

  const KIDS_MENU_PRICE = 5.00;

  const handleAddMenuCombo = () => {
    if (menuFlowType === 'menu_burgers' || menuFlowType === 'menu_tex_mex') {
      if (!selectedMenuMain || !selectedMenuSide || !selectedMenuDrink) return;
      const menuPrice = resolveMenuClassiquePrice(selectedMenuMain, selectedMenuSide);
      const flowLabel = menuFlowType === 'menu_burgers' ? "Menu Burger'S" : 'Menu Tex Mex';
      const menuItemsList: CartItem['menuItems'] = [
        { role: 'main', product: selectedMenuMain },
        { role: 'side', product: selectedMenuSide },
        { role: 'drink', product: selectedMenuDrink },
      ];
      if (selectedMenuSauce) {
        menuItemsList.push({ role: 'sauce', product: selectedMenuSauce });
      }

      const menuLine: CartItem = {
        lineId: buildLineId(),
        kind: 'menu',
        product: {
          ...selectedMenuMain,
          id: buildLineId(),
          name: `${flowLabel} - ${selectedMenuMain.name}`,
          price: menuPrice,
          menuPrice,
          sendToKitchen: false,
        },
        quantity: 1,
        menuItems: menuItemsList,
        menuType: menuFlowType,
      };

      setCart((prev) => [...prev, menuLine]);
      showToast(`${flowLabel} ajouté: ${selectedMenuMain.name}`);
    } else {
      // Menu Kids — fixed price 5€
      if (!selectedMenuMain || !selectedMenuSide || !selectedMenuDrink || !selectedMenuDessert || !selectedMenuToy) return;
      const menuItemsList: CartItem['menuItems'] = [
        { role: 'main', product: selectedMenuMain },
        { role: 'side', product: selectedMenuSide },
        { role: 'drink', product: selectedMenuDrink },
        { role: 'dessert', product: selectedMenuDessert },
        { role: 'toy', product: selectedMenuToy },
      ];

      const menuLine: CartItem = {
        lineId: buildLineId(),
        kind: 'menu',
        product: {
          ...selectedMenuMain,
          id: buildLineId(),
          name: `Menu Kid'S - ${selectedMenuMain.name}`,
          price: KIDS_MENU_PRICE,
          menuPrice: KIDS_MENU_PRICE,
          sendToKitchen: false,
        },
        quantity: 1,
        menuItems: menuItemsList,
        menuType: 'menu_kids',
      };

      setCart((prev) => [...prev, menuLine]);
      showToast(`Menu Kid'S ajouté: ${selectedMenuMain.name}`);
    }

    resetComposedMenu();
  };

  const handlePickMenuProduct = (product: Product) => {
    const stages = currentMenuStages;
    const stageIdx = stages.indexOf(menuStage);

    if (menuStage === 'main') {
      setSelectedMenuMainId(product.id);
    } else if (menuStage === 'side') {
      setSelectedMenuSideId(product.id);
    } else if (menuStage === 'drink') {
      setSelectedMenuDrinkId(product.id);
    } else if (menuStage === 'sauce') {
      setSelectedMenuSauceId(product.id);
    } else if (menuStage === 'dessert') {
      setSelectedMenuDessertId(product.id);
    } else if (menuStage === 'toy') {
      setSelectedMenuToyId(product.id);
    }

    // If this is the last stage, auto-add the menu after a short tick
    if (stageIdx === stages.length - 1) {
      // We need to wait for state to update before calling handleAddMenuCombo,
      // so we use a timeout trick. However, since the state won't be updated yet,
      // we build the combo inline here.
      const main = menuStage === 'main' ? product : selectedMenuMain;
      const side = menuStage === 'side' ? product : selectedMenuSide;
      const drink = menuStage === 'drink' ? product : selectedMenuDrink;
      const sauce = menuStage === 'sauce' ? product : selectedMenuSauce;
      const dessert = menuStage === 'dessert' ? product : selectedMenuDessert;
      const toy = menuStage === 'toy' ? product : selectedMenuToy;

      if ((menuFlowType === 'menu_burgers' || menuFlowType === 'menu_tex_mex') && main && side && drink) {
        const menuPrice = resolveMenuClassiquePrice(main, side);
        const flowLabel = menuFlowType === 'menu_burgers' ? "Menu Burger'S" : 'Menu Tex Mex';
        const menuItemsList: CartItem['menuItems'] = [
          { role: 'main', product: main },
          { role: 'side', product: side },
          { role: 'drink', product: drink },
        ];
        const sauceProduct = sauce ?? (menuStage === 'sauce' ? product : null);
        if (sauceProduct) {
          menuItemsList.push({ role: 'sauce', product: sauceProduct });
        }

        const menuLine: CartItem = {
          lineId: buildLineId(),
          kind: 'menu',
          product: {
            ...main,
            id: buildLineId(),
            name: `${flowLabel} - ${main.name}`,
            price: menuPrice,
            menuPrice,
            sendToKitchen: false,
          },
          quantity: 1,
          menuItems: menuItemsList,
          menuType: menuFlowType,
        };

        setCart((prev) => [...prev, menuLine]);
        showToast(`${flowLabel} ajouté: ${main.name}`);
        resetComposedMenu();
        return;
      }

      if (menuFlowType === 'menu_kids' && main && side && drink && dessert) {
        const toyProduct = toy ?? (menuStage === 'toy' ? product : null);
        if (!toyProduct) return;
        const menuItemsList: CartItem['menuItems'] = [
          { role: 'main', product: main },
          { role: 'side', product: side },
          { role: 'drink', product: drink },
          { role: 'dessert', product: dessert },
          { role: 'toy', product: toyProduct },
        ];

        const menuLine: CartItem = {
          lineId: buildLineId(),
          kind: 'menu',
          product: {
            ...main,
            id: buildLineId(),
            name: `Menu Kids - ${main.name}`,
            price: KIDS_MENU_PRICE,
            menuPrice: KIDS_MENU_PRICE,
            sendToKitchen: false,
          },
          quantity: 1,
          menuItems: menuItemsList,
          menuType: 'menu_kids',
        };

        setCart((prev) => [...prev, menuLine]);
        showToast(`Menu Kids ajouté: ${main.name}`);
        resetComposedMenu();
        return;
      }
    }

    // Move to next stage
    if (stageIdx < stages.length - 1) {
      setMenuStage(stages[stageIdx + 1]);
    }
  };

  const updateQty = (lineId: string, direction: 'inc' | 'dec') => {
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.lineId !== lineId) {
            return line;
          }

          const quantity = direction === 'inc' ? line.quantity + 1 : line.quantity - 1;
          return { ...line, quantity };
        })
        .filter((line) => line.quantity > 0),
    );
  };

  const resetOrder = () => {
    setCart([]);
    setNote('');
    setOrderType('sur_place');
    resetComposedMenu();
    showToast('Commande vidée.');
  };

  const refreshStats = async () => {
    const [today, currentWeekStats] = await Promise.all([getTodayStats(), getWeeklyStats()]);
    setStats(today);
    setWeeklyStats(currentWeekStats);
  };

  const handleSaveSettings = async () => {
    if (session.role !== 'admin') {
      return;
    }

    await savePrinterSettings(settings);
    showToast('URLs imprimantes sauvegardées.');
  };

  const handleToggleStock = async (productId: string, active: boolean) => {
    if (session.role !== 'admin') {
      return;
    }

    await setProductActive(productId, active);
    await loadProductsData();
  };

  const openProductForm = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      setFormName(product.name);
      setFormPrice(product.price.toString());
      setFormMenuPrice(product.menuPrice?.toString() ?? '');
      setFormMenuSupplement(product.menuSupplement?.toString() ?? '');
      setFormCategory(product.category);
      setFormSendToKitchen(product.sendToKitchen);
      setFormActive(product.active);
      setFormImageKey(product.imageKey ?? '');
      setFormImageUri(product.imageKey?.startsWith('file://') ? product.imageKey : '');
    } else {
      setEditingProduct(null);
      setFormName('');
      setFormPrice('');
      setFormMenuPrice('');
      setFormMenuSupplement('');
      setFormCategory('burgers');
      setFormSendToKitchen(true);
      setFormActive(true);
      setFormImageKey('');
      setFormImageUri('');
    }
    setProductFormVisible(true);
  };

  const closeProductForm = () => {
    setProductFormVisible(false);
    setEditingProduct(null);
  };

  const handleSaveProduct = async () => {
    if (session.role !== 'admin') return;

    const name = formName.trim();
    if (!name) {
      showToast('Le nom est obligatoire.', 'error');
      return;
    }

    const price = parseFloat(formPrice);
    if (!Number.isFinite(price) || price < 0) {
      showToast('Le prix est invalide.', 'error');
      return;
    }

    const menuPrice = formMenuPrice.trim() ? parseFloat(formMenuPrice) : undefined;
    if (menuPrice !== undefined && !Number.isFinite(menuPrice)) {
      showToast('Le prix menu est invalide.', 'error');
      return;
    }

    const menuSupplement = formMenuSupplement.trim() ? parseFloat(formMenuSupplement) : undefined;
    if (menuSupplement !== undefined && !Number.isFinite(menuSupplement)) {
      showToast('Le supplément menu est invalide.', 'error');
      return;
    }

    setIsSavingProduct(true);
    try {
      const data = {
        name,
        price: Number(price.toFixed(2)),
        menuPrice: menuPrice !== undefined ? Number(menuPrice.toFixed(2)) : undefined,
        menuSupplement: menuSupplement !== undefined ? Number(menuSupplement.toFixed(2)) : undefined,
        category: formCategory,
        sendToKitchen: formSendToKitchen,
        active: formActive,
        imageKey: formImageKey.trim(),
      };

      if (editingProduct) {
        await updateProduct(editingProduct.id, data);
        showToast(`"${name}" mis à jour.`);
      } else {
        await createProduct(data);
        showToast(`"${name}" créé.`);
      }

      await loadProductsData();
      closeProductForm();
    } catch {
      showToast('Erreur lors de la sauvegarde.', 'error');
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleDeleteProduct = (product: Product) => {
    if (session.role !== 'admin') return;

    Alert.alert(
      'Supprimer le produit',
      `Supprimer « ${product.name} » définitivement ?\n\nCette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProduct(product.id);
              await loadProductsData();
              showToast(`"${product.name}" supprimé.`);
            } catch {
              showToast('Erreur lors de la suppression.', 'error');
            }
          },
        },
      ],
    );
  };

  const filteredStockProducts = useMemo(() => {
    let list = allProducts;
    if (stockFilter !== 'all') {
      list = list.filter((p) => p.category === stockFilter);
    }
    if (stockSearch.trim()) {
      const q = stockSearch.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [allProducts, stockFilter, stockSearch]);

  const handleSendKitchen = async () => {
    if (!cart.length || isSendingKitchen || payingMethod !== null) {
      return;
    }

    setIsSendingKitchen(true);
    try {
      const result = await printKitchenTicket(settings, {
        cartItems: cart,
        tableLabel,
        note,
        total: totalTtc,
        seller: session.username,
        orderType,
      });

      showToast(result.message, result.ok ? 'success' : 'error');
    } catch {
      showToast('Erreur pendant l\'envoi cuisine.', 'error');
    } finally {
      setIsSendingKitchen(false);
    }
  };

  const handlePay = async (paymentMethod: string) => {
    if (isSendingKitchen || payingMethod !== null) {
      return;
    }

    const normalizedPaymentMethod = paymentMethod.trim();
    if (!normalizedPaymentMethod) {
      showToast('Moyen de paiement invalide.', 'error');
      return;
    }

    if (!cart.length) {
      Alert.alert('Panier vide', 'Ajoute des produits avant encaissement.');
      return;
    }

    setPayingMethod(normalizedPaymentMethod);
    try {
      let cashTicketText = '';
      let printWasSuccessful = false;

      const ticketResult = await printCashTicket(settings, {
        cartItems: cart,
        tableLabel,
        note,
        total: totalTtc,
        paymentMethod: normalizedPaymentMethod,
        seller: session.username,
        taxLines,
        totalHt,
        discountAmount,
        orderType,
      });

      printWasSuccessful = ticketResult.ok;
      cashTicketText = ticketResult.ticketText ?? '';

      if (!cashTicketText) {
        const fallbackLines = [
          `Date: ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR')}`,
          tableLabel ? `Table: ${tableLabel}` : '',
          ...cart.map((line) => `${line.quantity} x ${line.product.name} ${(line.product.price * line.quantity).toFixed(2)}€`),
          `Total TTC: ${totalTtc.toFixed(2)}€`,
          `Paiement: ${normalizedPaymentMethod}`,
          note ? `Note: ${note}` : '',
        ].filter(Boolean);
        cashTicketText = fallbackLines.join('\n');
      }

      await saveOrder({
        userRole: session.role,
        userName: session.username,
        items: cart,
        subtotal: rawTotalTtc,
        discountAmount,
        taxAmount,
        total: totalTtc,
        paymentMethod: normalizedPaymentMethod,
        tableLabel,
        note,
        orderType,
        cashTicketText,
        kitchenTicketText: buildKitchenTicketText({
          cartItems: cart,
          tableLabel,
          note,
          total: totalTtc,
          seller: session.username,
        }),
      });

      showToast(
        printWasSuccessful
          ? 'Ticket enregistré et impression envoyée.'
          : 'Ticket enregistré (impression indisponible).',
        'success',
      );
      await refreshStats();
      if (session.role === 'admin') {
        await loadRecentTickets();
      }
      setCart([]);
      setNote('');
      setCustomPaymentMethod('');
      resetComposedMenu();
    } catch {
      showToast('Erreur pendant l\'encaissement.', 'error');
    } finally {
      setPayingMethod(null);
    }
  };

  const handleDeleteAllTickets = () => {
    if (session.role !== 'admin' || isDeletingTickets) {
      return;
    }

    Alert.alert(
      'Supprimer les tickets',
      'Tous les tickets enregistrés vont être supprimés définitivement.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setIsDeletingTickets(true);
            try {
              await deleteAllTickets();
              await loadRecentTickets();
              await refreshStats();
              showToast('Anciens tickets supprimés.');
            } catch {
              showToast('Suppression des tickets impossible.', 'error');
            } finally {
              setIsDeletingTickets(false);
            }
          },
        },
      ],
    );
  };

  const handleLoadXReport = async () => {
    if (session.role !== 'admin' || isLoadingXReport) {
      return;
    }

    setIsLoadingXReport(true);
    try {
      const snapshot = await getCurrentXSnapshot();
      setXSnapshot(snapshot);
      showToast(`Rapport X chargé (${snapshot.ordersCount} tickets).`);
    } catch {
      showToast('Rapport X impossible.', 'error');
    } finally {
      setIsLoadingXReport(false);
    }
  };

  const handleCloseZReport = () => {
    if (session.role !== 'admin' || isClosingZReport) {
      return;
    }

    Alert.alert('Clôture Z', 'Confirmer la clôture Z de la période courante ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Clôturer',
        style: 'destructive',
        onPress: async () => {
          setIsClosingZReport(true);
          try {
            const closure = await closeCurrentZPeriod(session.username);
            setXSnapshot(closure);
            await loadRecentClosures();
            await refreshStats();

            try {
              const report = await runIntegrityAudit();
              setAuditReport(report);
              await writeAuditJsonExport(report, `audit_post_z_${closure.id}`, {
                periodStart: closure.periodStart,
                periodEnd: closure.periodEnd,
                lastTicketNumber: closure.lastTicketNumber,
              });
            } catch {
              showToast('Clôture Z OK, mais snapshot audit non exporté.', 'error');
            }

            showToast(`Clôture Z OK (${closure.ordersCount} tickets).`);
          } catch {
            showToast('Clôture Z impossible.', 'error');
          } finally {
            setIsClosingZReport(false);
          }
        },
      },
    ]);
  };

  const handleExportCurrentCsv = async () => {
    if (session.role !== 'admin' || isExportingCsv) {
      return;
    }

    setIsExportingCsv(true);
    try {
      const result = await buildCurrentPeriodCsv();
      const baseDir = `${FileSystem.documentDirectory ?? ''}exports`;
      if (!baseDir) {
        showToast('Export CSV impossible.', 'error');
        return;
      }
      await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
      const safeStart = result.periodStart.replace(/[:.]/g, '-');
      const safeEnd = result.periodEnd.replace(/[:.]/g, '-');
      const filePath = `${baseDir}/tickets_${safeStart}_to_${safeEnd}.csv`;
      await FileSystem.writeAsStringAsync(filePath, result.csv, { encoding: FileSystem.EncodingType.UTF8 });
      showToast(`CSV exporté (${result.rowsCount} lignes): ${filePath}`);
    } catch {
      showToast('Export CSV impossible.', 'error');
    } finally {
      setIsExportingCsv(false);
    }
  };

  const handleBackupDatabase = async () => {
    if (session.role !== 'admin' || isBackingUpDatabase) {
      return;
    }

    setIsBackingUpDatabase(true);
    try {
      const baseDir = `${FileSystem.documentDirectory ?? ''}exports`;
      const sqliteDir = `${FileSystem.documentDirectory ?? ''}SQLite`;
      if (!baseDir || !sqliteDir) {
        showToast('Sauvegarde DB impossible.', 'error');
        return;
      }

      await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
      const sourceDbPath = `${sqliteDir}/pos_local.db`;
      const dbInfo = await FileSystem.getInfoAsync(sourceDbPath);
      if (!dbInfo.exists) {
        showToast('Base locale introuvable.', 'error');
        return;
      }

      const safeDate = sanitizeFilePart(new Date().toISOString());
      const backupPath = `${baseDir}/backup_pos_local_${safeDate}.db`;
      await FileSystem.copyAsync({ from: sourceDbPath, to: backupPath });
      showToast(`Sauvegarde DB exportée: ${backupPath}`);
    } catch {
      showToast('Sauvegarde DB impossible.', 'error');
    } finally {
      setIsBackingUpDatabase(false);
    }
  };

  const handleRestoreDatabase = () => {
    if (session.role !== 'admin' || isRestoringDatabase) {
      return;
    }

    Alert.alert(
      'Restaurer base locale',
      'Cette action remplace toutes les données actuelles par la sauvegarde sélectionnée. Continuer ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Restaurer',
          style: 'destructive',
          onPress: async () => {
            setIsRestoringDatabase(true);
            try {
              const picked = await DocumentPicker.getDocumentAsync({
                type: ['application/octet-stream', 'application/x-sqlite3', '*/*'],
                copyToCacheDirectory: true,
                multiple: false,
              });

              if (picked.canceled || !picked.assets.length) {
                return;
              }

              await restoreDatabaseFromBackup(picked.assets[0].uri);
              await initDatabase();
              await loadProductsData();
              await refreshStats();
              if (session.role === 'admin') {
                await loadRecentTickets();
                await loadRecentClosures();
                const snapshot = await getCurrentXSnapshot();
                setXSnapshot(snapshot);
              }
              setAuditReport(null);
              showToast('Base locale restaurée avec succès.');
            } catch {
              showToast('Restauration base locale impossible.', 'error');
            } finally {
              setIsRestoringDatabase(false);
            }
          },
        },
      ],
    );
  };

  const handleOpenExportsFolder = async () => {
    if (session.role !== 'admin' || isOpeningExports) {
      return;
    }

    setIsOpeningExports(true);
    try {
      const baseDir = `${FileSystem.documentDirectory ?? ''}exports`;
      if (!baseDir) {
        showToast('Dossier exports introuvable.', 'error');
        return;
      }

      await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
      const indexPath = `${baseDir}/_exports_index.txt`;
      await FileSystem.writeAsStringAsync(
        indexPath,
        `Dossier exports POS\nChemin: ${baseDir}\nMise à jour: ${new Date().toISOString()}`,
        { encoding: FileSystem.EncodingType.UTF8 },
      );

      const contentUri = await FileSystem.getContentUriAsync(indexPath);
      const canOpen = await Linking.canOpenURL(contentUri);
      if (canOpen) {
        await Linking.openURL(contentUri);
        showToast('Ouverture exports demandée.');
      } else {
        showToast(`Exports: ${baseDir}`);
      }
    } catch {
      showToast('Ouverture exports impossible.', 'error');
    } finally {
      setIsOpeningExports(false);
    }
  };

  const handleCopyExportsPath = async () => {
    if (session.role !== 'admin' || isCopyingExportsPath) {
      return;
    }

    setIsCopyingExportsPath(true);
    try {
      const baseDir = `${FileSystem.documentDirectory ?? ''}exports`;
      if (!baseDir) {
        showToast('Chemin exports indisponible.', 'error');
        return;
      }

      await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
      await Clipboard.setStringAsync(baseDir);
      setLastCopiedExportsPath(baseDir);
      showToast('Chemin exports copié.');
    } catch {
      showToast('Copie du chemin impossible.', 'error');
    } finally {
      setIsCopyingExportsPath(false);
    }
  };

  const handleRunAudit = async () => {
    if (session.role !== 'admin' || isRunningAudit) {
      return;
    }

    setIsRunningAudit(true);
    try {
      const report = await runIntegrityAudit();
      setAuditReport(report);
      const ok = report.strictSequenceOk && report.orderChainOk && report.closureChainOk;
      showToast(ok ? 'Audit OK: intégrité validée.' : 'Audit KO: incohérences détectées.', ok ? 'success' : 'error');
    } catch {
      showToast('Audit impossible.', 'error');
    } finally {
      setIsRunningAudit(false);
    }
  };

  const handleDiscoverPrinters = async () => {
    if (session.role !== 'admin' || isDiscoveringPrinters) {
      return;
    }

    const subnetCandidate =
      scanSubnet.trim() || extractSubnetFromUrl(settings.cashPrinterUrl) || extractSubnetFromUrl(settings.kitchenPrinterUrl);
    if (!subnetCandidate) {
      showToast('Renseigne un sous-réseau (ex: 192.168.1).', 'error');
      return;
    }

    const parsedStart = Number.parseInt(scanStart, 10);
    const parsedEnd = Number.parseInt(scanEnd, 10);
    const safeStart = Number.isFinite(parsedStart) ? Math.max(1, Math.min(254, parsedStart)) : 1;
    const safeEnd = Number.isFinite(parsedEnd) ? Math.max(safeStart, Math.min(254, parsedEnd)) : 254;

    setIsDiscoveringPrinters(true);
    try {
      const found = await discoverEpsonPrinters({
        subnet: subnetCandidate,
        start: safeStart,
        end: safeEnd,
      });
      setDiscoveredPrinters(found);
      showToast(
        found.length ? `${found.length} imprimante(s) détectée(s).` : 'Aucune imprimante détectée sur ce range.',
        found.length ? 'success' : 'error',
      );
    } catch {
      showToast('Détection imprimante impossible.', 'error');
    } finally {
      setIsDiscoveringPrinters(false);
    }
  };

  const handleApplyDetectedPrinter = (url: string, target: 'cash' | 'kitchen') => {
    if (target === 'cash') {
      setSettings((prev) => ({ ...prev, cashPrinterUrl: url }));
    } else {
      setSettings((prev) => ({ ...prev, kitchenPrinterUrl: url }));
    }
    showToast(`URL ${target === 'cash' ? 'caisse' : 'cuisine'} mise à jour.`);
  };

  const handleTestCashPrinter = async () => {
    if (session.role !== 'admin' || isTestingCashPrinter) {
      return;
    }

    setIsTestingCashPrinter(true);
    try {
      const result = await printTestTicket(settings.cashPrinterUrl, 'TEST IMPRIMANTE CAISSE');
      showToast(result.message, result.ok ? 'success' : 'error');
    } catch {
      showToast('Test imprimante caisse impossible.', 'error');
    } finally {
      setIsTestingCashPrinter(false);
    }
  };

  const handleTestKitchenPrinter = async () => {
    if (session.role !== 'admin' || isTestingKitchenPrinter) {
      return;
    }

    setIsTestingKitchenPrinter(true);
    try {
      const result = await printTestTicket(settings.kitchenPrinterUrl, 'TEST IMPRIMANTE CUISINE');
      showToast(result.message, result.ok ? 'success' : 'error');
    } catch {
      showToast('Test imprimante cuisine impossible.', 'error');
    } finally {
      setIsTestingKitchenPrinter(false);
    }
  };

  const handleExportLegalArchive = async () => {
    if (session.role !== 'admin' || isExportingLegalArchive) {
      return;
    }

    setIsExportingLegalArchive(true);
    try {
      const archive = await buildLegalClosureArchive();
      const baseDir = `${FileSystem.documentDirectory ?? ''}exports`;
      if (!baseDir) {
        showToast('Archive légale impossible.', 'error');
        return;
      }

      await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
      const safeGeneratedAt = sanitizeFilePart(archive.generatedAt);
      const suffix = buildAuditFileSuffix({
        periodStart: archive.closure.periodStart,
        periodEnd: archive.closure.periodEnd,
        lastTicketNumber: archive.closure.lastTicketNumber,
      });
      const filePath = `${baseDir}/legal_archive_Z${archive.closure.id}_${suffix}_${safeGeneratedAt}.json`;
      await FileSystem.writeAsStringAsync(filePath, JSON.stringify(archive, null, 2), {
        encoding: FileSystem.EncodingType.UTF8,
      });

      showToast(`Archive légale exportée: ${filePath}`);
    } catch {
      showToast('Export archive légale impossible.', 'error');
    } finally {
      setIsExportingLegalArchive(false);
    }
  };

  const handleVerifyLegalArchive = async () => {
    if (session.role !== 'admin' || isVerifyingLegalArchive) {
      return;
    }

    setIsVerifyingLegalArchive(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/json', 'text/plain'],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (picked.canceled || !picked.assets.length) {
        return;
      }

      const content = await FileSystem.readAsStringAsync(picked.assets[0].uri);
      const parsed = JSON.parse(content);
      const result = await verifyLegalClosureArchive(parsed);
      setLegalArchiveVerification(result);

      showToast(
        result.isValid ? 'Archive vérifiée: hash valide.' : `Archive invalide: ${result.reason ?? 'erreur de hash.'}`,
        result.isValid ? 'success' : 'error',
      );
    } catch {
      showToast('Vérification archive impossible.', 'error');
    } finally {
      setIsVerifyingLegalArchive(false);
    }
  };

  const handleExportAuditReport = async () => {
    if (session.role !== 'admin' || isExportingAudit) {
      return;
    }

    if (!auditReport) {
      showToast('Lance un audit avant export.', 'error');
      return;
    }

    setIsExportingAudit(true);
    try {
      const baseDir = `${FileSystem.documentDirectory ?? ''}exports`;
      if (!baseDir) {
        showToast('Export audit impossible.', 'error');
        return;
      }

      await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
      const safeDate = sanitizeFilePart(auditReport.checkedAt);
      const suffix = buildAuditFileSuffix({
        periodStart: xSnapshot?.periodStart,
        periodEnd: xSnapshot?.periodEnd,
        lastTicketNumber: xSnapshot?.lastTicketNumber,
      });
      const filePath = `${baseDir}/audit_${suffix}_${safeDate}.txt`;
      const isOk = auditReport.strictSequenceOk && auditReport.orderChainOk && auditReport.closureChainOk;
      const reportLines = [
        'RAPPORT AUDIT INTEGRITE POS',
        `Date audit: ${auditReport.checkedAt}`,
        `Période: ${xSnapshot?.periodStart ?? 'N/A'} -> ${xSnapshot?.periodEnd ?? 'N/A'}`,
        `Dernier N° ticket: ${xSnapshot?.lastTicketNumber ?? 'N/A'}`,
        `Statut global: ${isOk ? 'OK' : 'KO'}`,
        `Tickets contrôlés: ${auditReport.ordersChecked}`,
        `Clôtures contrôlées: ${auditReport.closuresChecked}`,
        `Séquence stricte: ${auditReport.strictSequenceOk ? 'OK' : 'KO'}`,
        `Chaîne tickets: ${auditReport.orderChainOk ? 'OK' : 'KO'}`,
        `Chaîne clôtures: ${auditReport.closureChainOk ? 'OK' : 'KO'}`,
        '',
        'ANOMALIES',
        ...(auditReport.issues.length
          ? auditReport.issues.map((issue, index) => `${index + 1}. [${issue.scope}] #${issue.id} ${issue.message}`)
          : ['Aucune anomalie détectée.']),
      ];

      await FileSystem.writeAsStringAsync(filePath, reportLines.join('\n'), {
        encoding: FileSystem.EncodingType.UTF8,
      });

      showToast(`Audit exporté: ${filePath}`);
    } catch {
      showToast('Export audit impossible.', 'error');
    } finally {
      setIsExportingAudit(false);
    }
  };

  const handleExportAuditJson = async () => {
    if (session.role !== 'admin' || isExportingAudit) {
      return;
    }

    if (!auditReport) {
      showToast('Lance un audit avant export.', 'error');
      return;
    }

    setIsExportingAudit(true);
    try {
      const filePath = await writeAuditJsonExport(auditReport, 'audit', {
        periodStart: xSnapshot?.periodStart,
        periodEnd: xSnapshot?.periodEnd,
        lastTicketNumber: xSnapshot?.lastTicketNumber,
      });
      showToast(`Audit JSON exporté: ${filePath}`);
    } catch {
      showToast('Export audit JSON impossible.', 'error');
    } finally {
      setIsExportingAudit(false);
    }
  };

  const openTicketCorrection = (mode: TicketCorrectionMode) => {
    if (!selectedTicket) {
      showToast('Sélectionne un ticket.', 'error');
      return;
    }

    if (selectedTicket.orderStatus !== 'sale') {
      showToast('Ce ticket est déjà corrigé.', 'error');
      return;
    }

    setCorrectionMode(mode);
    setCorrectionReason('');
    setCorrectionModalVisible(true);
  };

  const submitTicketCorrection = async () => {
    if (!selectedTicket || isSavingCorrection) {
      return;
    }

    const reason = correctionReason.trim();
    if (!reason) {
      showToast('Motif obligatoire.', 'error');
      return;
    }

    setIsSavingCorrection(true);
    try {
      const multiplier = -1;
      const targetStatus: OrderStatus = correctionMode;
      const label = 'ANNULATION';

      await saveOrder({
        userRole: session.role,
        userName: session.username,
        items: selectedTicket.items,
        subtotal: selectedTicket.subtotal * multiplier,
        discountAmount: selectedTicket.discountAmount * multiplier,
        taxAmount: selectedTicket.taxAmount * multiplier,
        total: selectedTicket.total * multiplier,
        paymentMethod: selectedTicket.paymentMethod,
        tableLabel: selectedTicket.tableLabel ?? '',
        note: `${label} ticket #${selectedTicket.ticketNumber} · ${reason}`,
        orderType: selectedTicket.orderType ?? 'sur_place',
        cashTicketText: `${label}\nTicket origine: #${selectedTicket.ticketNumber}\nMotif: ${reason}\n\n${selectedTicket.cashTicketText ?? ''}`,
        kitchenTicketText: `${label} CUISINE\nTicket origine: #${selectedTicket.ticketNumber}\nMotif: ${reason}`,
        orderStatus: targetStatus,
        statusReason: reason,
        originalOrderId: selectedTicket.id,
        isCopy: true,
      });

      await refreshStats();
      await loadRecentTickets();
      setCorrectionModalVisible(false);
      showToast(`${label} enregistré.`);
    } catch {
      showToast('Enregistrement annulation impossible.', 'error');
    } finally {
      setIsSavingCorrection(false);
    }
  };

  const handleReprintCopy = async () => {
    if (!selectedTicket || isReprintingCopy) return;

    setIsReprintingCopy(true);
    try {
      // Build print payload from the selected ticket and print directly
      const payload = {
        cartItems: selectedTicket.items,
        tableLabel: selectedTicket.tableLabel ?? '',
        note: `DUPLICATA ticket #${selectedTicket.ticketNumber}`,
        total: selectedTicket.total,
        paymentMethod: selectedTicket.paymentMethod,
        seller: session.username,
        totalHt: selectedTicket.subtotal,
        discountAmount: selectedTicket.discountAmount,
        orderType: selectedTicket.orderType ?? 'sur_place',
        isDuplicate: true,
      } as any;

      if (ticketPreviewMode === 'caisse') {
        const c = await printCashTicket(settings, payload);
        if (c.ok) showToast('Duplicata caisse imprimé.', 'success');
        else showToast(c.message || 'Erreur impression duplicata caisse.', 'error');
      } else {
        // cuisine mode
        const k = await printKitchenTicket(settings, payload);
        if (k.ok) showToast('Duplicata cuisine imprimé.', 'success');
        else showToast(k.message || 'Erreur impression duplicata cuisine.', 'error');
      }
    } catch (err) {
      showToast('Erreur impression duplicata.', 'error');
    } finally {
      setIsReprintingCopy(false);
    }
  };

  if (!ready) {
    return (
      <SafeAreaView style={styles.screenCenter}>
        <Text style={styles.subtitle}>Initialisation de la caisse…</Text>
        <Text style={[styles.subtitle, { marginTop: 10, fontFamily: 'monospace' }]}>{debugStatus}</Text>
      </SafeAreaView>
    );
  }

  if (initError) {
    return (
      <SafeAreaView style={styles.screenCenter}>
        <Text style={styles.title}>Démarrage impossible</Text>
        <Text style={[styles.subtitle, styles.initErrorText]}>{initError}</Text>
        <Pressable
          style={[styles.primaryBtn, styles.retryBtn]}
          onPress={() => {
            setReady(false);
            setInitError('');
            (async () => {
              try {
                await initDatabase();
                const [loadedSettings, todayStats, currentWeekStats] = await Promise.all([
                  getPrinterSettings(),
                  getTodayStats(),
                  getWeeklyStats(),
                ]);
                await loadProductsData();
                setSettings(loadedSettings);
                setStats(todayStats);
                setWeeklyStats(currentWeekStats);
              } catch {
                setInitError('Erreur au démarrage. Vérifie la base locale puis redémarre l\'application.');
              } finally {
                setReady(true);
              }
            })();
          }}
        >
          <Text style={styles.primaryBtnText}>Réessayer</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const isBusy = isSendingKitchen || payingMethod !== null;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.layout}>
        {isSidebarVisible ? (
          <View style={styles.sidebar}>
            <View>
              <View style={styles.sidebarHeaderRow}>
                <Pressable style={styles.sidebarToggleBtn} onPress={() => setIsSidebarVisible(false)}>
                  <Text style={styles.sidebarToggleIcon}>×</Text>
                  <Text style={styles.sidebarToggleText}>Masquer</Text>
                </Pressable>
              </View>

              <View style={styles.navGroup}>
                <Pressable
                  style={[styles.navBtn, activeSection === 'vente' && styles.navBtnActive]}
                  onPress={() => setActiveSection('vente')}
                >
                  <Text style={[styles.navBtnText, activeSection === 'vente' && styles.navBtnTextActive]}>🛒 Vente</Text>
                </Pressable>

                {session.role === 'admin' ? (
                  <>
                    <Pressable
                      style={[styles.navBtn, activeSection === 'stock' && styles.navBtnActive]}
                      onPress={() => setActiveSection('stock')}
                    >
                      <Text style={[styles.navBtnText, activeSection === 'stock' && styles.navBtnTextActive]}>📦 Stock</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.navBtn, activeSection === 'tickets' && styles.navBtnActive]}
                      onPress={() => setActiveSection('tickets')}
                    >
                      <Text style={[styles.navBtnText, activeSection === 'tickets' && styles.navBtnTextActive]}>
                        🧾 Tickets
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.navBtn, activeSection === 'parametres' && styles.navBtnActive]}
                      onPress={() => setActiveSection('parametres')}
                    >
                      <Text style={[styles.navBtnText, activeSection === 'parametres' && styles.navBtnTextActive]}>
                        ⚙️ Paramètres
                      </Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            </View>

            <View>
              <Text style={styles.sidebarSession}>Session: {session.username}</Text>
              <Text style={styles.topBadge}>{session.role === 'admin' ? 'ADMIN' : 'STAFF'}</Text>
              <Pressable style={styles.logoutBtn} onPress={onLogout}>
                <Text style={styles.logoutText}>Déconnexion</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={[styles.rightPanel, activeSection !== 'vente' && { display: 'none' }]}>
          {!isSidebarVisible ? (
            <View style={styles.salesTopRow}>
              <Pressable style={styles.sidebarCollapsedBtn} onPress={() => setIsSidebarVisible(true)}>
                <Text style={styles.sidebarCollapsedBtnIcon}>☰</Text>
                <Text style={styles.sidebarCollapsedBtnText}>Menu</Text>
              </Pressable>
            </View>
          ) : null}

          <Text style={styles.panelTitle}>Commande</Text>

          <View style={styles.metaRow}>
            <Pressable
              style={styles.sansSauceQuickBtn}
              onPress={() => setNote((prev) => prev ? `${prev}, sans sauce` : 'sans sauce')}
            >
              <Text style={styles.sansSauceQuickBtnText}>Sans sauce</Text>
            </Pressable>
            <TextInput
              style={[styles.input, styles.noteInput]}
              value={note}
              onChangeText={setNote}
              placeholder="Note cuisine"
              placeholderTextColor={COLORS.muted}
            />
          </View>

          <View style={styles.orderTypeRow}>
            <Pressable
              style={[styles.orderTypeBtn, orderType === 'sur_place' && styles.orderTypeBtnActive]}
              onPress={() => setOrderType('sur_place')}
            >
              <Text style={[styles.orderTypeBtnText, orderType === 'sur_place' && styles.orderTypeBtnTextActive]}>
                Sur place
              </Text>
            </Pressable>
            <Pressable
              style={[styles.orderTypeBtn, orderType === 'a_emporter' && styles.orderTypeBtnActive]}
              onPress={() => setOrderType('a_emporter')}
            >
              <Text style={[styles.orderTypeBtnText, orderType === 'a_emporter' && styles.orderTypeBtnTextActive]}>
                À emporter
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.cartList} contentContainerStyle={styles.cartListContent}>
            {hasCartItems ? (
              cart.map((line) => (
                <View key={line.lineId} style={styles.cartLine}>
                  <View style={styles.cartLineMain}>
                    <Text style={styles.cartLineTitle}>{line.product.name}</Text>
                    <Text style={styles.cartLineSub}>{lineTotal(line).toFixed(2)}€</Text>
                    {line.kind === 'menu' && line.menuItems ? (
                      <View style={styles.menuSubLines}>
                        {line.menuItems.map((mi) => (
                          <Text key={`${line.lineId}-${mi.role}-${mi.product.id}`} style={styles.menuSubLine}>
                            • {mi.product.name}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.qtyControls}>
                    <Pressable style={styles.qtyBtn} onPress={() => updateQty(line.lineId, 'dec')}>
                      <Text style={styles.qtyTxt}>-</Text>
                    </Pressable>
                    <Text style={styles.qtyValue}>{line.quantity}</Text>
                    <Pressable style={styles.qtyBtn} onPress={() => updateQty(line.lineId, 'inc')}>
                      <Text style={styles.qtyTxt}>+</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyCartBox}>
                <Text style={styles.emptyCartText}>Panier vide</Text>
                <Text style={styles.emptyCartSub}>Ajoute des articles pour afficher totaux et actions.</Text>
              </View>
            )}
          </ScrollView>

          {hasCartItems ? (
            <>
              <View style={styles.totalsBox}>
                <Text style={styles.totalStrong}>Total TTC: {totalTtc.toFixed(2)}€</Text>
                <Pressable onPress={() => setShowTaxDetails((v) => !v)}>
                  <Text style={styles.taxToggle}>{showTaxDetails ? '▾ Masquer détail fiscal' : '▸ Détail fiscal'}</Text>
                </Pressable>
                {showTaxDetails ? (
                  <>
                    <Text style={styles.totalLine}>Brut TTC: {rawTotalTtc.toFixed(2)}€</Text>
                    <Text style={styles.totalLine}>Total HT: {totalHt.toFixed(2)}€</Text>
                    {taxLines.map((line) => (
                      <Text key={line.rate} style={styles.totalLine}>
                        TVA {(line.rate * 100).toFixed(1)}% ({line.code}): {line.tax.toFixed(2)}€
                      </Text>
                    ))}
                  </>
                ) : null}
              </View>

              <View style={styles.actionsCol}>
                <Pressable
                  style={[styles.primaryBtn, isBusy && styles.primaryBtnDisabled]}
                  onPress={handleSendKitchen}
                  disabled={isBusy}
                >
                  <Text style={styles.primaryBtnText}>{isSendingKitchen ? 'Envoi en cours…' : 'Envoyer cuisine'}</Text>
                </Pressable>

                <View style={styles.payRow}>
                  <Pressable
                    style={[styles.secondaryBtn, isBusy && styles.primaryBtnDisabled]}
                    onPress={() => handlePay('especes')}
                    disabled={isBusy}
                  >
                    <Text style={styles.secondaryBtnText}>
                      {payingMethod === 'especes' ? 'Encaissement espèces…' : 'Paiement espèces'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.secondaryBtn, isBusy && styles.primaryBtnDisabled]}
                    onPress={() => handlePay('carte')}
                    disabled={isBusy}
                  >
                    <Text style={styles.secondaryBtnText}>
                      {payingMethod === 'carte' ? 'Encaissement carte…' : 'Paiement carte'}
                    </Text>
                  </Pressable>
                </View>

                <Pressable
                  style={[styles.secondaryBtn, isBusy && styles.primaryBtnDisabled]}
                  onPress={() => setOtherPayModalVisible(true)}
                  disabled={isBusy}
                >
                  <Text style={styles.secondaryBtnText}>Autre moyen</Text>
                </Pressable>

                <Pressable style={[styles.clearBtn, isBusy && styles.primaryBtnDisabled]} onPress={resetOrder} disabled={isBusy}>
                  <Text style={styles.secondaryBtnText}>Vider commande</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.salesArea}>
          {activeSection === 'vente' ? (
            <View style={styles.salesPanel}>
              <View style={styles.tunnelRow}>
                {(Object.keys(SALE_TUNNEL_STEPS) as SaleTunnelStep[]).map((step) => (
                  <Pressable
                    key={step}
                    style={[styles.tunnelBtn, saleStep === step && styles.tunnelBtnActive]}
                    onPress={() => setSaleStep(step)}
                    android_ripple={{ color: '#39FF5A33' }}
                  >
                    {SALE_TUNNEL_STEPS[step].icon ? (
                      <Text style={styles.tunnelBtnIcon}>{SALE_TUNNEL_STEPS[step].icon}</Text>
                    ) : null}
                    {SALE_TUNNEL_STEPS[step].label ? (
                      <Text style={[styles.tunnelBtnText, step === 'menu' && { color: COLORS.accent }, saleStep === step && styles.tunnelBtnTextActive]}>
                        {SALE_TUNNEL_STEPS[step].label}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>

              {saleStep === 'menu' ? (
                <View style={styles.menuFlowContainer}>
                  <View style={styles.menuTypeRow}>
                    {(Object.keys(MENU_FLOW_LABELS) as MenuFlowType[]).map((flow) => (
                      <Pressable
                        key={flow}
                        style={[styles.menuTypeBtn, menuFlowType === flow && styles.menuTypeBtnActive]}
                        onPress={() => handleMenuFlowChange(flow)}
                      >
                        <Text style={[styles.menuTypeBtnText, menuFlowType === flow && styles.menuTypeBtnTextActive]}>
                          {MENU_FLOW_LABELS[flow]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <View style={styles.menuStageRow}>
                    {currentMenuStages.map((stage) => {
                      const disabled = !canOpenStage(stage);
                      return (
                        <Pressable
                          key={stage}
                          style={[
                            styles.menuStageBtn,
                            menuStage === stage && styles.menuStageBtnActive,
                            disabled && styles.menuStageBtnLocked,
                          ]}
                          onPress={() => setMenuStage(stage)}
                          disabled={disabled}
                        >
                          <Text style={[styles.menuStageText, menuStage === stage && styles.menuStageTextActive]}>
                            {MENU_STAGE_LABELS[stage]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.menuStageHint}>{menuStageHint}</Text>

                  <View style={styles.menuSummary}>
                    <View style={styles.menuSummaryRow}>
                      <Text style={styles.menuSummaryText}>Principal</Text>
                      <Text style={styles.menuSummaryValue}>{selectedMenuMain?.name ?? '-'}</Text>
                    </View>
                    <View style={styles.menuSummaryRow}>
                      <Text style={styles.menuSummaryText}>Accompagnement</Text>
                      <Text style={styles.menuSummaryValue}>
                        {selectedMenuSide?.name ?? '-'}
                        {selectedMenuSide && (selectedMenuSide.menuSupplement ?? 0) > 0
                          ? ` (+${selectedMenuSide.menuSupplement!.toFixed(2)}€)`
                          : ''}
                      </Text>
                    </View>
                    <View style={styles.menuSummaryRow}>
                      <Text style={styles.menuSummaryText}>Boisson</Text>
                      <Text style={styles.menuSummaryValue}>{selectedMenuDrink?.name ?? '-'}</Text>
                    </View>
                    {menuFlowType !== 'menu_kids' ? (
                      <View style={styles.menuSummaryRow}>
                        <Text style={styles.menuSummaryText}>Sauce</Text>
                        <Text style={styles.menuSummaryValue}>{selectedMenuSauce?.name ?? '-'}</Text>
                      </View>
                    ) : (
                      <>
                        <View style={styles.menuSummaryRow}>
                          <Text style={styles.menuSummaryText}>Dessert</Text>
                          <Text style={styles.menuSummaryValue}>{selectedMenuDessert?.name ?? '-'}</Text>
                        </View>
                        <View style={styles.menuSummaryRow}>
                          <Text style={styles.menuSummaryText}>Jouet</Text>
                          <Text style={styles.menuSummaryValue}>{selectedMenuToy?.name ?? '-'}</Text>
                        </View>
                      </>
                    )}
                    <Pressable style={styles.menuResetBtn} onPress={resetComposedMenu}>
                      <Text style={styles.menuResetBtnText}>Réinitialiser</Text>
                    </Pressable>
                  </View>

                  <FlatList
                    data={menuDisplayedProducts}
                    keyExtractor={(item) => item.id}
                    numColumns={4}
                    style={styles.productsList}
                    contentContainerStyle={styles.productsGrid}
                    columnWrapperStyle={styles.productsRow}
                    renderItem={({ item }) => {
                      const isSelected =
                        item.id === selectedMenuMainId || item.id === selectedMenuSideId || item.id === selectedMenuDrinkId || item.id === selectedMenuSauceId || item.id === selectedMenuDessertId || item.id === selectedMenuToyId;
                      return (
                        <Pressable
                          style={[styles.productCard, isSelected && styles.productCardSelected]}
                          onPress={() => handlePickMenuProduct(item)}
                          android_ripple={{ color: '#39FF5A33' }}
                        >
                          {getProductImage(item) ? (
                            <Image source={getProductImage(item)} contentFit="cover" style={styles.productImage} />
                          ) : (
                            <View style={[styles.productImage, styles.imageFallback]} />
                          )}
                          <Text numberOfLines={2} style={styles.productName}>
                            {item.name}
                          </Text>
                          <Text style={styles.productPrice}>{item.price.toFixed(2)}€</Text>
                          {(item.menuSupplement ?? 0) > 0 ? (
                            <Text style={styles.productSupplement}>+{item.menuSupplement!.toFixed(2)}€ suppl.</Text>
                          ) : null}
                        </Pressable>
                      );
                    }}
                  />
                </View>
              ) : (
                <FlatList
                  data={saleStep === 'sauce' ? [...filteredProducts, { id: '__sans_sauce__', name: 'Sans sauce', price: 0, category: 'sauces' as const, slug: 'sans_sauce', sendToKitchen: false, active: true }] : filteredProducts}
                  keyExtractor={(item) => item.id}
                  numColumns={4}
                  style={styles.productsList}
                  contentContainerStyle={styles.productsGrid}
                  columnWrapperStyle={styles.productsRow}
                  renderItem={({ item }) => {
                    if (item.id === '__sans_sauce__') {
                      return (
                        <Pressable
                          style={[styles.productCard, styles.sansSauceCard]}
                          onPress={() => setNote((prev) => prev ? `${prev}, sans sauce` : 'sans sauce')}
                          android_ripple={{ color: '#39FF5A33' }}
                        >
                          <View style={[styles.productImage, styles.sansSauceImageFallback]}>
                            <Text style={styles.sansSauceEmoji}>🚫</Text>
                          </View>
                          <Text numberOfLines={2} style={styles.productName}>Sans sauce</Text>
                          <Text style={styles.productPrice}>0.00€</Text>
                        </Pressable>
                      );
                    }
                    return (
                      <Pressable style={styles.productCard} onPress={() => addProductToCart(item)} android_ripple={{ color: '#39FF5A33' }}>
                        {getProductImage(item) ? (
                          <Image source={getProductImage(item)} contentFit="cover" style={styles.productImage} />
                        ) : (
                          <View style={[styles.productImage, styles.imageFallback]} />
                        )}
                        <Text numberOfLines={2} style={styles.productName}>
                          {item.name}
                        </Text>
                        <Text style={styles.productPrice}>{item.price.toFixed(2)}€</Text>
                      </Pressable>
                    );
                  }}
                />
              )}
            </View>
          ) : null}

          {activeSection === 'stock' && session.role === 'admin' ? (
            <View style={styles.salesPanel}>
              <View style={styles.stockHeader}>
                <Text style={styles.panelTitle}>Stock produits</Text>
                <Pressable style={styles.stockAddBtn} onPress={() => openProductForm()}>
                  <Text style={styles.stockAddBtnText}>+ Nouveau</Text>
                </Pressable>
              </View>

              <View style={styles.stockFilters}>
                <TextInput
                  style={[styles.input, styles.stockSearchInput]}
                  value={stockSearch}
                  onChangeText={setStockSearch}
                  placeholder="Rechercher…"
                  placeholderTextColor={COLORS.muted}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stockCategoryScroll}>
                  <Pressable
                    style={[styles.stockCatChip, stockFilter === 'all' && styles.stockCatChipActive]}
                    onPress={() => setStockFilter('all')}
                  >
                    <Text style={[styles.stockCatChipText, stockFilter === 'all' && styles.stockCatChipTextActive]}>
                      Tous ({allProducts.length})
                    </Text>
                  </Pressable>
                  {CATEGORIES.map((cat) => (
                    <Pressable
                      key={cat}
                      style={[styles.stockCatChip, stockFilter === cat && styles.stockCatChipActive]}
                      onPress={() => setStockFilter(cat)}
                    >
                      <Text style={[styles.stockCatChipText, stockFilter === cat && styles.stockCatChipTextActive]}>
                        {CATEGORY_LABELS[cat]}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <ScrollView style={styles.stockList} showsVerticalScrollIndicator>
                {filteredStockProducts.length ? (
                  filteredStockProducts.map((item) => (
                    <View key={item.id} style={styles.stockLine}>
                      <Pressable style={styles.stockInfoPress} onPress={() => openProductForm(item)}>
                        <Text numberOfLines={1} style={styles.stockName}>{item.name}</Text>
                        <Text style={styles.stockMeta}>
                          {item.price.toFixed(2)}€ · {CATEGORY_LABELS[item.category]}
                          {item.menuPrice ? ` · Menu ${item.menuPrice.toFixed(2)}€` : ''}
                        </Text>
                      </Pressable>
                      <View style={styles.stockActions}>
                        <Pressable
                          style={[styles.stockToggle, item.active ? styles.stockActive : styles.stockInactive]}
                          onPress={() => handleToggleStock(item.id, !item.active)}
                        >
                          <Text style={styles.stockToggleText}>{item.active ? 'Actif' : 'Inactif'}</Text>
                        </Pressable>
                        <Pressable style={styles.stockEditBtn} onPress={() => openProductForm(item)}>
                          <Text style={styles.stockEditBtnText}>✎</Text>
                        </Pressable>
                        <Pressable style={styles.stockDeleteBtn} onPress={() => handleDeleteProduct(item)}>
                          <Text style={styles.stockDeleteBtnText}>✕</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyCartSub}>Aucun produit trouvé.</Text>
                )}
              </ScrollView>
            </View>
          ) : null}

          {activeSection === 'tickets' && session.role === 'admin' ? (
            <View style={styles.salesPanel}>
              <Text style={styles.panelTitle}>Tickets caisse</Text>
              <Text style={styles.adminStat}>Tickets imprimés sauvegardés</Text>
              <Pressable
                style={[styles.ticketDeleteBtn, isDeletingTickets && styles.primaryBtnDisabled]}
                onPress={handleDeleteAllTickets}
                disabled={isDeletingTickets}
              >
                <Text style={styles.secondaryBtnText}>
                  {isDeletingTickets ? 'Suppression en cours…' : 'Supprimer anciens tickets'}
                </Text>
              </Pressable>

              <View style={styles.ticketLayout}>
                <ScrollView style={styles.ticketList} contentContainerStyle={styles.ticketListContent}>
                  {tickets.length ? (
                    tickets.map((ticket) => (
                      <Pressable
                        key={ticket.id}
                        style={[styles.ticketItem, selectedTicketId === ticket.id && styles.ticketItemActive]}
                        onPress={() => setSelectedTicketId(ticket.id)}
                      >
                        <Text style={styles.ticketItemTitle}>
                          #{ticket.ticketNumber} · {getTicketTypeLabel(ticket)} · {formatTicketDate(ticket.createdAt)}
                        </Text>
                        <Text style={styles.ticketItemSub}>
                          {ticket.total.toFixed(2)}€ · {formatPaymentMethodLabel(ticket.paymentMethod)}
                        </Text>
                        <View style={styles.ticketThumbPaper}>
                          <Text numberOfLines={5} style={styles.ticketThumbText}>
                            {ticket.cashTicketText ?? 'Ticket sans texte enregistré.'}
                          </Text>
                        </View>
                      </Pressable>
                    ))
                  ) : (
                    <Text style={styles.emptyCartSub}>Aucun ticket encore enregistré.</Text>
                  )}
                </ScrollView>

                <View style={styles.ticketPreview}>
                  {selectedTicket ? (
                    <>
                      <Text style={styles.ticketPreviewTitle}>
                        Ticket #{selectedTicket.ticketNumber} · {getTicketTypeLabel(selectedTicket)}
                      </Text>
                      <Text style={styles.ticketPreviewMeta}>
                        {formatTicketDate(selectedTicket.createdAt)} ·{' '}
                        {formatPaymentMethodLabel(selectedTicket.paymentMethod)} · {selectedTicket.total.toFixed(2)}€
                      </Text>
                      <View style={styles.ticketModeRow}>
                        <Pressable
                          style={[styles.ticketModeBtn, ticketPreviewMode === 'caisse' && styles.ticketModeBtnActive]}
                          onPress={() => setTicketPreviewMode('caisse')}
                        >
                          <Text
                            style={[
                              styles.ticketModeBtnText,
                              ticketPreviewMode === 'caisse' && styles.ticketModeBtnTextActive,
                            ]}
                          >
                            Caisse
                          </Text>
                        </Pressable>
                        <Pressable
                          style={[styles.ticketModeBtn, ticketPreviewMode === 'cuisine' && styles.ticketModeBtnActive]}
                          onPress={() => setTicketPreviewMode('cuisine')}
                        >
                          <Text
                            style={[
                              styles.ticketModeBtnText,
                              ticketPreviewMode === 'cuisine' && styles.ticketModeBtnTextActive,
                            ]}
                          >
                            Cuisine
                          </Text>
                        </Pressable>
                      </View>
                      <ScrollView style={styles.ticketPreviewBody} contentContainerStyle={styles.ticketPreviewBodyContent}>
                        <View style={styles.ticketPaper}>
                          <Text style={styles.ticketPaperText}>{selectedTicketPreviewText}</Text>
                        </View>
                      </ScrollView>
                      <View style={styles.ticketCorrectionRow}>
                        <Pressable
                          style={[styles.ticketCopyBtn, isReprintingCopy && styles.primaryBtnDisabled]}
                          onPress={handleReprintCopy}
                          disabled={isReprintingCopy}
                        >
                          <Text style={styles.ticketActionBtnText} numberOfLines={2}>
                            {isReprintingCopy ? 'Duplicata en cours…' : 'Imprimer duplicata'}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={[styles.ticketCorrectionBtn, !canCorrectSelectedTicket && styles.primaryBtnDisabled]}
                          onPress={() => openTicketCorrection('cancel')}
                          disabled={!canCorrectSelectedTicket}
                        >
                          <Text style={styles.ticketActionBtnText} numberOfLines={2}>Annuler ticket</Text>
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <Text style={styles.ticketPreviewEmpty}>Sélectionne un ticket pour voir le détail.</Text>
                  )}
                </View>
              </View>
            </View>
          ) : null}

          {activeSection === 'parametres' && session.role === 'admin' ? (
            <View style={styles.salesPanel}>
              <Text style={styles.panelTitle}>Paramètres admin</Text>
              <Text style={styles.adminStat}>Commandes du jour: {stats.ordersCount}</Text>
              <Text style={[styles.adminStat, { marginBottom: 12 }]}>CA du jour: {stats.revenue.toFixed(2)}€</Text>

              <TextInput
                style={[styles.input, { marginBottom: 10 }]}
                value={settings.cashPrinterUrl}
                onChangeText={(value) => setSettings((prev) => ({ ...prev, cashPrinterUrl: value }))}
                placeholder="URL imprimante caisse (IP Epson)"
                placeholderTextColor={COLORS.muted}
              />
              <TextInput
                style={styles.input}
                value={settings.kitchenPrinterUrl}
                onChangeText={(value) => setSettings((prev) => ({ ...prev, kitchenPrinterUrl: value }))}
                placeholder="URL imprimante cuisine (IP Epson)"
                placeholderTextColor={COLORS.muted}
              />

              <View style={styles.printerScanRow}>
                <TextInput
                  style={[styles.input, styles.scanSubnetInput]}
                  value={scanSubnet}
                  onChangeText={setScanSubnet}
                  placeholder="Sous-réseau (ex: 192.168.1)"
                  placeholderTextColor={COLORS.muted}
                />
                <TextInput
                  style={[styles.input, styles.scanRangeInput]}
                  value={scanStart}
                  onChangeText={setScanStart}
                  keyboardType="number-pad"
                  placeholder="Début"
                  placeholderTextColor={COLORS.muted}
                />
                <TextInput
                  style={[styles.input, styles.scanRangeInput]}
                  value={scanEnd}
                  onChangeText={setScanEnd}
                  keyboardType="number-pad"
                  placeholder="Fin"
                  placeholderTextColor={COLORS.muted}
                />
              </View>

              <View style={styles.reportActionsRow}>
                <Pressable
                  style={[styles.secondaryBtn, isDiscoveringPrinters && styles.primaryBtnDisabled]}
                  onPress={handleDiscoverPrinters}
                  disabled={isDiscoveringPrinters}
                >
                  <Text style={styles.secondaryBtnText}>
                    {isDiscoveringPrinters ? 'Détection…' : 'Détecter imprimantes'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryBtn, isTestingCashPrinter && styles.primaryBtnDisabled]}
                  onPress={handleTestCashPrinter}
                  disabled={isTestingCashPrinter}
                >
                  <Text style={styles.secondaryBtnText}>{isTestingCashPrinter ? 'Test caisse…' : 'Tester caisse'}</Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryBtn, isTestingKitchenPrinter && styles.primaryBtnDisabled]}
                  onPress={handleTestKitchenPrinter}
                  disabled={isTestingKitchenPrinter}
                >
                  <Text style={styles.secondaryBtnText}>{isTestingKitchenPrinter ? 'Test cuisine…' : 'Tester cuisine'}</Text>
                </Pressable>
              </View>

              {discoveredPrinters.length ? (
                <View style={styles.discoveredPrintersCard}>
                  <Text style={styles.reportTitle}>Imprimantes détectées</Text>
                  {discoveredPrinters.map((printer) => (
                    <View key={printer.ip} style={styles.discoveredPrinterRow}>
                      <Text style={styles.discoveredPrinterText}>{printer.ip}</Text>
                      <View style={styles.discoveredPrinterActions}>
                        <Pressable
                          style={styles.discoveredPrinterBtn}
                          onPress={() => handleApplyDetectedPrinter(printer.url, 'cash')}
                        >
                          <Text style={styles.discoveredPrinterBtnText}>Caisse</Text>
                        </Pressable>
                        <Pressable
                          style={styles.discoveredPrinterBtn}
                          onPress={() => handleApplyDetectedPrinter(printer.url, 'kitchen')}
                        >
                          <Text style={styles.discoveredPrinterBtnText}>Cuisine</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={[styles.payRow, { marginTop: 14 }]}>
                <Pressable style={styles.secondaryBtn} onPress={handleSaveSettings}>
                  <Text style={styles.secondaryBtnText}>Sauvegarder imprimantes</Text>
                </Pressable>
              </View>

              <View style={styles.reportCard}>
                <Text style={styles.reportTitle}>Changer un code PIN</Text>
                <View style={{ gap: 8, marginTop: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {getUsernames().map((u) => (
                      <Pressable
                        key={u}
                        style={[styles.secondaryBtn, changePinUser === u && { backgroundColor: COLORS.accent }]}
                        onPress={() => { setChangePinUser(u); setChangePinValue(''); setChangePinConfirm(''); }}
                      >
                        <Text style={[styles.secondaryBtnText, changePinUser === u && { color: '#000' }]}>
                          {u === 'admin' ? 'Manager' : 'Staff'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {changePinUser ? (
                    <>
                      <Text style={styles.reportText}>Nouveau code pour « {changePinUser === 'admin' ? 'Manager' : 'Staff'} » (4 chiffres)</Text>
                      <TextInput
                        style={styles.input}
                        value={changePinValue}
                        onChangeText={(t) => setChangePinValue(t.replace(/[^0-9]/g, '').slice(0, 4))}
                        placeholder="Nouveau code PIN"
                        placeholderTextColor={COLORS.muted}
                        keyboardType="number-pad"
                        secureTextEntry
                        maxLength={4}
                      />
                      <TextInput
                        style={styles.input}
                        value={changePinConfirm}
                        onChangeText={(t) => setChangePinConfirm(t.replace(/[^0-9]/g, '').slice(0, 4))}
                        placeholder="Confirmer le code PIN"
                        placeholderTextColor={COLORS.muted}
                        keyboardType="number-pad"
                        secureTextEntry
                        maxLength={4}
                      />
                      <Pressable
                        style={styles.secondaryBtn}
                        onPress={async () => {
                          if (changePinValue.length !== 4) {
                            showToast('Le code doit faire 4 chiffres.', 'error');
                            return;
                          }
                          if (changePinValue !== changePinConfirm) {
                            showToast('Les codes ne correspondent pas.', 'error');
                            return;
                          }
                          try {
                            await saveUserPin(changePinUser, changePinValue);
                            applyUserPins({ [changePinUser]: changePinValue });
                            const allPins = await loadUserPins();
                            applyUserPins(allPins);
                            showToast(`Code PIN de « ${changePinUser === 'admin' ? 'Manager' : 'Staff'} » mis à jour.`);
                            setChangePinUser('');
                            setChangePinValue('');
                            setChangePinConfirm('');
                          } catch {
                            showToast('Erreur lors du changement de code.', 'error');
                          }
                        }}
                      >
                        <Text style={styles.secondaryBtnText}>Valider le changement</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </View>

              <View style={styles.reportCard}>
                <Text style={styles.reportTitle}>Rapport journalier</Text>
                <Text style={styles.reportText}>Période: Aujourd'hui</Text>
                <Text style={styles.reportText}>Tickets: {stats.ordersCount}</Text>
                <Text style={styles.reportText}>CA: {stats.revenue.toFixed(2)}€</Text>
                <Pressable
                  style={[styles.secondaryBtn, { marginTop: 12, paddingVertical: 8 }]}
                  onPress={handlePrintFlashReport}
                  disabled={isPrintingFlash}
                >
                  <Text style={[styles.secondaryBtnText, { fontSize: 13 }]}>
                    {isPrintingFlash ? 'Impression...' : '🖨 Imprimer Flash'}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.reportCard}>
                <Text style={styles.reportTitle}>Rapport hebdomadaire</Text>
                <Text style={styles.reportText}>Période: 7 derniers jours</Text>
                <Text style={styles.reportText}>Tickets: {weeklyStats.ordersCount}</Text>
                <Text style={styles.reportText}>CA: {weeklyStats.revenue.toFixed(2)}€</Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>

      {!!message && (
        <View style={[styles.message, messageType === 'error' ? styles.messageError : styles.messageSuccess]}>
          <Text style={[styles.messageIcon, messageType === 'error' ? styles.messageIconError : styles.messageIconSuccess]}>
            {messageType === 'error' ? '⚠' : '✓'}
          </Text>
          <Text style={styles.messageText}>{message}</Text>
        </View>
      )}

      <Modal visible={productFormVisible} transparent animationType="fade">
        <View style={styles.correctionBackdrop}>
          <View style={styles.productFormCard}>
            <Text style={styles.correctionTitle}>
              {editingProduct ? `Modifier « ${editingProduct.name} »` : 'Nouveau produit'}
            </Text>

            <ScrollView style={styles.productFormBody} showsVerticalScrollIndicator={false}>
              <Text style={styles.productFormLabel}>Nom *</Text>
              <TextInput
                style={styles.input}
                value={formName}
                onChangeText={setFormName}
                placeholder="Ex: Le Cheese"
                placeholderTextColor={COLORS.muted}
              />

              <View style={styles.productFormRow}>
                <View style={styles.productFormCol}>
                  <Text style={styles.productFormLabel}>Prix TTC (€) *</Text>
                  <TextInput
                    style={styles.input}
                    value={formPrice}
                    onChangeText={setFormPrice}
                    placeholder="0.00"
                    placeholderTextColor={COLORS.muted}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.productFormCol}>
                  <Text style={styles.productFormLabel}>Prix menu (€)</Text>
                  <TextInput
                    style={styles.input}
                    value={formMenuPrice}
                    onChangeText={setFormMenuPrice}
                    placeholder="Optionnel"
                    placeholderTextColor={COLORS.muted}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>

              <View style={styles.productFormRow}>
                <View style={styles.productFormCol}>
                  <Text style={styles.productFormLabel}>Supplément menu (€)</Text>
                  <TextInput
                    style={styles.input}
                    value={formMenuSupplement}
                    onChangeText={setFormMenuSupplement}
                    placeholder="Optionnel"
                    placeholderTextColor={COLORS.muted}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.productFormCol}>
                  <Text style={styles.productFormLabel}>Clé image</Text>
                  <TextInput
                    style={styles.input}
                    value={formImageUri ? '(image uploadée)' : formImageKey}
                    onChangeText={(t) => { setFormImageKey(t); setFormImageUri(''); }}
                    placeholder="ex: le_cheese"
                    placeholderTextColor={COLORS.muted}
                    editable={!formImageUri}
                  />
                </View>
              </View>

              <Text style={styles.productFormLabel}>Image produit</Text>
              <View style={styles.imagePickerRow}>
                {(formImageUri || (formImageKey && !formImageUri)) ? (
                  <Image
                    source={formImageUri ? { uri: formImageUri } : PRODUCT_IMAGES[formImageKey] ?? undefined}
                    style={styles.imagePickerPreview}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.imagePickerPreview, styles.imagePickerPlaceholder]}>
                    <Text style={styles.imagePickerPlaceholderText}>📷</Text>
                  </View>
                )}
                <View style={styles.imagePickerActions}>
                  <Pressable style={styles.imagePickerBtn} onPress={pickProductImage}>
                    <Text style={styles.imagePickerBtnText}>{formImageUri ? 'Changer image' : 'Uploader image'}</Text>
                  </Pressable>
                  {(formImageUri || formImageKey) ? (
                    <Pressable style={[styles.imagePickerBtn, styles.imagePickerRemoveBtn]} onPress={removeProductImage}>
                      <Text style={styles.imagePickerRemoveBtnText}>Supprimer</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              <Text style={styles.productFormLabel}>Catégorie</Text>
              <View style={styles.productFormCatRow}>
                {CATEGORIES.map((cat) => (
                  <Pressable
                    key={cat}
                    style={[styles.stockCatChip, formCategory === cat && styles.stockCatChipActive]}
                    onPress={() => setFormCategory(cat)}
                  >
                    <Text style={[styles.stockCatChipText, formCategory === cat && styles.stockCatChipTextActive]}>
                      {CATEGORY_LABELS[cat]}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.productFormToggles}>
                <Pressable
                  style={[styles.productFormToggle, formSendToKitchen && styles.productFormToggleActive]}
                  onPress={() => setFormSendToKitchen(!formSendToKitchen)}
                >
                  <Text style={[styles.productFormToggleText, formSendToKitchen && styles.productFormToggleTextActive]}>
                    {formSendToKitchen ? '🍳 Envoi cuisine' : '🚫 Pas en cuisine'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.productFormToggle, formActive && styles.productFormToggleActive]}
                  onPress={() => setFormActive(!formActive)}
                >
                  <Text style={[styles.productFormToggleText, formActive && styles.productFormToggleTextActive]}>
                    {formActive ? '✓ Actif' : '✗ Inactif'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>

            <View style={styles.correctionActions}>
              <Pressable
                style={[styles.secondaryBtn, isSavingProduct && styles.primaryBtnDisabled]}
                onPress={closeProductForm}
                disabled={isSavingProduct}
              >
                <Text style={styles.secondaryBtnText}>Annuler</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, isSavingProduct && styles.primaryBtnDisabled]}
                onPress={handleSaveProduct}
                disabled={isSavingProduct}
              >
                <Text style={styles.primaryBtnText}>
                  {isSavingProduct ? 'Enregistrement…' : editingProduct ? 'Mettre à jour' : 'Créer'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={otherPayModalVisible} transparent animationType="fade">
        <View style={styles.correctionBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOtherPayModalVisible(false)} />
          <View style={styles.otherPayCard}>
            <Text style={styles.correctionTitle}>Autre moyen de paiement</Text>
            <View style={styles.otherPayGrid}>
              {[
                { label: 'Chèque', icon: '🏦' },
                { label: 'Ticket Restaurant', icon: '🎫' },
                { label: 'Chèque Vacances', icon: '🏖️' },
                { label: 'Titre Restaurant CB', icon: '💳', isTrCb: true },
              ].map((m: { label: string; icon: string; isTrCb?: boolean }) => (
                <Pressable
                  key={m.label}
                  style={styles.otherPayOption}
                  onPress={() => {
                    if (m.isTrCb) {
                      setOtherPayModalVisible(false);
                      setTrCbModalVisible(true);
                    } else {
                      setOtherPayModalVisible(false);
                      handlePay(m.label);
                    }
                  }}
                  android_ripple={{ color: '#39FF5A33' }}
                >
                  <Text style={styles.otherPayOptionIcon}>{m.icon}</Text>
                  <Text style={styles.otherPayOptionLabel}>{m.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.correctionSub, { marginTop: 8 }]}>Ou saisir un moyen personnalisé :</Text>
            <View style={styles.customPayRow}>
              <TextInput
                style={[styles.input, styles.customPayInput]}
                value={customPaymentMethod}
                onChangeText={setCustomPaymentMethod}
                placeholder="Ex: PayPal, Lydia…"
                placeholderTextColor={COLORS.muted}
              />
              <Pressable
                style={[
                  styles.secondaryBtn,
                  styles.customPayBtn,
                  !customPaymentMethod.trim() && styles.primaryBtnDisabled,
                ]}
                onPress={() => {
                  setOtherPayModalVisible(false);
                  handlePay(customPaymentMethod.trim());
                }}
                disabled={!customPaymentMethod.trim()}
              >
                <Text style={styles.secondaryBtnText}>Valider</Text>
              </Pressable>
            </View>
            <Pressable
              style={[styles.secondaryBtn, { marginTop: 4 }]}
              onPress={() => setOtherPayModalVisible(false)}
            >
              <Text style={styles.secondaryBtnText}>Fermer</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={trCbModalVisible} transparent animationType="fade">
        <View style={styles.correctionBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setTrCbModalVisible(false)} />
          <View style={styles.otherPayCard}>
            <Text style={styles.correctionTitle}>Titre Restaurant CB</Text>
            <Text style={styles.correctionSub}>Choisissez le prestataire</Text>
            <View style={styles.otherPayGrid}>
              {[
                { label: 'Swile', icon: '🟠' },
                { label: 'Pluxee', icon: '🟣' },
                { label: 'Bimpli', icon: '🟢' },
                { label: 'Up Déjeuner', icon: '🔴' },
              ].map((p) => (
                <Pressable
                  key={p.label}
                  style={styles.otherPayOption}
                  onPress={() => {
                    setTrCbModalVisible(false);
                    handlePay(`TR CB - ${p.label}`);
                  }}
                  android_ripple={{ color: '#39FF5A33' }}
                >
                  <Text style={styles.otherPayOptionIcon}>{p.icon}</Text>
                  <Text style={styles.otherPayOptionLabel}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={[styles.secondaryBtn, { marginTop: 4 }]}
              onPress={() => {
                setTrCbModalVisible(false);
                setOtherPayModalVisible(true);
              }}
            >
              <Text style={styles.secondaryBtnText}>← Retour</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={correctionModalVisible} transparent animationType="fade">
        <View style={styles.correctionBackdrop}>
          <View style={styles.correctionCard}>
            <Text style={styles.correctionTitle}>Annuler ticket</Text>
            <Text style={styles.correctionSub}>Motif obligatoire (traçabilité légale)</Text>
            <TextInput
              style={styles.input}
              value={correctionReason}
              onChangeText={setCorrectionReason}
              placeholder="Ex: erreur de saisie, client insatisfait"
              placeholderTextColor={COLORS.muted}
            />
            <View style={styles.correctionActions}>
              <Pressable
                style={[styles.secondaryBtn, isSavingCorrection && styles.primaryBtnDisabled]}
                onPress={() => setCorrectionModalVisible(false)}
                disabled={isSavingCorrection}
              >
                <Text style={styles.secondaryBtnText}>Fermer</Text>
              </Pressable>
              <Pressable
                style={[styles.clearBtn, isSavingCorrection && styles.primaryBtnDisabled]}
                onPress={submitTicketCorrection}
                disabled={isSavingCorrection}
              >
                <Text style={styles.secondaryBtnText}>
                  {isSavingCorrection ? 'Enregistrement…' : 'Confirmer annulation'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
};

export default function App() {
  console.log('[APP] App() render called');
  const [session, setSession] = useState<UserSession | null>(null);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {!session ? <LoginScreen onLogin={setSession} /> : <PosScreen session={session} onLogout={() => setSession(null)} />}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  screenCenter: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginBox: {
    width: '92%',
    maxWidth: 420,
    alignSelf: 'center',
    borderRadius: 20,
    backgroundColor: COLORS.card,
    padding: 24,
    gap: 14,
    borderWidth: 1,
    borderColor: '#1C1C1C',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  title: {
    color: COLORS.text,
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 13,
  },
  credentials: {
    color: COLORS.muted,
    marginTop: 4,
    textAlign: 'center',
    fontSize: 12,
  },
  codeDisplay: {
    backgroundColor: COLORS.cardSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeDisplayText: {
    color: COLORS.text,
    fontWeight: '800',
    fontSize: 34,
    letterSpacing: 10,
  },
  keypadGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  keypadGridCompact: {
    gap: 6,
  },
  keypadKey: {
    width: '31%',
    minHeight: 64,
    borderRadius: 12,
    backgroundColor: COLORS.cardSoft,
    borderWidth: 1,
    borderColor: '#232323',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keypadKeyCompact: {
    minHeight: 58,
    borderRadius: 10,
  },
  keypadKeyDanger: {
    backgroundColor: '#503736',
    borderColor: '#734D4A',
  },
  keypadKeyText: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
  },
  keypadKeyTextCompact: {
    fontSize: 20,
  },
  loginPrimaryBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginPrimaryBtnText: {
    color: '#051108',
    fontWeight: '800',
    fontSize: 14,
  },
  input: {
    backgroundColor: COLORS.cardSoft,
    borderRadius: 12,
    color: COLORS.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    minHeight: 44,
  },
  noteInput: {
    flex: 1,
  },
  primaryBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    color: '#051108',
    fontWeight: '700',
    fontSize: 15,
  },
  topBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  topTitle: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 16,
  },
  topBadge: {
    color: COLORS.accent,
    fontSize: 12,
    marginTop: 2,
  },
  logoutBtn: {
    backgroundColor: COLORS.cardSoft,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#232323',
    marginTop: 10,
  },
  logoutText: {
    color: COLORS.text,
    fontWeight: '600',
  },
  layout: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  sidebar: {
    width: 210,
    backgroundColor: COLORS.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1A1A1A',
    padding: 14,
    justifyContent: 'space-between',
  },
  sidebarTitle: {
    color: COLORS.text,
    fontWeight: '800',
    fontSize: 20,
  },
  sidebarHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  sidebarToggleBtn: {
    backgroundColor: COLORS.accentSoft,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 12,
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sidebarToggleIcon: {
    color: COLORS.accent,
    fontWeight: '800',
    fontSize: 13,
  },
  sidebarToggleText: {
    color: COLORS.text,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  sidebarSub: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 2,
    marginBottom: 10,
  },
  sidebarCollapsedBtn: {
    minWidth: 94,
    minHeight: 36,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.accentSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 2,
    flexDirection: 'row',
    gap: 6,
  },
  sidebarCollapsedBtnIcon: {
    color: COLORS.accent,
    fontWeight: '800',
    fontSize: 13,
  },
  sidebarCollapsedBtnText: {
    color: COLORS.text,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  navGroup: {
    gap: 10,
    marginTop: 14,
  },
  navBtn: {
    backgroundColor: COLORS.cardSoft,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#232323',
  },
  navBtnActive: {
    backgroundColor: COLORS.accentSoft,
    borderColor: COLORS.accent,
  },
  navBtnText: {
    color: COLORS.muted,
    fontWeight: '700',
  },
  navBtnTextActive: {
    color: COLORS.text,
  },
  sidebarSession: {
    color: COLORS.text,
    fontSize: 13,
    marginBottom: 8,
  },
  salesArea: {
    flex: 2,
  },
  salesTopRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  salesPanel: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1A1A1A',
    padding: 14,
    overflow: 'hidden',
  },
  tunnelRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  tunnelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: COLORS.cardSoft,
    borderWidth: 1.5,
    borderColor: '#232323',
  },
  tunnelBtnActive: {
    backgroundColor: COLORS.accentSoft,
    borderColor: COLORS.accent,
  },
  tunnelBtnIcon: {
    fontSize: 28,
  },
  tunnelBtnText: {
    color: COLORS.muted,
    fontWeight: '700',
    fontSize: 14,
  },
  tunnelBtnTextActive: {
    color: COLORS.text,
  },
  menuFlowContainer: {
    flex: 1,
  },
  menuTypeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  menuTypeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.cardSoft,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#232323',
  },
  menuTypeBtnActive: {
    backgroundColor: COLORS.accentSoft,
    borderColor: COLORS.accent,
  },
  menuTypeBtnText: {
    color: COLORS.muted,
    fontWeight: '700',
    fontSize: 13,
  },
  menuTypeBtnTextActive: {
    color: COLORS.text,
  },
  menuStageRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  menuStageBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#131313',
  },
  menuStageBtnActive: {
    backgroundColor: '#17301F',
  },
  menuStageBtnLocked: {
    opacity: 0.45,
  },
  menuStageText: {
    color: COLORS.muted,
    fontWeight: '700',
    fontSize: 13,
  },
  menuStageTextActive: {
    color: COLORS.text,
  },
  menuStageHint: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  menuSummary: {
    backgroundColor: COLORS.cardSoft,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    gap: 6,
  },
  menuSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuSummaryText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  menuSummaryValue: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
    maxWidth: '70%',
    textAlign: 'right',
  },
  menuResetBtn: {
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  menuResetBtnText: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 13,
  },
  leftPanel: {
    flex: 1.8,
    backgroundColor: COLORS.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1A1A1A',
    padding: 10,
  },
  rightPanel: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1A1A1A',
    padding: 14,
  },
  categoriesRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  categoryBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: COLORS.cardSoft,
  },
  categoryBtnActive: {
    backgroundColor: COLORS.accentSoft,
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  categoryTxt: {
    color: COLORS.muted,
    fontWeight: '600',
  },
  categoryTxtActive: {
    color: COLORS.text,
  },
  productsList: {
    flex: 1,
  },
  productsGrid: {
    paddingBottom: 30,
    gap: 10,
  },
  productsRow: {
    gap: 10,
  },
  productCard: {
    width: '23%',
    backgroundColor: '#101010',
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },
  productCardSelected: {
    borderColor: COLORS.accent,
    borderWidth: 2,
  },
  productImage: {
    width: '100%',
    height: 78,
  },
  imageFallback: {
    backgroundColor: '#151515',
  },
  productName: {
    color: COLORS.text,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  productPrice: {
    color: COLORS.accent,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingBottom: 8,
    paddingTop: 4,
  },
  productSupplement: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingBottom: 6,
    marginTop: -4,
  },
  panelTitle: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 17,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  sansSauceQuickBtn: {
    backgroundColor: COLORS.accentSoft,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1A1A1A',
  },
  sansSauceQuickBtnText: {
    color: COLORS.accent,
    fontWeight: '700',
    fontSize: 12,
  },
  sansSauceCard: {
    borderColor: COLORS.danger,
    borderWidth: 1,
    marginBottom: 10,
  },
  sansSauceImageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A0A0A',
  },
  sansSauceEmoji: {
    fontSize: 36,
  },
  orderTypeRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  orderTypeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.muted,
    alignItems: 'center',
  },
  orderTypeBtnActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSoft,
  },
  orderTypeBtnText: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  orderTypeBtnTextActive: {
    color: COLORS.accent,
  },
  cartList: {
    flex: 1,
    minHeight: 120,
    marginTop: 12,
    backgroundColor: COLORS.cardSoft,
    borderRadius: 12,
    padding: 10,
  },
  cartListContent: {
    flexGrow: 1,
  },
  emptyCartBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  emptyCartText: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 20,
  },
  emptyCartSub: {
    color: COLORS.muted,
    marginTop: 6,
    textAlign: 'center',
  },
  cartLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1F1F1F',
  },
  cartLineMain: {
    flex: 1,
    paddingRight: 10,
  },
  cartLineTitle: {
    color: COLORS.text,
    fontWeight: '600',
  },
  cartLineSub: {
    color: COLORS.muted,
    marginTop: 2,
  },
  menuSubLines: {
    marginTop: 4,
    gap: 2,
  },
  menuSubLine: {
    color: COLORS.muted,
    fontSize: 12,
  },
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qtyBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyTxt: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 16,
  },
  qtyValue: {
    color: COLORS.text,
    minWidth: 20,
    textAlign: 'center',
    fontWeight: '700',
  },
  totalsBox: {
    backgroundColor: COLORS.cardSoft,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    gap: 4,
  },
  totalLine: {
    color: COLORS.text,
  },
  totalStrong: {
    color: COLORS.accent,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 3,
  },
  taxToggle: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
    paddingVertical: 4,
  },
  actionsCol: {
    marginTop: 14,
    gap: 12,
  },
  payRow: {
    flexDirection: 'row',
    gap: 12,
  },
  customPayRow: {
    flexDirection: 'row',
    gap: 12,
  },
  customPayInput: {
    flex: 1,
  },
  customPayBtn: {
    flex: 0.9,
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: COLORS.accentSoft,
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#39FF5A',
  },
  clearBtn: {
    backgroundColor: COLORS.danger,
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 13,
  },
  message: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    zIndex: 100,
  },
  messageSuccess: {
    backgroundColor: COLORS.accentSoft,
    borderColor: COLORS.accent,
  },
  messageError: {
    backgroundColor: '#2A1414',
    borderColor: COLORS.danger,
  },
  messageText: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 12,
    flex: 1,
  },
  messageIcon: {
    fontWeight: '800',
    fontSize: 13,
  },
  messageIconSuccess: {
    color: COLORS.accent,
  },
  messageIconError: {
    color: COLORS.danger,
  },
  adminPanel: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#1F1F1F',
    paddingTop: 14,
    gap: 10,
  },
  adminStat: {
    color: COLORS.text,
    fontSize: 13,
  },
  stockList: {
    flex: 1,
    marginTop: 6,
    backgroundColor: COLORS.cardSoft,
    borderRadius: 10,
    padding: 8,
  },
  stockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stockAddBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  stockAddBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 13,
  },
  stockFilters: {
    marginTop: 12,
    gap: 10,
  },
  stockSearchInput: {
    flex: 0,
  },
  stockCategoryScroll: {
    flexGrow: 0,
  },
  stockCatChip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 6,
  },
  stockCatChipActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSoft,
  },
  stockCatChipText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  stockCatChipTextActive: {
    color: COLORS.accent,
  },
  stockLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1F1F1F',
  },
  stockInfoPress: {
    flex: 1,
    marginRight: 8,
  },
  stockName: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  stockMeta: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 2,
  },
  stockActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stockToggle: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  stockActive: {
    backgroundColor: COLORS.accentSoft,
  },
  stockInactive: {
    backgroundColor: '#493332',
  },
  stockToggleText: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 12,
  },
  stockEditBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#1A2A3A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockEditBtnText: {
    color: '#6DB3F2',
    fontSize: 16,
  },
  stockDeleteBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#3A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockDeleteBtnText: {
    color: COLORS.danger,
    fontSize: 15,
    fontWeight: '700',
  },
  productFormCard: {
    width: '92%',
    maxWidth: 520,
    maxHeight: '85%',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1C1C1C',
  },
  productFormBody: {
    marginTop: 12,
    marginBottom: 12,
  },
  productFormLabel: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 14,
  },
  productFormRow: {
    flexDirection: 'row',
    gap: 12,
  },
  productFormCol: {
    flex: 1,
  },
  productFormCatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  productFormToggles: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  productFormToggle: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    paddingVertical: 10,
    alignItems: 'center',
  },
  productFormToggleActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSoft,
  },
  productFormToggleText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  productFormToggleTextActive: {
    color: COLORS.accent,
  },
  imagePickerRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  imagePickerPreview: {
    width: 90,
    height: 68,
    borderRadius: 10,
    backgroundColor: '#151515',
  },
  imagePickerPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1E1E1E',
    borderStyle: 'dashed',
  },
  imagePickerPlaceholderText: {
    fontSize: 28,
  },
  imagePickerActions: {
    gap: 8,
  },
  imagePickerBtn: {
    backgroundColor: COLORS.accentSoft,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  imagePickerBtnText: {
    color: COLORS.accent,
    fontWeight: '700',
    fontSize: 12,
  },
  imagePickerRemoveBtn: {
    backgroundColor: '#1A0A0A',
  },
  imagePickerRemoveBtnText: {
    color: COLORS.danger,
    fontWeight: '700',
    fontSize: 12,
  },
  ticketLayout: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
  ticketDeleteBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.danger,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  reportActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  printerScanRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  scanSubnetInput: {
    flex: 1.6,
  },
  scanRangeInput: {
    flex: 0.7,
  },
  discoveredPrintersCard: {
    marginTop: 14,
    backgroundColor: COLORS.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    padding: 12,
    gap: 10,
  },
  discoveredPrinterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: '#131313',
    borderWidth: 1,
    borderColor: '#232323',
    borderRadius: 8,
    padding: 8,
  },
  discoveredPrinterText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
  },
  discoveredPrinterActions: {
    flexDirection: 'row',
    gap: 6,
  },
  discoveredPrinterBtn: {
    backgroundColor: COLORS.accentSoft,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  discoveredPrinterBtnText: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 11,
  },
  csvExportBtn: {
    marginTop: 8,
  },
  exportsPathInfo: {
    marginTop: 8,
    color: COLORS.muted,
    fontSize: 11,
  },
  reportCard: {
    marginTop: 14,
    backgroundColor: COLORS.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    padding: 12,
    gap: 4,
  },
  reportTitle: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 2,
  },
  reportText: {
    color: COLORS.muted,
    fontSize: 12,
  },
  closureHistoryCard: {
    marginTop: 10,
    backgroundColor: COLORS.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    padding: 10,
    gap: 8,
    maxHeight: 220,
  },
  closureRow: {
    backgroundColor: '#131313',
    borderWidth: 1,
    borderColor: '#232323',
    borderRadius: 8,
    padding: 8,
    gap: 2,
  },
  closureRowTitle: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 12,
  },
  closureRowText: {
    color: COLORS.muted,
    fontSize: 11,
  },
  closureRowHash: {
    color: COLORS.accent,
    fontSize: 11,
    marginTop: 1,
  },
  auditCard: {
    marginTop: 10,
    backgroundColor: COLORS.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    padding: 10,
    gap: 4,
  },
  auditIssuesBox: {
    marginTop: 6,
    backgroundColor: '#131313',
    borderWidth: 1,
    borderColor: '#232323',
    borderRadius: 8,
    padding: 8,
    gap: 2,
  },
  auditIssueText: {
    color: COLORS.muted,
    fontSize: 11,
  },
  ticketList: {
    flex: 1,
    maxWidth: 280,
    backgroundColor: COLORS.cardSoft,
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: '#1F1F1F',
  },
  ticketListContent: {
    gap: 8,
  },
  ticketItem: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#131313',
    borderWidth: 1,
    borderColor: '#1F1F1F',
  },
  ticketItemActive: {
    borderColor: COLORS.accent,
    backgroundColor: '#102417',
  },
  ticketItemTitle: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 12,
  },
  ticketItemSub: {
    color: COLORS.muted,
    marginTop: 4,
    fontSize: 12,
  },
  ticketThumbPaper: {
    marginTop: 6,
    alignSelf: 'center',
    borderRadius: 6,
    backgroundColor: COLORS.text,
    paddingHorizontal: 6,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  ticketThumbText: {
    color: COLORS.background,
    fontFamily: 'monospace',
    fontSize: 7,
    lineHeight: 10,
  },
  ticketPreview: {
    flex: 2,
    backgroundColor: COLORS.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    padding: 10,
  },
  ticketPreviewTitle: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 15,
  },
  ticketPreviewMeta: {
    color: COLORS.muted,
    marginTop: 2,
    marginBottom: 6,
    fontSize: 12,
  },
  ticketModeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  ticketModeBtn: {
    flex: 1,
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticketModeBtnActive: {
    backgroundColor: COLORS.accentSoft,
    borderColor: COLORS.accent,
  },
  ticketModeBtnText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  ticketModeBtnTextActive: {
    color: COLORS.text,
  },
  ticketPreviewBody: {
    flex: 1,
    marginTop: 4,
  },
  ticketPreviewBodyContent: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  ticketPaper: {
    width: '100%',
    maxWidth: THERMAL_RECEIPT_WIDTH,
    backgroundColor: COLORS.text,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  ticketPaperText: {
    color: COLORS.background,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.15,
  },
  ticketPreviewEmpty: {
    color: COLORS.muted,
    marginTop: 4,
  },
  ticketCorrectionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  ticketCorrectionBtn: {
    flex: 1,
    backgroundColor: '#2C1919',
    borderWidth: 1,
    borderColor: COLORS.danger,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    minHeight: 48,
  },
  ticketCopyBtn: {
    flex: 1,
    backgroundColor: COLORS.accentSoft,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    minHeight: 48,
  },
  ticketActionBtnText: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 11,
    textAlign: 'center',
  },
  correctionBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  correctionCard: {
    width: '92%',
    maxWidth: 520,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    gap: 14,
  },
  correctionSub: {
    color: COLORS.muted,
    fontSize: 12,
  },
  correctionTitle: {
    color: COLORS.text,
    fontWeight: '800',
    fontSize: 16,
  },
  correctionActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  otherPayCard: {
    width: '92%',
    maxWidth: 480,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    gap: 12,
  },
  otherPayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  otherPayOption: {
    width: '31%',
    backgroundColor: COLORS.cardSoft,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#1A1A1A',
  },
  otherPayOptionIcon: {
    fontSize: 28,
  },
  otherPayOptionLabel: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
  },
  initErrorText: {
    textAlign: 'center',
    maxWidth: 420,
    marginTop: 8,
  },
  retryBtn: {
    marginTop: 12,
    minWidth: 180,
  },
});
