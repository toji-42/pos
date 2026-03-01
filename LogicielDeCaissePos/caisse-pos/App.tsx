console.log('[APP] ===== Module loading start =====');
import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    PanResponder,
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
    createPrintJob,
    createProduct,
    deleteProduct,
    getCaisseOpenState,
    getCurrentPeriodTickets,
    getCurrentXSnapshot,
    getPendingPrintJobs,
    getPrintQueueSummary,
    getRecentClosures,
    getPrinterSettings,
    getProducts,
    getRecentTickets,
    getTodayStats,
    getWeeklyStats,
    initDatabase,
    markPrintJobProcessing,
    markPrintJobResult,
    openCaisse,
    closeCaisseState,
    reserveNextTicketNumber,
    saveOrder,
    savePrinterSettings,
    saveUserPin,
    loadUserPins,
    setProductActive,
    setCategoryKitchen,
    setCategorySalle,
    setProductKitchen,
    setProductSalle,
    updateProduct,
} from './src/data/database';
import type { CaisseOpenState } from './src/data/database';
import {
    buildCashTicketDocument,
    buildKitchenTicketDocuments,
    buildKitchenTicketText,
    buildServiceTicketDocument,
    discoverEpsonPrinters,
    openCashDrawer,
    printCashTicket,
    printDailyReport,
    printKitchenTicket,
    printServiceTicket,
    printTestTicket,
    sendPreparedPrintJob,
} from './src/services/epson';
import type { EpsonDiscoveryItem } from './src/services/epson';
import {
    buildUsbPrinterUrl,
    isUsbPrinterSupported,
    listUsbPrinterDevices,
    requestUsbPrinterPermission,
} from './src/services/usbPrinter';
import type { UsbPrinterDevice } from './src/services/usbPrinter';
import {
    AuditReport,
    CartItem,
    ClosureRecord,
    ClosureSnapshot,
    DEFAULT_TICKET_CUSTOMIZATION,
    DailyStats,
    LegalArchiveVerification,
    normalizeTicketCustomization,
    OrderStatus,
    OrderType,
    PrinterSettings,
    TicketCustomization,
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
    salades: 0.1,
    desserts: 0.1,
    boissons: 0.1,
    accompagnements: 0.1,
    sauces: 0.1,
};

const TAX_RATE_A_EMPORTER: Record<ProductCategory, number> = {
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

const getTaxCode = (rate: number) => TAX_CODES.find((entry) => entry.rate === rate)?.code ?? '?';

const SATAY_MARINADES = [
    { label: 'Fried Onions', icon: '🧅' },
    { label: 'Thai', icon: '🌶️' },
    { label: 'Curry', icon: '🍛' },
    { label: 'Barbecue', icon: '🔥' },
    { label: 'Oriental', icon: '🌍' },
    { label: 'Braisée', icon: '🍖' },
    { label: 'Teriyaki', icon: '🥢' },
    { label: 'Kina', icon: '🫚' },
    { label: 'Nature', icon: '🌿' },
];

const SALAD_PROTEIN_OPTIONS = [
    "Crusty Panka'S Smocky x2",
    "Crusty Panka'S Spicy x2",
    "Satay'S x2",
    'Sakitori 2',
    'Double Emmental',
    'Thon',
];

const SALAD_SAUCE_OPTIONS = [
    'César',
    'Miel Moutarde',
    'Sauce Thaï',
    'Sauce Agnel',
    'Vinaigrette',
    "Huile d'olive",
];

const SUNDAE_NAPPAGE_OPTIONS = ['Sans Coulis', 'Choco', 'Caramel', 'Fraise'];
const SUNDAE_CROQUANT_OPTIONS = ['Cacahuète', 'Smarties', 'Kit Kat', 'Crunch', 'Pop Corn', 'Sans Croquant'];
const MAX_SUNDAE_CROQUANTS = 2;

const isSatayProduct = (product: Product) => product.slug?.startsWith('satay_s') ?? false;
const isSaladProduct = (product: Product) => product.category === 'salades';
const isSundaeProduct = (product: Product) => {
    const slug = (product.slug ?? '').toLowerCase();
    if (slug === 'sundae') return true;
    const normalizedName = product.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    return normalizedName.includes('sundae');
};

type BurgerFamilyKey = 'cheese' | 'crown' | 'agnel' | 'buck' | 'kina' | 'racls' | 'stacks' | 'classiques' | 'autres';

const BURGER_FAMILY_ORDER: BurgerFamilyKey[] = [
    'cheese',
    'crown',
    'agnel',
    'buck',
    'kina',
    'racls',
    'stacks',
    'classiques',
    'autres',
];

const BURGER_FAMILY_LABELS: Record<BurgerFamilyKey, string> = {
    cheese: 'Cheese',
    crown: 'Crown',
    agnel: 'Agnel',
    buck: 'Buck',
    kina: 'Kina',
    racls: "Racl'S",
    stacks: "Stack'S",
    classiques: 'Classiques',
    autres: 'Autres',
};

const BURGER_FAMILY_INDEX = BURGER_FAMILY_ORDER.reduce((acc, key, index) => {
    acc[key] = index;
    return acc;
}, {} as Record<BurgerFamilyKey, number>);

const resolveBurgerFamily = (product: Product): BurgerFamilyKey => {
    const slug = (product.slug ?? '').toLowerCase();
    const normalizedName = product.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    if (slug.includes('cheese') || normalizedName.includes('cheese')) return 'cheese';
    if (slug.startsWith('crown_') || normalizedName.includes('crown')) return 'crown';
    if (slug.startsWith('agnel_') || normalizedName.includes('agnel')) return 'agnel';
    if (slug.startsWith('buck_') || normalizedName.includes('buck')) return 'buck';
    if (slug.startsWith('kina_') || normalizedName.includes('kina')) return 'kina';
    if (slug.startsWith('racls_') || normalizedName.includes('racl')) return 'racls';
    if (slug.startsWith('stacks_') || normalizedName.includes('stack')) return 'stacks';
    if (product.category === 'burgers') return 'classiques';
    return 'autres';
};

const sortBurgersByFamily = (items: Product[]) =>
    [...items].sort((a, b) => {
        const familyA = resolveBurgerFamily(a);
        const familyB = resolveBurgerFamily(b);
        const familyDiff = (BURGER_FAMILY_INDEX[familyA] ?? 999) - (BURGER_FAMILY_INDEX[familyB] ?? 999);
        if (familyDiff !== 0) return familyDiff;
        return a.name.localeCompare(b.name, 'fr-FR', { sensitivity: 'base' });
    });

const getBurgerFamilyLabel = (product?: Product | null) => {
    if (!product || product.category !== 'burgers') return null;
    return BURGER_FAMILY_LABELS[resolveBurgerFamily(product)];
};

const isBurgerFamilyBreak = (items: Product[], index: number) => {
    if (index < 0 || index >= items.length) return false;
    const currentFamily = getBurgerFamilyLabel(items[index]);
    if (!currentFamily) return false;
    if (index === 0) return true;
    const previousFamily = getBurgerFamilyLabel(items[index - 1]);
    return previousFamily !== currentFamily;
};

const SNACK_SAUCE_RULES_BY_SLUG: Record<string, 1 | 2> = {
    nugget_s_x6: 1,
    crusty_s_smocky_x3: 1,
    crusty_s_red_smocky_x3: 1,
    sakitori_x3: 1,
    nugget_s_x12: 2,
    crusty_s_smocky_x6: 2,
    crusty_s_red_smocky_x6: 2,
    sakitori_x6: 2,
};

const SNACK_SAUCE_FALLBACK_OPTIONS = ['Ketchup', 'Mayo', 'Sauce BBQ', 'Sauce Chinoise', 'Sauce Curry Mango'];
const PAYMENT_METHOD_OPTIONS = ['Espèces', 'Carte', 'Ticket Restaurant', 'Chèque Vacances', 'Titre Restaurant CB'];
const PAYMENT_METHOD_MIX_PRESETS = [
    'Espèces / Carte',
    'Carte / Titre Restaurant CB',
    'Carte / Ticket Restaurant',
];

// Produits inclus dans le menu "Edition Limitee" (fallback local).
const MENU_EDITION_LIMITEE_SLUGS = new Set([
    'crown_original',
    'crown_spicy',
    'le_plena',
    'croq_s',
    'racls_beef',
    'racls_chicken',
    'stacks_beef',
    'stacks_chicken',
    'chicken_fil_s_thai',
    'chicken_fil_s_bbq',
    'sakitori_x3',
    'sakitori_x6',
]);

const CROWN_MENU_SLUGS = new Set(['crown_original', 'crown_spicy']);

const isEditionLimiteeProduct = (product: Product) => {
    if (product.category !== 'burgers' && product.category !== 'snacks') return false;
    const normalizedName = product.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    const normalizedSlug = (product.slug ?? '').toLowerCase();
    return MENU_EDITION_LIMITEE_SLUGS.has(normalizedSlug)
        || normalizedName.includes('edition limitee')
        || normalizedName.includes('limited edition')
        || normalizedSlug.includes('edition_limitee')
        || normalizedSlug.includes('limited_edition')
        || normalizedSlug.includes('edition-limitee')
        || normalizedSlug.includes('limited-edition');
};

const isCrownMenuMain = (product?: Product | null) => {
    const slug = (product?.slug ?? '').toLowerCase();
    return CROWN_MENU_SLUGS.has(slug);
};

const WOW_SAUCE_OPTION_PRODUCT: Product = {
    id: 'wow_sauce_option',
    slug: 'sauce_wow',
    name: 'Sauce WOW (+1€)',
    price: 0,
    category: 'sauces',
    sendToKitchen: false,
    sendToSalle: true,
    active: true,
    imageKey: '',
};

const isWowSauceOption = (product?: Product | null) => {
    const slug = (product?.slug ?? '').toLowerCase();
    return slug === 'sauce_wow';
};

const resolveSnackSauceRequiredCount = (product: Product): 1 | 2 | null => {
    const slug = (product.slug ?? '').toLowerCase();
    if (SNACK_SAUCE_RULES_BY_SLUG[slug]) {
        return SNACK_SAUCE_RULES_BY_SLUG[slug];
    }

    const normalizedName = product.name.toLowerCase();
    if (normalizedName.includes('nugget') && normalizedName.includes('x12')) return 2;
    if (normalizedName.includes('nugget') && normalizedName.includes('x6')) return 1;
    if (normalizedName.includes('sakitori') && normalizedName.includes('x6')) return 2;
    if (normalizedName.includes('sakitori') && normalizedName.includes('x3')) return 1;
    if (normalizedName.includes('crusty') && normalizedName.includes('x6')) return 2;
    if (normalizedName.includes('crusty') && normalizedName.includes('x3')) return 1;
    return null;
};

const CATEGORIES: ProductCategory[] = ['burgers', 'snacks', 'salades', 'accompagnements', 'desserts', 'boissons', 'sauces'];

const CATEGORY_LABELS: Record<ProductCategory, string> = {
    burgers: 'Burgers',
    snacks: 'Tex Mex',
    salades: 'Salades',
    accompagnements: 'Accompagnements',
    desserts: 'Desserts',
    boissons: 'Boissons',
    sauces: 'Sauces',
};

type SidebarSection = 'vente' | 'stock' | 'tickets' | 'fermeture' | 'parametres';
type SaleTunnelStep = 'menu' | 'burger' | 'snack' | 'salade' | 'accompagnement' | 'dessert' | 'boisson' | 'sauce';
type MenuFlowType = 'menu_burgers' | 'menu_tex_mex' | 'menu_salade' | 'menu_edition_limitee' | 'menu_kids';
type MenuStage = 'main' | 'side' | 'drink' | 'sauce' | 'dessert' | 'toy';
type ProductPickTarget = 'cart' | 'menu_main';
type ToastType = 'success' | 'error';
type TicketPreviewMode = 'caisse' | 'cuisine';
type TicketCustomizationPreviewChannel = 'cash' | 'kitchen' | 'service';
type TicketCorrectionMode = 'cancel';
type StockFilter = ProductCategory | 'all' | 'edition_limitee';
type CashDrawerTestStatus = {
    testedAt: string;
    commandOk: boolean;
    operatorConfirmedOpen: boolean | null;
    message: string;
};

const SALE_TUNNEL_STEPS: Record<SaleTunnelStep, { label: string; icon: string; categories: ProductCategory[] }> = {
    menu: { label: 'Menu', icon: '', categories: ['burgers', 'snacks', 'salades'] },
    burger: { label: '', icon: '🍔', categories: ['burgers'] },
    snack: { label: '', icon: '🌮', categories: ['snacks'] },
    salade: { label: '', icon: '🥗', categories: ['salades'] },
    accompagnement: { label: '', icon: '🍟', categories: ['accompagnements'] },
    dessert: { label: '', icon: '🍩', categories: ['desserts'] },
    boisson: { label: '', icon: '🥤', categories: ['boissons'] },
    sauce: { label: '', icon: '🍅', categories: ['sauces'] },
};

const MENU_FLOW_LABELS: Record<MenuFlowType, string> = {
    menu_burgers: "Menu Burger'S",
    menu_tex_mex: 'Menu Tex Mex',
    menu_salade: 'Menu Salade',
    menu_edition_limitee: 'Menu Edition Limitee',
    menu_kids: "Menu Kid'S",
};

const MENU_FLOW_BUTTON_LABELS: Record<MenuFlowType, string> = {
    ...MENU_FLOW_LABELS,
    menu_edition_limitee: 'Edition Limitee',
};

const MENU_CLASSIQUE_STAGES: MenuStage[] = ['main', 'side', 'drink'];
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
    cone_glace: require('./assets/products/cône_glacé.avif'),
    compote: require('./assets/products/compote.png'),
    cookie: require('./assets/products/cookie.avif'),
    cordoba: require('./assets/products/cordoba.avif'),
    crown_original: require('./assets/products/crown_original.png'),
    crusty_pankas: require('./assets/products/crusty_pankas.png'),
    delice_glace: require('./assets/products/délice_glacés.avif'),
    donuts: require('./assets/products/donuts.avif'),
    double_cookies_glace: require('./assets/products/double_cookies_glacé.avif'),
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
    le_mont_blanc_chocolat: require('./assets/products/le_mont_blanc_chocolat.png'),
    le_mont_blanc_vanille: require('./assets/products/le_mont_blanc_vanille.png'),
    le_plena: require('./assets/products/le_plena.png'),
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
    racls_beef: require('./assets/products/racls_beef.png'),
    racls_chicken: require('./assets/products/racls_chicken.png'),
    sakitori_spicy: require('./assets/products/sakitori_spicy.png'),
    stacks_beef: require('./assets/products/stacks_beef.png'),
    stacks_chicken: require('./assets/products/stacks_chicken.png'),
    sundae: require('./assets/products/sundae.avif'),
    volvic: require('./assets/products/volvic.png'),
    volvic_fraise: require('./assets/products/volvic_fraise.png'),
    lécu_dor: require('./assets/products/lécu_dor.avif'),
};

console.log('[APP] PRODUCT_IMAGES loaded OK, keys:', Object.keys(PRODUCT_IMAGES).length);

const EMPTY_SETTINGS: PrinterSettings = {
    printMode: 'network_dual',
    cashPrinterUrl: '',
    kitchenPrinterUrl: '',
    usbPrinterId: '',
    usbPrinterName: '',
    cashDrawerEnabled: true,
    serviceTicketEnabled: true,
    nightSurchargePercent: 0,
    ticketCustomization: { ...DEFAULT_TICKET_CUSTOMIZATION },
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

const DIVIDER_WIDTH = 8;
const MIN_PANEL_RATIO = 0.20;
const MAX_PANEL_RATIO = 0.55;
const DEFAULT_PANEL_RATIO = 0.55;

const PosScreen = ({ session, onLogout }: PosScreenProps) => {
    const { width: screenWidth } = useWindowDimensions();
    const [panelRatio, setPanelRatio] = useState(DEFAULT_PANEL_RATIO);
    const panelRatioRef = useRef(DEFAULT_PANEL_RATIO);
    const layoutRef = useRef<View>(null);
    const layoutXRef = useRef(0);
    const sidebarWidthRef = useRef(210);

    const dividerPanResponder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
            // measure layout position once on drag start
            layoutRef.current?.measureInWindow((x) => { layoutXRef.current = x; });
        },
        onPanResponderMove: (_evt, gestureState) => {
            const sidebarW = isSidebarVisibleRef.current ? sidebarWidthRef.current : 0;
            const layoutPadding = 10;
            const gaps = isSidebarVisibleRef.current ? 10 * 2 : 10; // gap between sidebar-rightPanel, rightPanel-salesArea
            const availableW = screenWidth - sidebarW - layoutPadding * 2 - gaps - DIVIDER_WIDTH;
            const touchX = gestureState.moveX - layoutXRef.current - layoutPadding - sidebarW - 10;
            const ratio = Math.min(MAX_PANEL_RATIO, Math.max(MIN_PANEL_RATIO, touchX / availableW));
            panelRatioRef.current = ratio;
            setPanelRatio(ratio);
        },
    }), [screenWidth]);

    const [ready, setReady] = useState(false);
    const [initError, setInitError] = useState('');
    const [activeSection, setActiveSection] = useState<SidebarSection>('vente');
    const [saleStep, setSaleStep] = useState<SaleTunnelStep>('menu');
    const [menuFlowType, setMenuFlowType] = useState<MenuFlowType>('menu_burgers');
    const [editionLimiteeSelectionMode, setEditionLimiteeSelectionMode] = useState<'menu' | 'simple'>('menu');
    const [editionLimiteeModeModalVisible, setEditionLimiteeModeModalVisible] = useState(false);
    const [menuStage, setMenuStage] = useState<MenuStage>('main');
    const [selectedMenuMainId, setSelectedMenuMainId] = useState<string | null>(null);
    const [selectedMenuSideId, setSelectedMenuSideId] = useState<string | null>(null);
    const [selectedMenuDrinkId, setSelectedMenuDrinkId] = useState<string | null>(null);
    const [selectedMenuSauceId, setSelectedMenuSauceId] = useState<string | null>(null);
    const [isWowSauceSelected, setIsWowSauceSelected] = useState(false);
    const [selectedMenuDessertId, setSelectedMenuDessertId] = useState<string | null>(null);
    const [selectedMenuToyId, setSelectedMenuToyId] = useState<string | null>(null);
    const [menuMainCustomization, setMenuMainCustomization] = useState<{ productId: string; displayName: string } | null>(null);
    const [editingMenuLineId, setEditingMenuLineId] = useState<string | null>(null);
    const [products, setProducts] = useState<Product[]>([]);
    const [allProducts, setAllProducts] = useState<Product[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [cartListWidth, setCartListWidth] = useState(0);
    // Inner content width = ScrollView layout width minus its padding (6 each side)
    const cartContentWidth = cartListWidth - 12;
    const CART_COL_MIN_WIDTH = 200; // min width per column for comfortable reading
    const cartColumns = cartContentWidth >= CART_COL_MIN_WIDTH * 2 + 6 ? 2 : 1;
    const cartItemWidth = cartColumns === 2 ? Math.floor((cartContentWidth - 6) / 2) : undefined;
    const [tableLabel, setTableLabel] = useState('');
    const [orderType, setOrderType] = useState<OrderType>('sur_place');
    const [noteTargetLineId, setNoteTargetLineId] = useState<string | null>(null);
    const [noteModalVisible, setNoteModalVisible] = useState(false);
    const [noteModalText, setNoteModalText] = useState('');
    const [otherPayModalVisible, setOtherPayModalVisible] = useState(false);
    const [settings, setSettings] = useState<PrinterSettings>(EMPTY_SETTINGS);
    const [stats, setStats] = useState<DailyStats>({ ordersCount: 0, revenue: 0 });
    const [weeklyStats, setWeeklyStats] = useState<DailyStats>({ ordersCount: 0, revenue: 0 });
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState<ToastType>('success');
    const [tickets, setTickets] = useState<StoredTicket[]>([]);
    const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
    const [ticketPreviewMode, setTicketPreviewMode] = useState<TicketPreviewMode>('caisse');
    const [fullscreenTicketText, setFullscreenTicketText] = useState<string | null>(null);
    const [isSidebarVisible, setIsSidebarVisible] = useState(false);
    const isSidebarVisibleRef = useRef(false);
    // sync ref
    isSidebarVisibleRef.current = isSidebarVisible;
    const [isSendingKitchen, setIsSendingKitchen] = useState(false);
    const [payingMethod, setPayingMethod] = useState<string | null>(null);
    const [isReprintingCopy, setIsReprintingCopy] = useState(false);
    const [correctionModalVisible, setCorrectionModalVisible] = useState(false);
    const [correctionMode, setCorrectionMode] = useState<TicketCorrectionMode>('cancel');
    const [correctionReason, setCorrectionReason] = useState('');
    const [isSavingCorrection, setIsSavingCorrection] = useState(false);
    const [paymentCorrectionModalVisible, setPaymentCorrectionModalVisible] = useState(false);
    const [paymentCorrectionMethod, setPaymentCorrectionMethod] = useState('');
    const [paymentCorrectionReason, setPaymentCorrectionReason] = useState('');
    const [isSavingPaymentCorrection, setIsSavingPaymentCorrection] = useState(false);
    const [xSnapshot, setXSnapshot] = useState<ClosureSnapshot | null>(null);
    const [zClosures, setZClosures] = useState<ClosureRecord[]>([]);
    const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
    const [isRunningAudit, setIsRunningAudit] = useState(false);
    const [isLoadingClosures, setIsLoadingClosures] = useState(false);
    const [isLoadingXReport, setIsLoadingXReport] = useState(false);
    const [isClosingZReport, setIsClosingZReport] = useState(false);
    const [isPrintingZTicketPreview, setIsPrintingZTicketPreview] = useState(false);
    const [isPrintingClosedFlashId, setIsPrintingClosedFlashId] = useState<number | null>(null);
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
    const [isTestingCashPrinter, setIsTestingCashPrinter] = useState(false);
    const [isTestingCashDrawer, setIsTestingCashDrawer] = useState(false);
    const [cashDrawerTestStatus, setCashDrawerTestStatus] = useState<CashDrawerTestStatus | null>(null);
    const [isTestingKitchenPrinter, setIsTestingKitchenPrinter] = useState(false);
    const [isScanningPrinters, setIsScanningPrinters] = useState(false);
    const [discoveredPrinters, setDiscoveredPrinters] = useState<EpsonDiscoveryItem[]>([]);
    const [isScanningUsbPrinters, setIsScanningUsbPrinters] = useState(false);
    const [isAuthorizingUsbPrinter, setIsAuthorizingUsbPrinter] = useState(false);
    const [usbPrinters, setUsbPrinters] = useState<UsbPrinterDevice[]>([]);
    const [printQueueSummary, setPrintQueueSummary] = useState<{ pending: number; failed: number }>({ pending: 0, failed: 0 });
    const isProcessingPrintQueueRef = useRef(false);
    const isHandlingPayRef = useRef(false);
    const [productFormVisible, setProductFormVisible] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [formName, setFormName] = useState('');
    const [formPrice, setFormPrice] = useState('');
    const [formMenuPrice, setFormMenuPrice] = useState('');
    const [formMenuSupplement, setFormMenuSupplement] = useState('');
    const [formCategory, setFormCategory] = useState<ProductCategory>('burgers');
    const [formSendToKitchen, setFormSendToKitchen] = useState(true);
    const [formSendToSalle, setFormSendToSalle] = useState(true);
    const [formActive, setFormActive] = useState(true);
    const [formImageKey, setFormImageKey] = useState('');
    const [formImageUri, setFormImageUri] = useState('');
    const [isSavingProduct, setIsSavingProduct] = useState(false);
    const [stockFilter, setStockFilter] = useState<StockFilter>('all');
    const [stockSearch, setStockSearch] = useState('');
    const [showTaxDetails, setShowTaxDetails] = useState(false);
    const [discountPercent, setDiscountPercent] = useState(0);
    const [discountModalVisible, setDiscountModalVisible] = useState(false);
    const [discountInput, setDiscountInput] = useState('');
    const [standbyOrders, setStandbyOrders] = useState<{
        id: string;
        cart: CartItem[];
        tableLabel: string;
        orderType: OrderType;
        savedAt: string;
        kitchenSent: boolean;
        serviceSent?: boolean;
        ticketNumber?: number;
    }[]>([]);
    const [kitchenSentForCurrentCart, setKitchenSentForCurrentCart] = useState(false);
    const [serviceSentForCurrentCart, setServiceSentForCurrentCart] = useState(false);
    const [currentOrderTicketNumber, setCurrentOrderTicketNumber] = useState<number | null>(null);
    const currentOrderTicketNumberRef = useRef<number | null>(null);
    const [standbyModalVisible, setStandbyModalVisible] = useState(false);
    const [payChoiceOpen, setPayChoiceOpen] = useState(false);
    const [splitPayModalVisible, setSplitPayModalVisible] = useState(false);
    const [splitParts, setSplitParts] = useState<{ method: string; amount: string }[]>([
        { method: 'Espèces', amount: '' },
        { method: 'Carte', amount: '' },
    ]);

    // ── Confirmation avant paiement ──
    const [confirmPayVisible, setConfirmPayVisible] = useState(false);
    const [pendingPaymentMethod, setPendingPaymentMethod] = useState('');

    // ── Rendu de monnaie (espèces) ──
    const [cashChangeVisible, setCashChangeVisible] = useState(false);
    const [cashGivenInput, setCashGivenInput] = useState('');

    // ── Paiement par titre restaurant ──
    const [voucherModalVisible, setVoucherModalVisible] = useState(false);
    const [voucherAmountInput, setVoucherAmountInput] = useState('');
    const [voucherComplement, setVoucherComplement] = useState<string | null>(null);

    // ── Sélection marinade Satay ──
    const [marinadeModalVisible, setMarinadeModalVisible] = useState(false);
    const [marinadeProduct, setMarinadeProduct] = useState<Product | null>(null);
    const [marinadeSelectionTarget, setMarinadeSelectionTarget] = useState<ProductPickTarget>('cart');

    // ── Sélection sauces snacks (nuggets / crusty / sakitori) ──
    const [snackSauceModalVisible, setSnackSauceModalVisible] = useState(false);
    const [snackSauceProduct, setSnackSauceProduct] = useState<Product | null>(null);
    const [snackSauceRequiredCount, setSnackSauceRequiredCount] = useState<1 | 2>(1);
    const [snackSauceSelections, setSnackSauceSelections] = useState<string[]>([]);
    const [snackSauceSelectionTarget, setSnackSauceSelectionTarget] = useState<ProductPickTarget>('cart');

    // ── Composition Sundae ──
    const [sundaeModalVisible, setSundaeModalVisible] = useState(false);
    const [sundaeProduct, setSundaeProduct] = useState<Product | null>(null);
    const [sundaeNappageSelection, setSundaeNappageSelection] = useState<string | null>(null);
    const [sundaeCroquantSelections, setSundaeCroquantSelections] = useState<string[]>([]);

    // ── Composition salade ──
    const [saladModalVisible, setSaladModalVisible] = useState(false);
    const [saladProduct, setSaladProduct] = useState<Product | null>(null);
    const [saladProteinSelection, setSaladProteinSelection] = useState<string | null>(null);
    const [saladSauceSelection, setSaladSauceSelection] = useState<string | null>(null);
    const [saladSelectionTarget, setSaladSelectionTarget] = useState<ProductPickTarget>('cart');

    // ── Ouverture de caisse ──
    const [caisseOpenState, setCaisseOpenStateLocal] = useState<CaisseOpenState>({ isOpen: false, openedAt: null, openedBy: null });
    const [ouvertureModalVisible, setOuvertureModalVisible] = useState(false);
    const [isOpeningCaisse, setIsOpeningCaisse] = useState(false);

    // ── Majoration nuit ──
    const [nightSurchargeActive, setNightSurchargeActive] = useState(false);
    const [nightSurchargeModalVisible, setNightSurchargeModalVisible] = useState(false);
    const nightSurchargePopupShownRef = useRef(false);

    // ── Fermeture de caisse ──
    const [closurePeriodTickets, setClosurePeriodTickets] = useState<StoredTicket[]>([]);
    const [isLoadingPeriodTickets, setIsLoadingPeriodTickets] = useState(false);
    const [closurePreviewText, setClosurePreviewText] = useState('');

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
        if (isLoadingClosures) {
            return;
        }

        setIsLoadingClosures(true);
        try {
            const closures = await getRecentClosures(10);
            setZClosures(closures);
        } catch {
            showToast('Erreur chargement historique.', 'error');
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
        if (normalized === 'ticket restaurant') {
            return 'Ticket Rest.';
        }
        if (normalized === 'chèque vacances' || normalized === 'cheque vacances') {
            return 'Chèque Vacances';
        }
        if (normalized === 'titre restaurant cb' || normalized === 'cb restaurant' || normalized === 'cb borne') {
            return 'CB Restaurant';
        }

        return value || 'Non précisé';
    };

    const isCashPaymentMethod = (value: string) =>
        value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .includes('especes');

    const normalizePaymentMethodForCompare = (value: string) =>
        value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();

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

    const ensureCaisseOpen = (context: 'commande' | 'encaissement' = 'commande') => {
        if (caisseOpenState.isOpen) return true;
        setOuvertureModalVisible(true);
        showToast(
            context === 'encaissement'
                ? 'Ouverture caisse obligatoire avant encaissement.'
                : 'Ouverture caisse obligatoire avant prise de commande.',
            'error',
        );
        return false;
    };

    const resolveRuntimePrinterSettings = useCallback((base: PrinterSettings): PrinterSettings => {
        if (base.printMode !== 'usb_single') {
            return {
                ...base,
                cashPrinterUrl: base.cashPrinterUrl.trim(),
                kitchenPrinterUrl: base.kitchenPrinterUrl.trim(),
                usbPrinterId: base.usbPrinterId.trim(),
                usbPrinterName: base.usbPrinterName.trim(),
                ticketCustomization: normalizeTicketCustomization(base.ticketCustomization),
            };
        }

        const usbUrl = buildUsbPrinterUrl(base.usbPrinterId);
        return {
            ...base,
            cashPrinterUrl: usbUrl,
            kitchenPrinterUrl: usbUrl,
            usbPrinterId: base.usbPrinterId.trim(),
            usbPrinterName: base.usbPrinterName.trim(),
            ticketCustomization: normalizeTicketCustomization(base.ticketCustomization),
        };
    }, []);

    const updateTicketCustomization = useCallback((patch: Partial<TicketCustomization>) => {
        setSettings((prev) => ({
            ...prev,
            ticketCustomization: normalizeTicketCustomization({
                ...prev.ticketCustomization,
                ...patch,
            }),
        }));
    }, []);

    const toggleTicketCustomizationFlag = useCallback((
        field: 'showLogo' | 'headerBold' | 'footerBold' | 'showSeller' | 'showTable' | 'showPaymentLine' | 'showTaxTable' | 'compactMode',
    ) => {
        updateTicketCustomization({ [field]: !settings.ticketCustomization[field] });
    }, [settings.ticketCustomization, updateTicketCustomization]);

    const openTicketCustomizationPreview = useCallback((channel: TicketCustomizationPreviewChannel) => {
        const runtimeSettings = resolveRuntimePrinterSettings(settings);
        const previewSettings: PrinterSettings = {
            ...runtimeSettings,
            cashPrinterUrl: runtimeSettings.cashPrinterUrl || 'preview://cash',
            kitchenPrinterUrl: runtimeSettings.kitchenPrinterUrl || 'preview://kitchen',
        };
        const demoPayload = {
            cartItems: [
                {
                    lineId: 'preview-1',
                    product: {
                        id: 'preview-burger',
                        name: 'Double Cheese',
                        price: 8.5,
                        category: 'burgers' as const,
                        sendToKitchen: true,
                        sendToSalle: true,
                        active: true,
                    },
                    quantity: 2,
                    note: 'Sans oignons',
                },
                {
                    lineId: 'preview-drink',
                    product: {
                        id: 'preview-drink',
                        name: 'Pepsi',
                        price: 2.5,
                        category: 'boissons' as const,
                        sendToKitchen: false,
                        sendToSalle: true,
                        active: true,
                    },
                    quantity: 1,
                },
            ],
            tableLabel: 'A3',
            note: 'Client presse',
            total: 19.5,
            paymentMethod: 'Carte',
            seller: session.username,
            taxLines: [
                { code: 'B', rate: 0.1, base: 17.73, tax: 1.77, total: 19.5 },
            ],
            totalHt: 17.73,
            orderType: orderType,
            ticketNumber: 999999,
            discountAmount: 0,
        };

        if (channel === 'cash') {
            const doc = buildCashTicketDocument(demoPayload, previewSettings);
            setFullscreenTicketText(doc.ticketText);
            return;
        }

        if (channel === 'service') {
            const doc = buildServiceTicketDocument(demoPayload, previewSettings);
            setFullscreenTicketText(doc?.ticketText ?? 'Aucun article salle à imprimer.');
            return;
        }

        const docs = buildKitchenTicketDocuments(previewSettings, demoPayload);
        setFullscreenTicketText(docs.length ? docs.map((doc) => doc.ticketText).join('\n\n') : 'Aucun article cuisine à imprimer.');
    }, [orderType, resolveRuntimePrinterSettings, session.username, settings]);

    const refreshPrintQueueState = useCallback(async () => {
        try {
            const summary = await getPrintQueueSummary();
            setPrintQueueSummary(summary);
        } catch {
            // non-blocking
        }
    }, []);

    const processPrintQueue = useCallback(async (options?: { silent?: boolean; limit?: number }) => {
        if (isProcessingPrintQueueRef.current) {
            return;
        }
        isProcessingPrintQueueRef.current = true;
        try {
            const jobs = await getPendingPrintJobs(options?.limit ?? 25);
            for (const job of jobs) {
                try {
                    await markPrintJobProcessing(job.id);
                    const result = await sendPreparedPrintJob(job.printerUrl, job.requestXml, job.ticketText, {
                        idempotencyKey: job.idempotencyKey,
                        maxRetries: 0,
                    });
                    await markPrintJobResult(job.id, result);
                } catch {
                    await markPrintJobResult(job.id, { ok: false, message: 'Erreur lors du traitement du job.' });
                }
            }
        } finally {
            isProcessingPrintQueueRef.current = false;
            await refreshPrintQueueState();
            if (!options?.silent) {
                const summary = await getPrintQueueSummary();
                if (summary.failed > 0) {
                    showToast(`${summary.failed} impression(s) en échec.`, 'error');
                }
            }
        }
    }, [refreshPrintQueueState]);

    const [changePinUser, setChangePinUser] = useState('');
    const [changePinValue, setChangePinValue] = useState('');
    const [changePinConfirm, setChangePinConfirm] = useState('');
    const isAdminRole = session.role === 'admin';
    const canAccessClosure = isAdminRole || session.role === 'staff';
    const isAdminAccount = session.username === 'admin';
    const displayNameForUser = (username: string) => {
        if (username === 'admin') return 'Admin';
        if (username === 'manager') return 'Manager';
        if (username === 'vendeur') return 'Vendeur';
        return username;
    };

    useEffect(() => {
        const bootstrap = async () => {
            try {
                console.log('[BOOT] 1/5 initDatabase…');
                await initDatabase();
                console.log('[BOOT] 2/5 loading settings & stats…');
                const [loadedSettings, todayStats, currentWeekStats] = await Promise.all([
                    getPrinterSettings(),
                    getTodayStats(),
                    getWeeklyStats(),
                ]);
                console.log('[BOOT] 3/5 loading products…');
                await loadProductsData();
                console.log('[BOOT] 4/5 loading user pins…');
                const savedPins = await loadUserPins();
                if (Object.keys(savedPins).length) {
                    applyUserPins(savedPins);
                }
                setSettings({
                    ...loadedSettings,
                    ticketCustomization: normalizeTicketCustomization(loadedSettings.ticketCustomization),
                });
                setStats(todayStats);
                setWeeklyStats(currentWeekStats);
                await refreshPrintQueueState();
                if (session.role === 'admin') {
                    console.log('[BOOT] 4b/5 loading tickets (admin)…');
                    await loadRecentTickets();
                }
                // Check caisse open state
                const openState = await getCaisseOpenState();
                setCaisseOpenStateLocal(openState);
                console.log('[BOOT] 5/5 bootstrap complete ✓');
                setInitError('');
            } catch (err) {
                console.error('[BOOT] ✗ bootstrap error:', err);
                setInitError('Erreur au démarrage. Vérifie la base locale puis redémarre l\'application.');
            } finally {
                setReady(true);
            }
        };

        bootstrap();
    }, []);

    useEffect(() => {
        if (!ready || initError) return;
        const timer = setInterval(() => {
            void processPrintQueue({ silent: true, limit: 10 });
        }, 15_000);
        return () => clearInterval(timer);
    }, [ready, initError, processPrintQueue]);

    useEffect(() => {
        if (!ready || initError) return;
        void processPrintQueue({ silent: true, limit: 10 });
    }, [ready, initError, processPrintQueue]);

    // Show opening modal after boot if caisse is not open
    useEffect(() => {
        if (ready && !initError && !caisseOpenState.isOpen) {
            setOuvertureModalVisible(true);
        }
    }, [ready, initError, caisseOpenState.isOpen]);

    // ── Majoration nuit : vérification automatique après minuit ──
    useEffect(() => {
        if (!ready || !caisseOpenState.isOpen) return;
        const configuredPercent = settings.nightSurchargePercent;
        if (!configuredPercent || configuredPercent <= 0) return;

        const checkMidnight = () => {
            const now = new Date();
            const h = now.getHours();
            // Entre minuit (00:00) et 05:59 → zone nuit
            if (h >= 0 && h < 6 && !nightSurchargeActive && !nightSurchargePopupShownRef.current) {
                nightSurchargePopupShownRef.current = true;
                setNightSurchargeModalVisible(true);
            }
        };

        checkMidnight();
        const timer = setInterval(checkMidnight, 30_000); // vérifier toutes les 30s
        return () => clearInterval(timer);
    }, [ready, caisseOpenState.isOpen, settings.nightSurchargePercent, nightSurchargeActive]);

    // Réinitialiser le flag popup quand la majoration est désactivée manuellement
    useEffect(() => {
        if (!nightSurchargeActive) {
            const now = new Date();
            const h = now.getHours();
            // Si on est en journée (6h+), reset le flag popup pour la prochaine nuit
            if (h >= 6) {
                nightSurchargePopupShownRef.current = false;
            }
        }
    }, [nightSurchargeActive]);

    useEffect(() => {
        if (activeSection === 'tickets') {
            loadRecentTickets();
        }
    }, [activeSection, session.role]);

    useEffect(() => {
        if (activeSection === 'parametres' && session.role === 'admin') {
            loadRecentClosures();
        }
    }, [activeSection, session.role]);

    useEffect(() => {
        if (activeSection === 'fermeture' && canAccessClosure) {
            loadRecentClosures();
        }
    }, [activeSection, canAccessClosure, session.role]);

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

    const filteredProducts = useMemo(() => {
        const inStep = products.filter((product) => SALE_TUNNEL_STEPS[saleStep].categories.includes(product.category));
        // Les produits "édition limitée" ne doivent pas apparaître en vente solo Burger/Tex Mex.
        if (saleStep === 'burger' || saleStep === 'snack') {
            const withoutEdition = inStep.filter((product) => !isEditionLimiteeProduct(product));
            if (saleStep === 'burger') {
                return sortBurgersByFamily(withoutEdition);
            }
            return withoutEdition;
        }
        if (saleStep === 'salade') {
            return [...inStep].sort((a, b) => a.name.localeCompare(b.name, 'fr-FR', { sensitivity: 'base' }));
        }
        return inStep;
    }, [products, saleStep]);

    const menuMainProducts = useMemo(() => {
        if (menuFlowType === 'menu_burgers') {
            // Menu Burger'S: burgers "standards" uniquement (hors édition limitée)
            const burgerProducts = products.filter(
                (p) =>
                    p.category === 'burgers' &&
                    !isEditionLimiteeProduct(p) &&
                    (p.menuPrice !== undefined || (p.slug && MENU_PRICES_BY_SLUG[p.slug] !== undefined)),
            );
            return sortBurgersByFamily(burgerProducts);
        }
        if (menuFlowType === 'menu_tex_mex') {
            // Menu Tex Mex: snacks "standards" uniquement (hors édition limitée)
            return products.filter(
                (p) =>
                    p.category === 'snacks' &&
                    !isEditionLimiteeProduct(p) &&
                    (p.menuPrice !== undefined || (p.slug && MENU_PRICES_BY_SLUG[p.slug] !== undefined)),
            );
        }
        if (menuFlowType === 'menu_salade') {
            return products.filter(
                (p) =>
                    p.category === 'salades'
                    && (p.menuPrice !== undefined || (p.slug && MENU_PRICES_BY_SLUG[p.slug] !== undefined)),
            );
        }
        if (menuFlowType === 'menu_edition_limitee') {
            const limitedProducts = products.filter((p) => {
                if (!isEditionLimiteeProduct(p)) return false;
                return p.menuPrice !== undefined || (p.slug && MENU_PRICES_BY_SLUG[p.slug] !== undefined);
            });
            return limitedProducts;
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
    const snackSauceOptions = useMemo(() => {
        const names = menuSauceProducts
            .map((p) => p.name.trim())
            .filter(Boolean);
        const uniqueNames = Array.from(new Set(names));
        if (!uniqueNames.length) {
            return SNACK_SAUCE_FALLBACK_OPTIONS;
        }

        const score = (name: string) => {
            const normalized = name.toLowerCase();
            if (normalized.includes('ketchup')) return 0;
            if (normalized.includes('mayo')) return 1;
            if (normalized.includes('bbq')) return 2;
            if (normalized.includes('chinoise')) return 3;
            if (normalized.includes('curry mango')) return 4;
            return 10;
        };

        return uniqueNames.sort((a, b) => {
            const diff = score(a) - score(b);
            if (diff !== 0) return diff;
            return a.localeCompare(b, 'fr-FR', { sensitivity: 'base' });
        });
    }, [menuSauceProducts]);

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
            { id: 'toy_garcon', slug: 'toy_garcon', name: 'Jouet Garçon', price: 0, menuSupplement: undefined as number | undefined, category: 'desserts' as ProductCategory, sendToKitchen: false, sendToSalle: true, active: true, imageKey: '' },
            { id: 'toy_fille', slug: 'toy_fille', name: 'Jouet Fille', price: 0, menuSupplement: undefined as number | undefined, category: 'desserts' as ProductCategory, sendToKitchen: false, sendToSalle: true, active: true, imageKey: '' },
        ],
        [],
    );

    const currentMenuStages = menuFlowType === 'menu_kids' ? MENU_KIDS_STAGES : MENU_CLASSIQUE_STAGES;
    const isClassicMenuFlow =
        menuFlowType === 'menu_burgers'
        || menuFlowType === 'menu_tex_mex'
        || menuFlowType === 'menu_salade'
        || menuFlowType === 'menu_edition_limitee';

    const menuDisplayedProducts = useMemo(() => {
        if (menuStage === 'main') return menuMainProducts;
        if (menuStage === 'side') return menuSideProducts;
        if (menuStage === 'drink') return menuDrinkProducts;
        if (menuStage === 'sauce') return menuSauceProducts;
        if (menuStage === 'dessert') return menuDessertProducts;
        if (menuStage === 'toy') return menuToyProducts;
        return menuMainProducts;
    }, [menuStage, menuMainProducts, menuSideProducts, menuDrinkProducts, menuSauceProducts, menuDessertProducts, menuToyProducts]);
    const editionLimiteeSimpleProducts = useMemo(
        () => products.filter((p) => isEditionLimiteeProduct(p)),
        [products],
    );
    const isEditionLimiteeSimpleMode = menuFlowType === 'menu_edition_limitee' && editionLimiteeSelectionMode === 'simple';

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
    const productGridColumns = useMemo(() => {
        if (screenWidth >= 1700) return 4;
        if (screenWidth >= 1200) return 3;
        return 2;
    }, [screenWidth]);
    const productCardWidth = useMemo(() => {
        if (productGridColumns === 4) return '23%';
        if (productGridColumns === 3) return '31.5%';
        return '48%';
    }, [productGridColumns]);
    const menuGridProducts = useMemo(
        () => (isEditionLimiteeSimpleMode ? editionLimiteeSimpleProducts : menuDisplayedProducts),
        [isEditionLimiteeSimpleMode, editionLimiteeSimpleProducts, menuDisplayedProducts],
    );
    const shouldShowMenuBurgerFamilySeparators =
        !isEditionLimiteeSimpleMode && menuFlowType === 'menu_burgers' && menuStage === 'main';
    const shouldShowSoloBurgerFamilySeparators = saleStep === 'burger';

    const canOpenStage = (stage: MenuStage): boolean => {
        // When editing an existing menu, all stages are freely navigable
        if (editingMenuLineId) return true;
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

    // menuStageHint supprimé pour alléger l'UX — les boutons d'étape suffisent

    const getTaxRateForCategory = (category: ProductCategory) => {
        const map = orderType === 'a_emporter' ? TAX_RATE_A_EMPORTER : TAX_RATE_SUR_PLACE;
        return map[category] ?? 0.1;
    };

    const buildLineId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const hasCartItems = cart.length > 0;
    const kitchenAndServiceSentForCurrentCart =
        kitchenSentForCurrentCart && (!settings.serviceTicketEnabled || serviceSentForCurrentCart);

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
    const hasPaymentCorrectionSelectedTicket = useMemo(() => {
        if (!selectedTicket) return false;
        return tickets.some(
            (ticket) =>
                ticket.originalOrderId === selectedTicket.id
                && (ticket.note ?? '').toUpperCase().includes('RECTIF ENCAISSEMENT'),
        );
    }, [selectedTicket, tickets]);
    const canEditPaymentSelectedTicket = canCorrectSelectedTicket && !hasPaymentCorrectionSelectedTicket;

    // ── POS ticket helpers (32-char width) ──────────────────────────────────
    const POS_W = 32;
    const POS_SEP = '*'.repeat(POS_W);
    const posCenter = (s: string) => {
        if (s.length >= POS_W) return s;
        const left = Math.floor((POS_W - s.length) / 2);
        return ' '.repeat(left) + s;
    };
    const posLR = (left: string, right: string) => {
        const gap = POS_W - left.length - right.length;
        return gap > 0 ? left + ' '.repeat(gap) + right : left + ' ' + right;
    };
    const posFmtDate = (iso: string) => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return 'N/A';
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(-2);
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `le ${dd}/${mm}/${yy} a ${hh}:${min}`;
    };
    // helper: aggregate mixed payments "Espèces 10.00€ / Carte 5.00€"
    const aggregatePayments = (breakdown: Record<string, number>) => {
        const agg: Record<string, number> = {};
        for (const [rawKey, totalAmount] of Object.entries(breakdown)) {
            const parts = rawKey.split(' / ');
            if (parts.length > 1) {
                for (const part of parts) {
                    const match = part.match(/^(.+?)\s+([\d.,]+)\s*€?$/);
                    if (match) {
                        const m = match[1].trim();
                        const a = parseFloat(match[2].replace(',', '.')) || 0;
                        agg[m] = Number(((agg[m] ?? 0) + a).toFixed(2));
                    }
                }
            } else {
                const m = formatPaymentMethodLabel(rawKey);
                agg[m] = Number(((agg[m] ?? 0) + totalAmount).toFixed(2));
            }
        }
        return Object.entries(agg).sort(([, a], [, b]) => b - a);
    };
    const normalizePaymentForReport = (value: string) =>
        value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[’]/g, "'")
            .toLowerCase()
            .trim();
    const classifyPaymentForReport = (label: string): 'cb' | 'especes' | 'trCarte' | 'ticketRestau' | 'chequeVacances' | 'autres' => {
        const normalized = normalizePaymentForReport(label);
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
    const buildPaymentDetailTotals = (entries: [string, number][]) => {
        const totals = {
            cb: 0,
            especes: 0,
            trCarte: 0,
            ticketRestau: 0,
            chequeVacances: 0,
            autres: 0,
        };
        for (const [method, amount] of entries) {
            const key = classifyPaymentForReport(method);
            totals[key] = Number((totals[key] + amount).toFixed(2));
        }
        const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
        return {
            ...totals,
            total: Number(total.toFixed(2)),
        };
    };

    const zReportPreviewText = useMemo(() => {
        if (!xSnapshot) return null;
        const now = new Date();
        const nowIso = now.toISOString();
        const lines: string[] = [];

        // ── En-tête ──
        lines.push(posCenter('BURGER S DECINES'));
        lines.push(posCenter('19 AVENUE FRANKLIN ROOSEVELT'));
        lines.push(posCenter('69150 DECINES-CHARPIEU'));
        lines.push(POS_SEP);
        lines.push(posCenter('Flash journée'));
        lines.push(POS_SEP);

        // ── Métadonnées ──
        lines.push(`Imprime  : ${posFmtDate(nowIso)}`);
        lines.push(`Par      : ${session.username}`);
        lines.push(`Ouverture: ${posFmtDate(caisseOpenState.openedAt ?? xSnapshot.periodStart)}`);
        lines.push(`Cloture  : ${posFmtDate(xSnapshot.periodEnd)}`);
        lines.push(POS_SEP);

        // ── Informations générales ──
        lines.push('Informations generales :');
        lines.push(posLR('Tickets      :', String(xSnapshot.ordersCount)));
        lines.push(POS_SEP);

        // ── Detail règlements ──
        lines.push(posCenter('Detail reglements'));
        lines.push(POS_SEP);
        const aggEntries = aggregatePayments(xSnapshot.paymentBreakdown);
        const paymentTotals = buildPaymentDetailTotals(aggEntries);
        lines.push(posLR('CB :', `${paymentTotals.cb.toFixed(2)}€`));
        lines.push(posLR('Especes :', `${paymentTotals.especes.toFixed(2)}€`));
        lines.push(posLR('TR carte :', `${paymentTotals.trCarte.toFixed(2)}€`));
        lines.push(posLR('Ticket restau :', `${paymentTotals.ticketRestau.toFixed(2)}€`));
        lines.push(posLR('Cheque vacances :', `${paymentTotals.chequeVacances.toFixed(2)}€`));
        if (paymentTotals.autres > 0) {
            lines.push(posLR('Autres :', `${paymentTotals.autres.toFixed(2)}€`));
        }
        lines.push(posLR('TOTAL :', `${paymentTotals.total.toFixed(2)}€`));
        lines.push(POS_SEP);

        return lines.join('\n');
    }, [xSnapshot, session.username, caisseOpenState.openedAt]);

    const getTicketTypeLabel = (ticket: StoredTicket) => {
        if (ticket.orderStatus === 'cancel') {
            return 'ANNULATION';
        }
        if (ticket.orderStatus === 'refund') {
            return 'REMBOURSEMENT';
        }
        if ((ticket.note ?? '').toUpperCase().includes('RECTIF ENCAISSEMENT')) {
            return 'RECTIF';
        }
        if (ticket.isCopy) {
            return 'DUPLICATA';
        }

        return 'VENTE';
    };

    const buildClosurePreviewText = (closure: ClosureRecord): string => {
        const lines: string[] = [];

        // ── En-tête ──
        lines.push(posCenter('BURGER S DECINES'));
        lines.push(posCenter('19 AVENUE FRANKLIN ROOSEVELT'));
        lines.push(posCenter('69150 DECINES-CHARPIEU'));
        lines.push(POS_SEP);
        lines.push(posCenter(`Flash journée Z #${closure.id}`));
        lines.push(POS_SEP);

        // ── Métadonnées ──
        lines.push(`Imprime  : ${posFmtDate(closure.closedAt)}`);
        lines.push(`Par      : ${closure.closedBy}`);
        lines.push(`Ouverture: ${posFmtDate(closure.periodStart)}`);
        lines.push(`Cloture  : ${posFmtDate(closure.periodEnd)}`);
        lines.push(POS_SEP);

        // ── Informations générales ──
        lines.push('Informations generales :');
        lines.push(posLR('Tickets      :', String(closure.ordersCount)));
        lines.push(POS_SEP);

        // ── Detail règlements ──
        lines.push(posCenter('Detail reglements'));
        lines.push(POS_SEP);
        const aggEntries = aggregatePayments(closure.paymentBreakdown);
        const paymentTotals = buildPaymentDetailTotals(aggEntries);
        lines.push(posLR('CB :', `${paymentTotals.cb.toFixed(2)}€`));
        lines.push(posLR('Especes :', `${paymentTotals.especes.toFixed(2)}€`));
        lines.push(posLR('TR carte :', `${paymentTotals.trCarte.toFixed(2)}€`));
        lines.push(posLR('Ticket restau :', `${paymentTotals.ticketRestau.toFixed(2)}€`));
        lines.push(posLR('Cheque vacances :', `${paymentTotals.chequeVacances.toFixed(2)}€`));
        if (paymentTotals.autres > 0) {
            lines.push(posLR('Autres :', `${paymentTotals.autres.toFixed(2)}€`));
        }
        lines.push(posLR('TOTAL :', `${paymentTotals.total.toFixed(2)}€`));
        lines.push(POS_SEP);

        // ── Hash ──
        lines.push(`Hash: ${closure.signatureHash.slice(0, 24)}…`);
        if (closure.previousSignatureHash) {
            lines.push(`Prev: ${closure.previousSignatureHash.slice(0, 24)}…`);
        }
        lines.push(POS_SEP);

        return lines.join('\n');
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

        const discountAmount = rawTotalTtc * (discountPercent / 100);

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
        const afterDiscount = rawTotalTtc - discountAmount;

        // Majoration nuit
        const surchargePercent = nightSurchargeActive ? (settings.nightSurchargePercent || 0) : 0;
        const surchargeAmount = afterDiscount * (surchargePercent / 100);
        const totalTtc = afterDiscount + surchargeAmount;
        const taxAmount = totalTtc - totalHt;

        return { rawTotalTtc, discountAmount, surchargeAmount, surchargePercent, totalHt, taxAmount, totalTtc, taxLines };
    }, [cart, orderType, discountPercent, nightSurchargeActive, settings.nightSurchargePercent]);

    const { rawTotalTtc, discountAmount, surchargeAmount, surchargePercent, totalHt, taxAmount, totalTtc, taxLines } = totals;

    const lineTotal = (line: CartItem) => line.product.price * line.quantity;

    const closeMarinadeModal = () => {
        setMarinadeModalVisible(false);
        setMarinadeProduct(null);
        setMarinadeSelectionTarget('cart');
    };

    const closeSnackSauceModal = () => {
        setSnackSauceModalVisible(false);
        setSnackSauceProduct(null);
        setSnackSauceSelections([]);
        setSnackSauceRequiredCount(1);
        setSnackSauceSelectionTarget('cart');
    };

    const closeSundaeModal = () => {
        setSundaeModalVisible(false);
        setSundaeProduct(null);
        setSundaeNappageSelection(null);
        setSundaeCroquantSelections([]);
    };

    const toggleSundaeCroquant = (croquantLabel: string) => {
        setSundaeCroquantSelections((prev) => {
            const isSelected = prev.includes(croquantLabel);
            if (isSelected) {
                return prev.filter((entry) => entry !== croquantLabel);
            }

            if (croquantLabel === 'Sans Croquant') {
                return ['Sans Croquant'];
            }

            const withoutSansCroquant = prev.filter((entry) => entry !== 'Sans Croquant');
            if (withoutSansCroquant.length >= MAX_SUNDAE_CROQUANTS) {
                return withoutSansCroquant;
            }

            return [...withoutSansCroquant, croquantLabel];
        });
    };

    const closeSaladModal = () => {
        setSaladModalVisible(false);
        setSaladProduct(null);
        setSaladProteinSelection(null);
        setSaladSauceSelection(null);
        setSaladSelectionTarget('cart');
    };

    const addSnackWithSauces = () => {
        if (!ensureCaisseOpen('commande')) return;
        if (!snackSauceProduct) return;

        if (snackSauceSelections.length !== snackSauceRequiredCount) {
            showToast(`Choisissez ${snackSauceRequiredCount} sauce${snackSauceRequiredCount > 1 ? 's' : ''}.`, 'error');
            return;
        }

        const selectedSauces = [...snackSauceSelections];
        const note = selectedSauces.length === 1
            ? `Sauce: ${selectedSauces[0]}`
            : `Sauces: ${selectedSauces.join(' + ')}`;
        const sauceKey = selectedSauces
            .map((sauce) => sauce.toLowerCase().replace(/[^a-z0-9]+/g, '_'))
            .join('_');
        const lineId = `${snackSauceProduct.id}-${sauceKey}-${Date.now()}`;
        const customizedDisplayName = `${snackSauceProduct.name} (${note})`;

        if (snackSauceSelectionTarget === 'menu_main') {
            setSelectedMenuMainId(snackSauceProduct.id);
            setMenuMainCustomization({
                productId: snackSauceProduct.id,
                displayName: customizedDisplayName,
            });
            closeSnackSauceModal();

            if (
                saveEditedMenuSelection('main', snackSauceProduct, {
                    mainProductOverride: snackSauceProduct,
                    mainDisplayNameOverride: customizedDisplayName,
                })
            ) {
                return;
            }

            goToNextMenuStage('main');
            return;
        }

        setCart((prev) => {
            const existing = prev.find(
                (line) => line.kind !== 'menu' && line.product.id === snackSauceProduct.id && line.note === note,
            );

            if (existing) {
                return prev.map((line) =>
                    line.lineId === existing.lineId ? { ...line, quantity: line.quantity + 1 } : line,
                );
            }

            return [
                ...prev,
                {
                    lineId,
                    product: snackSauceProduct,
                    quantity: 1,
                    kind: 'product',
                    note,
                },
            ];
        });

        closeSnackSauceModal();
    };

    const addSundaeWithOptions = () => {
        if (!ensureCaisseOpen('commande')) return;
        if (!sundaeProduct) return;
        if (!sundaeNappageSelection) {
            showToast('Choisissez un nappage.', 'error');
            return;
        }

        const selectedCroquants = sundaeCroquantSelections.length > 0
            ? [...sundaeCroquantSelections]
            : ['Sans Croquant'];
        const note = `Nappage: ${sundaeNappageSelection} | Croquant: ${selectedCroquants.join(' + ')}`;
        const variantKey = `${sundaeNappageSelection}_${selectedCroquants.join('_')}`
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        const lineId = `${sundaeProduct.id}-${variantKey}-${Date.now()}`;

        setCart((prev) => {
            const existing = prev.find(
                (line) => line.kind !== 'menu' && line.product.id === sundaeProduct.id && line.note === note,
            );

            if (existing) {
                return prev.map((line) =>
                    line.lineId === existing.lineId ? { ...line, quantity: line.quantity + 1 } : line,
                );
            }

            return [
                ...prev,
                {
                    lineId,
                    product: sundaeProduct,
                    quantity: 1,
                    kind: 'product',
                    note,
                },
            ];
        });

        closeSundaeModal();
    };

    const addSaladWithComposition = () => {
        if (!ensureCaisseOpen('commande')) return;
        if (!saladProduct) return;
        if (!saladProteinSelection || !saladSauceSelection) {
            showToast('Choisissez une protéine et une sauce.', 'error');
            return;
        }

        const note = `Protéine: ${saladProteinSelection} | Sauce: ${saladSauceSelection}`;
        const customizedDisplayName = `${saladProduct.name} (${saladProteinSelection} + ${saladSauceSelection})`;

        if (saladSelectionTarget === 'menu_main') {
            setSelectedMenuMainId(saladProduct.id);
            setMenuMainCustomization({
                productId: saladProduct.id,
                displayName: customizedDisplayName,
            });
            closeSaladModal();

            if (
                saveEditedMenuSelection('main', saladProduct, {
                    mainProductOverride: saladProduct,
                    mainDisplayNameOverride: customizedDisplayName,
                })
            ) {
                return;
            }

            goToNextMenuStage('main');
            return;
        }

        setCart((prev) => {
            const existing = prev.find(
                (line) => line.kind !== 'menu' && line.product.id === saladProduct.id && line.note === note,
            );

            if (existing) {
                return prev.map((line) =>
                    line.lineId === existing.lineId ? { ...line, quantity: line.quantity + 1 } : line,
                );
            }

            return [
                ...prev,
                {
                    lineId: `${saladProduct.id}-${Date.now()}`,
                    product: saladProduct,
                    quantity: 1,
                    kind: 'product',
                    note,
                },
            ];
        });

        closeSaladModal();
    };

    const addProductToCart = (product: Product) => {
        if (!ensureCaisseOpen('commande')) return;
        if (isSundaeProduct(product)) {
            setSundaeProduct(product);
            setSundaeNappageSelection(null);
            setSundaeCroquantSelections([]);
            setSundaeModalVisible(true);
            return;
        }
        if (isSaladProduct(product)) {
            setSaladProduct(product);
            setSaladProteinSelection(null);
            setSaladSauceSelection(null);
            setSaladSelectionTarget('cart');
            setSaladModalVisible(true);
            return;
        }
        const requiredSauceCount = resolveSnackSauceRequiredCount(product);
        if (requiredSauceCount) {
            setSnackSauceProduct(product);
            setSnackSauceRequiredCount(requiredSauceCount);
            setSnackSauceSelections([]);
            setSnackSauceSelectionTarget('cart');
            setSnackSauceModalVisible(true);
            return;
        }

        // Satay → ouvrir modal marinade
        if (isSatayProduct(product)) {
            setMarinadeProduct(product);
            setMarinadeSelectionTarget('cart');
            setMarinadeModalVisible(true);
            return;
        }
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

    const addSatayWithMarinade = (marinade: string) => {
        if (!ensureCaisseOpen('commande')) return;
        if (!marinadeProduct) return;
        const marinadeLabel = marinade;
        const displayName = `${marinadeProduct.name} - ${marinadeLabel}`;

        if (marinadeSelectionTarget === 'menu_main') {
            setSelectedMenuMainId(marinadeProduct.id);
            setMenuMainCustomization({
                productId: marinadeProduct.id,
                displayName,
            });
            closeMarinadeModal();

            if (
                saveEditedMenuSelection('main', marinadeProduct, {
                    mainProductOverride: marinadeProduct,
                    mainDisplayNameOverride: displayName,
                })
            ) {
                return;
            }

            goToNextMenuStage('main');
            return;
        }

        const lineId = `${marinadeProduct.id}-${marinade.toLowerCase().replace(/\s+/g, '_')}-${Date.now()}`;
        setCart((prev) => {
            // Check for existing satay with same marinade
            const existing = prev.find(
                (line) => line.kind !== 'menu' && line.product.id === marinadeProduct.id && line.note === `Marinade: ${marinadeLabel}`,
            );
            if (existing) {
                return prev.map((line) =>
                    line.lineId === existing.lineId ? { ...line, quantity: line.quantity + 1 } : line,
                );
            }
            return [
                ...prev,
                {
                    lineId,
                    product: { ...marinadeProduct, name: displayName },
                    quantity: 1,
                    kind: 'product',
                    note: `Marinade: ${marinadeLabel}`,
                },
            ];
        });
        closeMarinadeModal();
    };

    const handleMenuFlowChange = (flow: MenuFlowType) => {
        if (flow !== 'menu_edition_limitee') {
            setEditionLimiteeSelectionMode('menu');
            setEditionLimiteeModeModalVisible(false);
            setMenuFlowType(flow);
            resetComposedMenu();
            return;
        }
        setEditionLimiteeModeModalVisible(true);
    };

    const applyEditionLimiteeSelectionMode = (mode: 'menu' | 'simple') => {
        setEditionLimiteeSelectionMode(mode);
        setMenuFlowType('menu_edition_limitee');
        setEditionLimiteeModeModalVisible(false);
        resetComposedMenu();
    };

    const resetComposedMenu = () => {
        setMenuStage('main');
        setSelectedMenuMainId(null);
        setSelectedMenuSideId(null);
        setSelectedMenuDrinkId(null);
        setSelectedMenuSauceId(null);
        setIsWowSauceSelected(false);
        setSelectedMenuDessertId(null);
        setSelectedMenuToyId(null);
        setMenuMainCustomization(null);
        setEditingMenuLineId(null);
    };

    /** Ouvre le tunnel menu pré-rempli pour modifier un menu déjà dans le panier */
    const editMenuCartItem = (lineId: string) => {
        // Si on tape sur un autre menu pendant une édition → reset d'abord
        if (editingMenuLineId && editingMenuLineId !== lineId) {
            resetComposedMenu();
        }
        // Si on re-tape sur le même menu → sortir du mode édition
        if (editingMenuLineId === lineId) {
            resetComposedMenu();
            return;
        }

        const item = cart.find((l) => l.lineId === lineId);
        if (!item || item.kind !== 'menu' || !item.menuItems) return;

        // Passer en vue menu dans le tunnel de vente
        setSaleStep('menu');

        // Sélectionner le bon flow type
        const flow = item.menuType ?? 'menu_burgers';
        setEditionLimiteeSelectionMode('menu');
        setMenuFlowType(flow);

        // Pré-remplir les sélections depuis le menu existant
        const mainItem = item.menuItems.find((mi) => mi.role === 'main');
        const sideItem = item.menuItems.find((mi) => mi.role === 'side');
        const drinkItem = item.menuItems.find((mi) => mi.role === 'drink');
        const sauceItem = item.menuItems.find((mi) => mi.role === 'sauce');
        const dessertItem = item.menuItems.find((mi) => mi.role === 'dessert');
        const toyItem = item.menuItems.find((mi) => mi.role === 'toy');
        const wowSauceSelected = Boolean(sauceItem && isWowSauceOption(sauceItem.product));

        setSelectedMenuMainId(mainItem?.product.id ?? null);
        setSelectedMenuSideId(sideItem?.product.id ?? null);
        setSelectedMenuDrinkId(drinkItem?.product.id ?? null);
        setSelectedMenuSauceId(wowSauceSelected ? null : (sauceItem?.product.id ?? null));
        setIsWowSauceSelected(wowSauceSelected);
        setSelectedMenuDessertId(dessertItem?.product.id ?? null);
        setSelectedMenuToyId(toyItem?.product.id ?? null);
        setMenuMainCustomization(
            mainItem
                ? {
                    productId: mainItem.product.id,
                    displayName: mainItem.product.name,
                }
                : null,
        );

        setMenuStage('main');
        setEditingMenuLineId(lineId);
    };

    const resolveMenuClassiquePrice = (main: Product, side: Product, options?: { withWowSauce?: boolean }) => {
        const bySlug = main.slug ? MENU_PRICES_BY_SLUG[main.slug] : undefined;
        const mapped = main.menuPrice ?? bySlug;
        const supplement = side.menuSupplement ?? 0;
        const wowSauceSupplement = isCrownMenuMain(main) && options?.withWowSauce ? 1 : 0;

        if (typeof mapped === 'number') {
            return Number((mapped + supplement + wowSauceSupplement).toFixed(2));
        }

        // Fallback: main.price + 3.80 (average menu uplift) + supplement
        return Number((main.price + 3.80 + supplement + wowSauceSupplement).toFixed(2));
    };

    const KIDS_MENU_PRICE = 5.00;

    const resolveMenuMainProductForMenuItems = (
        main: Product,
        displayNameOverride?: string | null,
    ): Product => {
        const resolvedName = displayNameOverride !== undefined
            ? (displayNameOverride ?? '').trim()
            : (menuMainCustomization?.productId === main.id ? menuMainCustomization.displayName.trim() : '');

        if (!resolvedName) {
            return main;
        }

        return {
            ...main,
            name: resolvedName,
        };
    };

    const goToNextMenuStage = (fromStage: MenuStage) => {
        const stages = currentMenuStages;
        const stageIdx = stages.indexOf(fromStage);
        if (stageIdx >= 0 && stageIdx < stages.length - 1) {
            setMenuStage(stages[stageIdx + 1]);
        }
    };

    const shouldApplyWowSauce = (main: Product) =>
        menuFlowType === 'menu_edition_limitee' && isCrownMenuMain(main) && isWowSauceSelected;

    const resolveMenuSauceOptionProduct = (main: Product, fallbackSauce?: Product | null) => {
        if (shouldApplyWowSauce(main)) {
            return WOW_SAUCE_OPTION_PRODUCT;
        }
        return fallbackSauce ?? null;
    };

    const saveEditedMenuSelection = (
        stage: MenuStage,
        pickedProduct: Product,
        options?: {
            mainProductOverride?: Product;
            mainDisplayNameOverride?: string | null;
        },
    ) => {
        if (!editingMenuLineId) {
            return false;
        }

        const main = stage === 'main' ? (options?.mainProductOverride ?? pickedProduct) : selectedMenuMain;
        const side = stage === 'side' ? pickedProduct : selectedMenuSide;
        const drink = stage === 'drink' ? pickedProduct : selectedMenuDrink;
        const sauce = stage === 'sauce' ? pickedProduct : selectedMenuSauce;
        const dessert = stage === 'dessert' ? pickedProduct : selectedMenuDessert;
        const toy = stage === 'toy' ? pickedProduct : selectedMenuToy;

        if (
            isClassicMenuFlow
            && main
            && side
            && drink
        ) {
            const menuPrice = resolveMenuClassiquePrice(main, side, {
                withWowSauce: shouldApplyWowSauce(main),
            });
            const flowLabel = MENU_FLOW_LABELS[menuFlowType];
            const mainMenuItem = resolveMenuMainProductForMenuItems(main, options?.mainDisplayNameOverride);
            const menuItemsList: CartItem['menuItems'] = [
                { role: 'main', product: mainMenuItem },
                { role: 'side', product: side },
                { role: 'drink', product: drink },
            ];
            const sauceProduct = resolveMenuSauceOptionProduct(main, sauce);
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
                    sendToSalle: true,
                },
                quantity: 1,
                menuItems: menuItemsList,
                menuType: menuFlowType,
            };
            const eid = editingMenuLineId;
            setCart((prev) => prev.map((line) => (line.lineId === eid ? { ...menuLine, lineId: eid, quantity: line.quantity, note: line.note } : line)));
            showToast(`${MENU_STAGE_LABELS[stage]} modifié → ${pickedProduct.name} ✓`);
            resetComposedMenu();
            return true;
        }

        if (menuFlowType === 'menu_kids' && main && side && drink && dessert && toy) {
            const mainMenuItem = resolveMenuMainProductForMenuItems(main, options?.mainDisplayNameOverride);
            const menuItemsList: CartItem['menuItems'] = [
                { role: 'main', product: mainMenuItem },
                { role: 'side', product: side },
                { role: 'drink', product: drink },
                { role: 'dessert', product: dessert },
                { role: 'toy', product: toy },
            ];
            const menuLine: CartItem = {
                lineId: buildLineId(),
                kind: 'menu',
                product: {
                    ...main,
                    id: buildLineId(),
                    name: `Menu Kid'S - ${main.name}`,
                    price: KIDS_MENU_PRICE,
                    menuPrice: KIDS_MENU_PRICE,
                    sendToKitchen: false,
                    sendToSalle: true,
                },
                quantity: 1,
                menuItems: menuItemsList,
                menuType: 'menu_kids',
            };
            const eid = editingMenuLineId;
            setCart((prev) => prev.map((line) => (line.lineId === eid ? { ...menuLine, lineId: eid, quantity: line.quantity, note: line.note } : line)));
            showToast(`${MENU_STAGE_LABELS[stage]} modifié → ${pickedProduct.name} ✓`);
            resetComposedMenu();
            return true;
        }

        return false;
    };

    const handleAddMenuCombo = () => {
        if (!ensureCaisseOpen('commande')) return;
        if (isClassicMenuFlow) {
            if (!selectedMenuMain || !selectedMenuSide || !selectedMenuDrink) return;
            const menuPrice = resolveMenuClassiquePrice(selectedMenuMain, selectedMenuSide, {
                withWowSauce: shouldApplyWowSauce(selectedMenuMain),
            });
            const flowLabel = MENU_FLOW_LABELS[menuFlowType];
            const mainMenuItem = resolveMenuMainProductForMenuItems(selectedMenuMain);
            const menuItemsList: CartItem['menuItems'] = [
                { role: 'main', product: mainMenuItem },
                { role: 'side', product: selectedMenuSide },
                { role: 'drink', product: selectedMenuDrink },
            ];
            const sauceProduct = resolveMenuSauceOptionProduct(selectedMenuMain, selectedMenuSauce);
            if (sauceProduct) {
                menuItemsList.push({ role: 'sauce', product: sauceProduct });
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
                    sendToSalle: true,
                },
                quantity: 1,
                menuItems: menuItemsList,
                menuType: menuFlowType,
            };

            if (editingMenuLineId) {
                setCart((prev) => prev.map((l) => l.lineId === editingMenuLineId ? { ...menuLine, lineId: editingMenuLineId, quantity: l.quantity, note: l.note } : l));
                showToast(`${flowLabel} modifié ✓`);
            } else {
                setCart((prev) => [...prev, menuLine]);
                showToast(`${flowLabel} ajouté: ${selectedMenuMain.name}`);
            }
        } else {
            // Menu Kids — fixed price 5€
            if (!selectedMenuMain || !selectedMenuSide || !selectedMenuDrink || !selectedMenuDessert || !selectedMenuToy) return;
            const mainMenuItem = resolveMenuMainProductForMenuItems(selectedMenuMain);
            const menuItemsList: CartItem['menuItems'] = [
                { role: 'main', product: mainMenuItem },
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
                    sendToSalle: true,
                },
                quantity: 1,
                menuItems: menuItemsList,
                menuType: 'menu_kids',
            };

            if (editingMenuLineId) {
                setCart((prev) => prev.map((l) => l.lineId === editingMenuLineId ? { ...menuLine, lineId: editingMenuLineId, quantity: l.quantity, note: l.note } : l));
                showToast(`Menu Kid'S modifié ✓`);
            } else {
                setCart((prev) => [...prev, menuLine]);
                showToast(`Menu Kid'S ajouté: ${selectedMenuMain.name}`);
            }
        }

        resetComposedMenu();
    };

    const applyMainMenuSelection = (product: Product, withWowSauce: boolean) => {
        setMenuMainCustomization(null);
        setSelectedMenuMainId(product.id);
        setSelectedMenuSauceId(null);
        setIsWowSauceSelected(withWowSauce);

        if (
            saveEditedMenuSelection(
                'main',
                product,
                {
                    mainProductOverride: product,
                    mainDisplayNameOverride: null,
                },
            )
        ) {
            return;
        }

        goToNextMenuStage('main');
    };

    const handlePickMenuProduct = (product: Product) => {
        if (!ensureCaisseOpen('commande')) return;
        const stages = currentMenuStages;
        const stageIdx = stages.indexOf(menuStage);

        if (menuStage === 'main') {
            if (isSaladProduct(product)) {
                setSaladProduct(product);
                setSaladProteinSelection(null);
                setSaladSauceSelection(null);
                setSaladSelectionTarget('menu_main');
                setSaladModalVisible(true);
                return;
            }

            const requiredSauceCount = resolveSnackSauceRequiredCount(product);
            if (requiredSauceCount) {
                setSnackSauceProduct(product);
                setSnackSauceRequiredCount(requiredSauceCount);
                setSnackSauceSelections([]);
                setSnackSauceSelectionTarget('menu_main');
                setSnackSauceModalVisible(true);
                return;
            }

            if (isSatayProduct(product)) {
                setMarinadeProduct(product);
                setMarinadeSelectionTarget('menu_main');
                setMarinadeModalVisible(true);
                return;
            }

            if (menuFlowType === 'menu_edition_limitee' && isCrownMenuMain(product)) {
                Alert.alert(
                    'Option Burger Noir',
                    'Ajouter la sauce WOW (+1,00€) ?',
                    [
                        { text: 'Sans sauce WOW', onPress: () => applyMainMenuSelection(product, false) },
                        { text: 'Avec sauce WOW', onPress: () => applyMainMenuSelection(product, true) },
                    ],
                );
                return;
            }

            setMenuMainCustomization(null);
            setSelectedMenuMainId(product.id);
            setIsWowSauceSelected(false);
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

        if (
            saveEditedMenuSelection(
                menuStage,
                product,
                menuStage === 'main'
                    ? {
                        mainProductOverride: product,
                        mainDisplayNameOverride: null,
                    }
                    : undefined,
            )
        ) {
            return;
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

            if (
                isClassicMenuFlow
                && main
                && side
                && drink
            ) {
                const menuPrice = resolveMenuClassiquePrice(main, side, {
                    withWowSauce: shouldApplyWowSauce(main),
                });
                const flowLabel = MENU_FLOW_LABELS[menuFlowType];
                const mainMenuItem = resolveMenuMainProductForMenuItems(main);
                const menuItemsList: CartItem['menuItems'] = [
                    { role: 'main', product: mainMenuItem },
                    { role: 'side', product: side },
                    { role: 'drink', product: drink },
                ];
                const sauceProduct = resolveMenuSauceOptionProduct(main, sauce ?? (menuStage === 'sauce' ? product : null));
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
                        sendToSalle: true,
                    },
                    quantity: 1,
                    menuItems: menuItemsList,
                    menuType: menuFlowType,
                };

                if (editingMenuLineId) {
                    setCart((prev) => prev.map((l) => l.lineId === editingMenuLineId ? { ...menuLine, lineId: editingMenuLineId, quantity: l.quantity, note: l.note } : l));
                    showToast(`${flowLabel} modifié ✓`);
                } else {
                    setCart((prev) => [...prev, menuLine]);
                    showToast(`${flowLabel} ajouté: ${main.name}`);
                }
                resetComposedMenu();
                return;
            }

            if (menuFlowType === 'menu_kids' && main && side && drink && dessert) {
                const toyProduct = toy ?? (menuStage === 'toy' ? product : null);
                if (!toyProduct) return;
                const mainMenuItem = resolveMenuMainProductForMenuItems(main);
                const menuItemsList: CartItem['menuItems'] = [
                    { role: 'main', product: mainMenuItem },
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
                        sendToSalle: true,
                    },
                    quantity: 1,
                    menuItems: menuItemsList,
                    menuType: 'menu_kids',
                };

                if (editingMenuLineId) {
                    setCart((prev) => prev.map((l) => l.lineId === editingMenuLineId ? { ...menuLine, lineId: editingMenuLineId, quantity: l.quantity, note: l.note } : l));
                    showToast(`Menu Kid'S modifié ✓`);
                } else {
                    setCart((prev) => [...prev, menuLine]);
                    showToast(`Menu Kids ajouté: ${main.name}`);
                }
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
        if (!ensureCaisseOpen('commande')) return;
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

    /** Met à jour la note d'un article spécifique dans le panier */
    const setItemNote = (lineId: string, noteText: string) => {
        if (!ensureCaisseOpen('commande')) return;
        setCart((prev) =>
            prev.map((line) => (line.lineId === lineId ? { ...line, note: noteText || undefined } : line)),
        );
    };

    /** Ouvre le modal de note pour un article donné */
    const openNoteModal = (lineId: string) => {
        const item = cart.find((l) => l.lineId === lineId);
        setNoteTargetLineId(lineId);
        setNoteModalText(item?.note ?? '');
        setNoteModalVisible(true);
    };

    /** Agrège toutes les notes par article en une seule string (pour archivage) */
    const buildAggregatedNote = (items: CartItem[]): string => {
        return items
            .filter((i) => i.note)
            .map((i) => `${i.product.name}: ${i.note}`)
            .join(' | ');
    };

    const isValidTicketNumber = (value: unknown): value is number =>
        typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;

    const getCurrentTicketNumber = (value?: number | null) => (isValidTicketNumber(value) ? value : undefined);

    const setCurrentOrderTicketNumberValue = (value: number | null) => {
        currentOrderTicketNumberRef.current = value;
        setCurrentOrderTicketNumber(value);
    };

    const ensureCurrentOrderTicketNumber = async (): Promise<number> => {
        const existing = getCurrentTicketNumber(currentOrderTicketNumberRef.current);
        if (existing) return existing;
        const reserved = await reserveNextTicketNumber();
        setCurrentOrderTicketNumberValue(reserved);
        return reserved;
    };

    const resetOrder = () => {
        setCart([]);
        setNoteTargetLineId(null);
        setTableLabel('');
        setOrderType('sur_place');
        setDiscountPercent(0);
        resetComposedMenu();
        setKitchenSentForCurrentCart(false);
        setServiceSentForCurrentCart(false);
        setCurrentOrderTicketNumberValue(null);
        showToast('Commande vidée.');
    };

    const holdOrder = () => {
        if (!ensureCaisseOpen('commande')) return;
        if (!cart.length) {
            showToast('Panier vide, rien à mettre en attente.', 'error');
            return;
        }
        const id = `standby-${Date.now()}`;
        setStandbyOrders((prev) => [
            ...prev,
            {
                id,
                cart,
                tableLabel,
                orderType,
                savedAt: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                kitchenSent: kitchenSentForCurrentCart,
                serviceSent: serviceSentForCurrentCart,
                ticketNumber: getCurrentTicketNumber(currentOrderTicketNumberRef.current),
            },
        ]);
        setCart([]);
        setNoteTargetLineId(null);
        setTableLabel('');
        setOrderType('sur_place');
        setDiscountPercent(0);
        setKitchenSentForCurrentCart(false);
        setServiceSentForCurrentCart(false);
        setCurrentOrderTicketNumberValue(null);
        resetComposedMenu();
        showToast('Commande mise en attente.');
    };

    const restoreOrder = (orderId: string) => {
        if (!ensureCaisseOpen('commande')) return;
        const order = standbyOrders.find((o) => o.id === orderId);
        if (!order) return;
        if (cart.length) {
            Alert.alert('Panier non vide', 'Vide le panier actuel avant de reprendre une commande en attente.');
            return;
        }
        setCart(order.cart.map((item: any) => ({ ...item, note: item.note ?? undefined })));
        setTableLabel(order.tableLabel);
        setOrderType(order.orderType);
        setKitchenSentForCurrentCart(order.kitchenSent);
        setServiceSentForCurrentCart(order.serviceSent ?? false);
        setCurrentOrderTicketNumberValue(getCurrentTicketNumber(order.ticketNumber) ?? null);
        setStandbyOrders((prev) => prev.filter((o) => o.id !== orderId));
        setStandbyModalVisible(false);
        showToast(order.kitchenSent ? 'Commande reprise (déjà envoyée en cuisine).' : 'Commande reprise.');
    };

    /** Envoie une commande en attente directement en cuisine sans la reprendre */
    const sendStandbyToKitchen = async (orderId: string) => {
        if (!ensureCaisseOpen('commande')) return;
        const order = standbyOrders.find((o) => o.id === orderId);
        if (!order) return;
        let orderTicketNumber = getCurrentTicketNumber(order.ticketNumber);
        if (!orderTicketNumber) {
            orderTicketNumber = await reserveNextTicketNumber();
            const reservedForStandby = orderTicketNumber;
            setStandbyOrders((prev) =>
                prev.map((o) => (o.id === orderId ? { ...o, ticketNumber: reservedForStandby } : o)),
            );
        }
        const kitchenAlreadySent = order.kitchenSent;
        const serviceAlreadySent = order.serviceSent ?? false;
        const serviceRequested = settings.serviceTicketEnabled;
        if (kitchenAlreadySent && (!serviceRequested || serviceAlreadySent)) {
            showToast('Déjà envoyée en cuisine.', 'error');
            return;
        }
        try {
            const runtimeSettings = resolveRuntimePrinterSettings(settings);
            if (settings.printMode === 'usb_single' && !runtimeSettings.kitchenPrinterUrl) {
                showToast('Aucune imprimante USB sélectionnée.', 'error');
                return;
            }
            const noteText = buildAggregatedNote(order.cart);
            const payload = {
                cartItems: order.cart,
                tableLabel: order.tableLabel,
                note: noteText,
                total: order.cart.reduce((s, l) => s + l.product.price * l.quantity, 0),
                seller: session.username,
                orderType: order.orderType,
                ticketNumber: orderTicketNumber,
            };

            const stamp = Date.now();
            const [kitchenResult, serviceResult] = await Promise.all([
                kitchenAlreadySent
                    ? Promise.resolve({ ok: true, message: 'Cuisine déjà envoyée.' })
                    : printKitchenTicket(runtimeSettings, payload, {
                        idempotencyKey: `standby-kitchen-${orderId}-${stamp}`,
                        maxRetries: 0,
                    }),
                serviceRequested && !serviceAlreadySent
                    ? printServiceTicket(runtimeSettings, payload, {
                        idempotencyKey: `standby-service-${orderId}-${stamp}`,
                        maxRetries: 0,
                    })
                    : Promise.resolve({ ok: true, message: 'Ticket salle non requis.' }),
            ]);

            const nextKitchenSent = kitchenAlreadySent || kitchenResult.ok;
            const nextServiceSent = serviceAlreadySent || (serviceRequested && !serviceAlreadySent ? serviceResult.ok : serviceAlreadySent);
            setStandbyOrders((prev) =>
                prev.map((o) => (o.id === orderId ? { ...o, kitchenSent: nextKitchenSent, serviceSent: nextServiceSent } : o)),
            );

            if (!nextKitchenSent) {
                showToast(kitchenResult.message || 'Erreur impression cuisine.', 'error');
                return;
            }
            if (serviceRequested && !nextServiceSent) {
                showToast(serviceResult.message || 'Cuisine imprimée, ticket salle en erreur.', 'error');
                return;
            }

            if (serviceRequested) {
                showToast('Envoyée cuisine + salle ✓');
            } else {
                showToast('Envoyée en cuisine ✓');
            }
        } catch {
            showToast('Erreur envoi cuisine.', 'error');
        }
    };

    /** Envoie le panier courant en cuisine (et optionnellement en salle) sans encaisser */
    const sendCurrentCartToKitchen = async (forceServiceTicket = false) => {
        if (!ensureCaisseOpen('commande')) return;
        if (!cart.length) {
            showToast('Panier vide.', 'error');
            return;
        }
        const serviceRequested = forceServiceTicket || settings.serviceTicketEnabled;
        if (kitchenSentForCurrentCart && (!serviceRequested || serviceSentForCurrentCart)) {
            showToast('Déjà envoyée en cuisine.', 'error');
            return;
        }
        setIsSendingKitchen(true);
        try {
            const runtimeSettings = resolveRuntimePrinterSettings(settings);
            if (settings.printMode === 'usb_single' && !runtimeSettings.kitchenPrinterUrl) {
                showToast('Aucune imprimante USB sélectionnée.', 'error');
                return;
            }
            const noteText = buildAggregatedNote(cart);
            const orderTicketNumber = await ensureCurrentOrderTicketNumber();
            const payload = {
                cartItems: cart,
                tableLabel,
                note: noteText,
                total: totalTtc,
                seller: session.username,
                orderType,
                ticketNumber: orderTicketNumber,
            };

            const stamp = Date.now();
            const [kitchenResult, serviceResult] = await Promise.all([
                kitchenSentForCurrentCart
                    ? Promise.resolve({ ok: true, message: 'Cuisine déjà envoyée.' })
                    : printKitchenTicket(runtimeSettings, payload, {
                        idempotencyKey: `cart-kitchen-${stamp}`,
                        maxRetries: 0,
                    }),
                serviceRequested && !serviceSentForCurrentCart
                    ? printServiceTicket(runtimeSettings, payload, {
                        idempotencyKey: `cart-service-${stamp}`,
                        maxRetries: 0,
                    })
                    : Promise.resolve({ ok: true, message: 'Ticket salle non requis.' }),
            ]);

            const nextKitchenSent = kitchenSentForCurrentCart || kitchenResult.ok;
            const nextServiceSent = serviceSentForCurrentCart || (serviceRequested && !serviceSentForCurrentCart ? serviceResult.ok : serviceSentForCurrentCart);
            setKitchenSentForCurrentCart(nextKitchenSent);
            setServiceSentForCurrentCart(nextServiceSent);

            if (!nextKitchenSent) {
                showToast(kitchenResult.message || 'Erreur impression cuisine.', 'error');
                return;
            }
            if (serviceRequested && !nextServiceSent) {
                showToast(serviceResult.message || 'Cuisine imprimée, ticket salle en erreur.', 'error');
                return;
            }

            if (serviceRequested) {
                showToast('Envoyée cuisine + salle ✓');
            } else {
                showToast('Envoyée en cuisine ✓');
            }
        } catch {
            showToast('Erreur envoi cuisine.', 'error');
        } finally {
            setIsSendingKitchen(false);
        }
    };

    const refreshStats = async () => {
        const [today, currentWeekStats] = await Promise.all([getTodayStats(), getWeeklyStats()]);
        setStats(today);
        setWeeklyStats(currentWeekStats);
    };

    const isValidPrinterUrl = (url: string): boolean => {
        const trimmed = url.trim();
        if (!trimmed) return true;
        try {
            const parsed = new URL(trimmed);
            return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
        } catch {
            return false;
        }
    };

    const handleSaveSettings = async () => {
        if (session.role !== 'admin') {
            return;
        }

        if (settings.printMode === 'network_dual') {
            if (settings.cashPrinterUrl && !isValidPrinterUrl(settings.cashPrinterUrl)) {
                showToast('URL caisse invalide. Format: http://hôte[:port]', 'error');
                return;
            }
            if (settings.kitchenPrinterUrl && !isValidPrinterUrl(settings.kitchenPrinterUrl)) {
                showToast('URL cuisine invalide. Format: http://hôte[:port]', 'error');
                return;
            }
        } else {
            if (!settings.usbPrinterId.trim()) {
                showToast('Sélectionne une imprimante USB.', 'error');
                return;
            }
        }

        const nextSettings: PrinterSettings = {
            ...settings,
            printMode: settings.printMode,
            cashPrinterUrl: settings.cashPrinterUrl.trim(),
            kitchenPrinterUrl: settings.kitchenPrinterUrl.trim(),
            usbPrinterId: settings.usbPrinterId.trim(),
            usbPrinterName: settings.usbPrinterName.trim(),
            ticketCustomization: normalizeTicketCustomization(settings.ticketCustomization),
        };

        await savePrinterSettings(nextSettings);
        setSettings(nextSettings);
        showToast('Paramètres imprimantes sauvegardés.');
        await refreshPrintQueueState();
        void processPrintQueue({ silent: true });
    };

    const handleToggleStock = async (productId: string, active: boolean) => {
        await setProductActive(productId, active);
        await loadProductsData();
    };

    const handleToggleProductKitchen = async (productId: string, value: boolean) => {
        if (session.role !== 'admin') return;
        await setProductKitchen(productId, value);
        await loadProductsData();
    };

    const handleToggleProductSalle = async (productId: string, value: boolean) => {
        if (session.role !== 'admin') return;
        await setProductSalle(productId, value);
        await loadProductsData();
    };

    const handleToggleCategoryKitchen = async (category: ProductCategory, value: boolean) => {
        if (session.role !== 'admin') return;
        await setCategoryKitchen(category, value);
        await loadProductsData();
        showToast(`${CATEGORY_LABELS[category]} → Cuisine ${value ? 'activé' : 'désactivé'}`);
    };

    const handleToggleCategorySalle = async (category: ProductCategory, value: boolean) => {
        if (session.role !== 'admin') return;
        await setCategorySalle(category, value);
        await loadProductsData();
        showToast(`${CATEGORY_LABELS[category]} → Salle ${value ? 'activé' : 'désactivé'}`);
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
            setFormSendToSalle(product.sendToSalle);
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
            setFormSendToSalle(true);
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
                sendToSalle: formSendToSalle,
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

    const editionLimiteeStockCount = useMemo(
        () => allProducts.filter((p) => isEditionLimiteeProduct(p)).length,
        [allProducts],
    );

    const filteredStockProducts = useMemo(() => {
        let list = allProducts;
        if (stockFilter === 'edition_limitee') {
            list = list.filter((p) => isEditionLimiteeProduct(p));
        } else if (stockFilter !== 'all') {
            list = list.filter((p) => p.category === stockFilter);
        }
        if (stockSearch.trim()) {
            const q = stockSearch.trim().toLowerCase();
            list = list.filter((p) => p.name.toLowerCase().includes(q));
        }
        return list;
    }, [allProducts, stockFilter, stockSearch]);

    const requestPay = (paymentMethod: string) => {
        const normalized = paymentMethod.trim();
        if (!normalized) {
            showToast('Moyen de paiement invalide.', 'error');
            return;
        }
        if (!cart.length) {
            Alert.alert('Panier vide', 'Ajoute des produits avant encaissement.');
            return;
        }
        if (!ensureCaisseOpen('encaissement')) return;

        const isEspeces = normalized.toLowerCase() === 'espèces' || normalized.toLowerCase() === 'especes';
        if (isEspeces) {
            // Ouvrir le modal rendu de monnaie
            setPendingPaymentMethod(normalized);
            setCashGivenInput('');
            setCashChangeVisible(true);
            return;
        }

        const normalizedLower = normalized.toLowerCase();
        const isVoucher =
            normalizedLower === 'ticket restaurant' ||
            normalizedLower === 'chèque vacances' ||
            normalizedLower === 'cheque vacances';
        if (isVoucher) {
            setPendingPaymentMethod(normalized);
            setVoucherAmountInput('');
            setVoucherComplement(null);
            setVoucherModalVisible(true);
            return;
        }

        // Paiement non-espèces → confirmation
        setPendingPaymentMethod(normalized);
        setConfirmPayVisible(true);
    };

    const confirmAndPay = () => {
        setConfirmPayVisible(false);
        setCashChangeVisible(false);
        handlePay(pendingPaymentMethod);
    };

    const handlePay = async (paymentMethod: string) => {
        if (isHandlingPayRef.current || payingMethod !== null) {
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
        if (!ensureCaisseOpen('encaissement')) return;
        const runtimeSettings = resolveRuntimePrinterSettings(settings);
        if (settings.printMode === 'usb_single' && !runtimeSettings.cashPrinterUrl) {
            showToast('Aucune imprimante USB sélectionnée.', 'error');
            return;
        }
        isHandlingPayRef.current = true;
        setPayingMethod(normalizedPaymentMethod);
        let saleSaved = false;
        try {
            const cartSnapshot = [...cart];
            const tableLabelSnapshot = tableLabel;
            const noteSnapshot = buildAggregatedNote(cartSnapshot);
            const totalTtcSnapshot = totalTtc;
            const rawTotalTtcSnapshot = rawTotalTtc;
            const discountAmountSnapshot = discountAmount;
            const surchargeAmountSnapshot = surchargeAmount;
            const surchargePercentSnapshot = surchargePercent;
            const taxAmountSnapshot = taxAmount;
            const taxLinesSnapshot = [...taxLines];
            const totalHtSnapshot = totalHt;
            const orderTypeSnapshot = orderType;
            const kitchenAlreadySent = kitchenSentForCurrentCart;
            const serviceAlreadySent = serviceSentForCurrentCart;

            const reservedTicketNumber = await ensureCurrentOrderTicketNumber();
            const basePayload = {
                cartItems: cartSnapshot,
                tableLabel: tableLabelSnapshot,
                note: noteSnapshot,
                total: totalTtcSnapshot,
                paymentMethod: normalizedPaymentMethod,
                seller: session.username,
                taxLines: taxLinesSnapshot,
                totalHt: totalHtSnapshot,
                discountAmount: discountAmountSnapshot,
                surchargeAmount: surchargeAmountSnapshot,
                surchargePercent: surchargePercentSnapshot,
                orderType: orderTypeSnapshot,
                ticketNumber: reservedTicketNumber,
            };

            const cashDocument = buildCashTicketDocument(basePayload, runtimeSettings);
            const kitchenDocuments = kitchenAlreadySent ? [] : buildKitchenTicketDocuments(runtimeSettings, basePayload);
            const shouldPrintServiceTicket = !serviceAlreadySent;
            const serviceDocument = shouldPrintServiceTicket ? buildServiceTicketDocument(basePayload, runtimeSettings) : null;
            const kitchenText = kitchenDocuments.length
                ? kitchenDocuments.map((doc) => doc.ticketText).join('\n\n')
                : buildKitchenTicketText(basePayload);

            const savedOrder = await saveOrder({
                ticketNumber: reservedTicketNumber,
                userRole: session.role,
                userName: session.username,
                items: cartSnapshot,
                subtotal: rawTotalTtcSnapshot,
                discountAmount: discountAmountSnapshot,
                taxAmount: taxAmountSnapshot,
                total: totalTtcSnapshot,
                paymentMethod: normalizedPaymentMethod,
                tableLabel: tableLabelSnapshot,
                note: noteSnapshot,
                orderType: orderTypeSnapshot,
                cashTicketText: cashDocument.ticketText,
                kitchenTicketText: kitchenText,
            });
            saleSaved = true;

            const baseJobKey = `order-${savedOrder.id}-ticket-${savedOrder.ticketNumber}`;
            if (!kitchenAlreadySent) {
                for (let i = 0; i < kitchenDocuments.length; i += 1) {
                    const doc = kitchenDocuments[i];
                    await createPrintJob({
                        orderId: savedOrder.id,
                        ticketNumber: savedOrder.ticketNumber,
                        channel: 'kitchen',
                        printerUrl: doc.printerUrl,
                        requestXml: doc.xml,
                        ticketText: doc.ticketText,
                        idempotencyKey: `${baseJobKey}-kitchen-${i + 1}`,
                        maxAttempts: 3,
                    });
                }
            }

            if (serviceDocument) {
                await createPrintJob({
                    orderId: savedOrder.id,
                    ticketNumber: savedOrder.ticketNumber,
                    channel: 'service',
                    printerUrl: runtimeSettings.cashPrinterUrl,
                    requestXml: serviceDocument.xml,
                    ticketText: serviceDocument.ticketText,
                    idempotencyKey: `${baseJobKey}-service`,
                    maxAttempts: 3,
                });
            }

            await createPrintJob({
                orderId: savedOrder.id,
                ticketNumber: savedOrder.ticketNumber,
                channel: 'cash',
                printerUrl: runtimeSettings.cashPrinterUrl,
                requestXml: cashDocument.xml,
                ticketText: cashDocument.ticketText,
                idempotencyKey: `${baseJobKey}-cash`,
                maxAttempts: 3,
            });

            setCart([]);
            setPayChoiceOpen(false);
            setNoteTargetLineId(null);
            setKitchenSentForCurrentCart(false);
            setServiceSentForCurrentCart(false);
            setCurrentOrderTicketNumberValue(null);
            resetComposedMenu();

            let paymentToast = 'Paiement enregistré ✓';
            let paymentToastType: ToastType = 'success';
            if (settings.cashDrawerEnabled && isCashPaymentMethod(normalizedPaymentMethod)) {
                const drawerResult = await openCashDrawer(runtimeSettings.cashPrinterUrl);
                if (drawerResult.ok) {
                    paymentToast = 'Paiement enregistré + tiroir déclenché ✓';
                } else {
                    paymentToast = `Paiement enregistré (tiroir non déclenché: ${drawerResult.message})`;
                    paymentToastType = 'error';
                }
            }
            showToast(paymentToast, paymentToastType);
            await refreshStats();
            if (session.role === 'admin') {
                await loadRecentTickets();
            }
            await refreshPrintQueueState();
            void processPrintQueue({ silent: false, limit: 12 });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : '';
            console.error('[PAY] handlePay failed', error);
            if (saleSaved) {
                setCart([]);
                setPayChoiceOpen(false);
                setNoteTargetLineId(null);
                setKitchenSentForCurrentCart(false);
                setServiceSentForCurrentCart(false);
                setCurrentOrderTicketNumberValue(null);
                resetComposedMenu();
                showToast('Vente enregistrée, mais file impression en erreur.', 'error');
                await refreshPrintQueueState();
            } else if (message.includes('orders.ticket_number')) {
                showToast('Conflit numéro ticket. Réessaie l’encaissement.', 'error');
            } else {
                showToast('Encaissement impossible (commande non finalisée).', 'error');
            }
        } finally {
            setPayingMethod(null);
            isHandlingPayRef.current = false;
        }
    };

    const handleLoadXReport = async () => {
        if (!canAccessClosure || isLoadingXReport) {
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

    const handlePrintZTicketPreview = async () => {
        if (!canAccessClosure || isPrintingZTicketPreview || isClosingZReport) {
            return;
        }

        setIsPrintingZTicketPreview(true);
        try {
            const snapshot = await getCurrentXSnapshot();
            setXSnapshot(snapshot);

            const runtimeSettings = resolveRuntimePrinterSettings(settings);
            const reportResult = await printDailyReport(
                runtimeSettings,
                { ...snapshot, closedBy: session.username, openedAt: caisseOpenState.openedAt ?? undefined },
                { maxRetries: 0 },
            );

            if (reportResult.ok) {
                showToast('Ticket de clôture imprimé (sans clôture).');
            } else {
                showToast(`Ticket non imprimé: ${reportResult.message}`, 'error');
            }
        } catch {
            showToast('Impression du ticket de clôture impossible.', 'error');
        } finally {
            setIsPrintingZTicketPreview(false);
        }
    };

    const handlePrintClosedFlashTicket = async (closure: ClosureRecord) => {
        if (!canAccessClosure || isClosingZReport || isPrintingClosedFlashId === closure.id) {
            return;
        }

        setIsPrintingClosedFlashId(closure.id);
        try {
            const runtimeSettings = resolveRuntimePrinterSettings(settings);
            const reportResult = await printDailyReport(
                runtimeSettings,
                { ...closure, openedAt: closure.periodStart },
                {
                    idempotencyKey: `reprint-z-flash-${closure.id}-${Date.now()}`,
                    maxRetries: 0,
                },
            );

            if (reportResult.ok) {
                showToast(`Ticket flash Z #${closure.id} imprimé.`);
            } else {
                showToast(`Ticket flash Z #${closure.id} non imprimé: ${reportResult.message}`, 'error');
            }
        } catch {
            showToast(`Impression ticket flash Z #${closure.id} impossible.`, 'error');
        } finally {
            setIsPrintingClosedFlashId((current) => (current === closure.id ? null : current));
        }
    };

    const handleCloseZReport = () => {
        if (!canAccessClosure || isClosingZReport) {
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

                        // Impression automatique du rapport journalier
                        try {
                            const runtimeSettings = resolveRuntimePrinterSettings(settings);
                            const reportResult = await printDailyReport(
                                runtimeSettings,
                                { ...closure, closedBy: session.username, openedAt: caisseOpenState.openedAt ?? undefined },
                                {
                                    idempotencyKey: `report-z-${closure.id}`,
                                    maxRetries: 0,
                                },
                            );
                            if (reportResult.ok) {
                                showToast('Rapport journalier imprimé.');
                            } else {
                                showToast(`Rapport non imprimé: ${reportResult.message}`, 'error');
                            }
                        } catch {
                            showToast('Erreur impression rapport journalier.', 'error');
                        }

                        // Reset caisse open state after Z closure
                        try {
                            await closeCaisseState();
                            setCaisseOpenStateLocal({ isOpen: false, openedAt: null, openedBy: null });
                            // Désactiver la majoration nuit à la fermeture
                            setNightSurchargeActive(false);
                            nightSurchargePopupShownRef.current = false;
                        } catch {
                            // non-blocking
                        }
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
            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(filePath, { mimeType: 'text/csv', dialogTitle: 'Exporter CSV tickets' });
            }
            showToast(`CSV exporté (${result.rowsCount} lignes) ✓`);
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
                            await refreshPrintQueueState();
                            void processPrintQueue({ silent: true });
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



    const handleTestCashPrinter = async () => {
        if (session.role !== 'admin' || isTestingCashPrinter) {
            return;
        }

        setIsTestingCashPrinter(true);
        try {
            const runtimeSettings = resolveRuntimePrinterSettings(settings);
            if (!runtimeSettings.cashPrinterUrl) {
                showToast('Imprimante caisse non configurée.', 'error');
                return;
            }
            const result = await printTestTicket(runtimeSettings.cashPrinterUrl, 'TEST IMPRIMANTE CAISSE', {
                idempotencyKey: `test-cash-${Date.now()}`,
            });
            showToast(result.message, result.ok ? 'success' : 'error');
        } catch {
            showToast('Test imprimante caisse impossible.', 'error');
        } finally {
            setIsTestingCashPrinter(false);
        }
    };

    const handleTestCashDrawer = async () => {
        if (session.role !== 'admin' || isTestingCashDrawer) {
            return;
        }

        if (!settings.cashDrawerEnabled) {
            showToast('Active le tiroir-caisse dans les paramètres pour le tester.', 'error');
            return;
        }

        setIsTestingCashDrawer(true);
        try {
            const runtimeSettings = resolveRuntimePrinterSettings(settings);
            if (!runtimeSettings.cashPrinterUrl) {
                showToast('Imprimante caisse non configurée.', 'error');
                return;
            }
            const result = await openCashDrawer(runtimeSettings.cashPrinterUrl);
            const testedAt = new Date().toLocaleString('fr-FR');
            if (!result.ok) {
                setCashDrawerTestStatus({
                    testedAt,
                    commandOk: false,
                    operatorConfirmedOpen: null,
                    message: result.message,
                });
                showToast(`Test tiroir KO: ${result.message}`, 'error');
                return;
            }

            setCashDrawerTestStatus({
                testedAt,
                commandOk: true,
                operatorConfirmedOpen: null,
                message: result.message,
            });

            Alert.alert(
                'Confirmation tiroir',
                'Commande envoyée. Le tiroir s’est-il bien ouvert ?',
                [
                    {
                        text: 'Non',
                        style: 'destructive',
                        onPress: () => {
                            setCashDrawerTestStatus({
                                testedAt,
                                commandOk: true,
                                operatorConfirmedOpen: false,
                                message: 'Commande envoyée mais tiroir non ouvert (confirmé opérateur).',
                            });
                            showToast('Commande envoyée, tiroir non ouvert.', 'error');
                        },
                    },
                    {
                        text: 'Oui',
                        onPress: () => {
                            setCashDrawerTestStatus({
                                testedAt,
                                commandOk: true,
                                operatorConfirmedOpen: true,
                                message: 'Tiroir ouvert (confirmé opérateur).',
                            });
                            showToast('Tiroir ouvert confirmé ✓', 'success');
                        },
                    },
                ],
                { cancelable: false },
            );
        } catch {
            showToast('Test tiroir impossible.', 'error');
        } finally {
            setIsTestingCashDrawer(false);
        }
    };

    const handleTestKitchenPrinter = async () => {
        if (session.role !== 'admin' || isTestingKitchenPrinter) {
            return;
        }

        setIsTestingKitchenPrinter(true);
        try {
            const runtimeSettings = resolveRuntimePrinterSettings(settings);
            if (!runtimeSettings.kitchenPrinterUrl) {
                showToast('Imprimante cuisine non configurée.', 'error');
                return;
            }
            const result = await printTestTicket(runtimeSettings.kitchenPrinterUrl, 'TEST IMPRIMANTE CUISINE', {
                idempotencyKey: `test-kitchen-${Date.now()}`,
            });
            showToast(result.message, result.ok ? 'success' : 'error');
        } catch {
            showToast('Test imprimante cuisine impossible.', 'error');
        } finally {
            setIsTestingKitchenPrinter(false);
        }
    };

    const handleScanPrinters = async () => {
        if (session.role !== 'admin' || isScanningPrinters) return;
        setIsScanningPrinters(true);
        setDiscoveredPrinters([]);
        try {
            // Detect subnet from existing URLs or use common subnets
            const existingUrl = settings.cashPrinterUrl || settings.kitchenPrinterUrl || '';
            const ipMatch = existingUrl.match(/(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}/);
            const subnets = ipMatch ? [ipMatch[1]] : ['192.168.1', '192.168.0', '10.0.0'];

            let allFound: EpsonDiscoveryItem[] = [];
            for (const subnet of subnets) {
                const found = await discoverEpsonPrinters({ subnet, timeoutMs: 1200 });
                allFound = [...allFound, ...found];
                if (found.length > 0) break; // stop scanning other subnets if we found printers
            }

            setDiscoveredPrinters(allFound);
            if (allFound.length === 0) {
                showToast('Aucune imprimante Epson trouvée sur le réseau.', 'error');
            } else {
                showToast(`${allFound.length} imprimante(s) trouvée(s) !`, 'success');
            }
        } catch {
            showToast('Erreur lors du scan réseau.', 'error');
        } finally {
            setIsScanningPrinters(false);
        }
    };

    const handleScanUsbPrinters = async () => {
        if (session.role !== 'admin' || isScanningUsbPrinters) return;
        if (!isUsbPrinterSupported()) {
            showToast('USB indisponible: utilise un build natif Android.', 'error');
            return;
        }

        setIsScanningUsbPrinters(true);
        setUsbPrinters([]);
        try {
            const devices = await listUsbPrinterDevices();
            setUsbPrinters(devices);
            if (!devices.length) {
                showToast('Aucune imprimante USB détectée.', 'error');
            } else {
                showToast(`${devices.length} imprimante(s) USB détectée(s).`, 'success');
            }
        } catch {
            showToast('Scan USB impossible.', 'error');
        } finally {
            setIsScanningUsbPrinters(false);
        }
    };

    const handleSelectUsbPrinter = async (device: UsbPrinterDevice) => {
        if (session.role !== 'admin' || isAuthorizingUsbPrinter) return;
        if (!isUsbPrinterSupported()) {
            showToast('USB indisponible: utilise un build natif Android.', 'error');
            return;
        }

        setIsAuthorizingUsbPrinter(true);
        try {
            const permission = await requestUsbPrinterPermission(device.deviceId);
            if (!permission.granted) {
                showToast(permission.message || 'Permission USB refusée.', 'error');
                return;
            }

            const printableName = [device.manufacturerName, device.productName]
                .filter(Boolean)
                .join(' ')
                .trim() || `USB #${device.deviceId}`;

            setSettings((prev) => ({
                ...prev,
                usbPrinterId: String(device.deviceId),
                usbPrinterName: printableName,
            }));
            showToast(`Imprimante USB sélectionnée: ${printableName}`);
        } catch {
            showToast('Impossible de sélectionner cette imprimante USB.', 'error');
        } finally {
            setIsAuthorizingUsbPrinter(false);
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
        if (!isAdminRole) {
            showToast('Annulation ticket réservée admin.', 'error');
            return;
        }
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

    const openPaymentCorrectionModal = () => {
        if (!isAdminRole) {
            showToast('Correction encaissement réservée admin/manager.', 'error');
            return;
        }
        if (!selectedTicket) {
            showToast('Sélectionne un ticket.', 'error');
            return;
        }
        if (selectedTicket.orderStatus !== 'sale' || selectedTicket.isCopy) {
            showToast('Correction encaissement disponible uniquement sur un ticket de vente.', 'error');
            return;
        }
        if (hasPaymentCorrectionSelectedTicket) {
            showToast('Une correction d’encaissement existe déjà pour ce ticket.', 'error');
            return;
        }

        setPaymentCorrectionMethod(selectedTicket.paymentMethod);
        setPaymentCorrectionReason('');
        setPaymentCorrectionModalVisible(true);
    };

    const submitPaymentMethodCorrection = async () => {
        if (!isAdminRole) {
            showToast('Correction encaissement réservée admin/manager.', 'error');
            return;
        }
        if (!selectedTicket || isSavingPaymentCorrection) {
            return;
        }
        if (selectedTicket.orderStatus !== 'sale' || selectedTicket.isCopy) {
            showToast('Correction encaissement impossible sur ce ticket.', 'error');
            return;
        }

        const reason = paymentCorrectionReason.trim();
        const nextPaymentMethod = paymentCorrectionMethod.trim();
        const currentPaymentMethod = selectedTicket.paymentMethod.trim();

        if (!nextPaymentMethod) {
            showToast('Choisis un nouveau mode d’encaissement.', 'error');
            return;
        }
        if (!reason) {
            showToast('Motif obligatoire.', 'error');
            return;
        }
        if (normalizePaymentMethodForCompare(currentPaymentMethod) === normalizePaymentMethodForCompare(nextPaymentMethod)) {
            showToast('Le nouveau mode est identique à l’actuel.', 'error');
            return;
        }

        setIsSavingPaymentCorrection(true);
        try {
            const label = 'RECTIF ENCAISSEMENT';
            const orderType = selectedTicket.orderType ?? 'sur_place';
            const commonPayload = {
                userRole: session.role,
                userName: session.username,
                items: selectedTicket.items,
                tableLabel: selectedTicket.tableLabel ?? '',
                orderType,
                originalOrderId: selectedTicket.id,
                isCopy: true,
            } as const;

            // 1) Neutralize original payment allocation (negative line on old method)
            await saveOrder({
                ...commonPayload,
                subtotal: selectedTicket.subtotal * -1,
                discountAmount: selectedTicket.discountAmount * -1,
                taxAmount: selectedTicket.taxAmount * -1,
                total: selectedTicket.total * -1,
                paymentMethod: currentPaymentMethod,
                note: `${label} ticket #${selectedTicket.ticketNumber} · annule: ${currentPaymentMethod} · ${reason}`,
                cashTicketText: `${label}\nTicket origine: #${selectedTicket.ticketNumber}\nAnnule moyen: ${currentPaymentMethod}\nMotif: ${reason}`,
                kitchenTicketText: `${label}\nTicket origine: #${selectedTicket.ticketNumber}\nAnnule moyen: ${currentPaymentMethod}\nMotif: ${reason}`,
                orderStatus: 'refund',
                statusReason: `${label}: ${reason}`,
            });

            // 2) Re-allocate to corrected payment method (positive line)
            const correctedSale = await saveOrder({
                ...commonPayload,
                subtotal: selectedTicket.subtotal,
                discountAmount: selectedTicket.discountAmount,
                taxAmount: selectedTicket.taxAmount,
                total: selectedTicket.total,
                paymentMethod: nextPaymentMethod,
                note: `${label} ticket #${selectedTicket.ticketNumber} · ${currentPaymentMethod} -> ${nextPaymentMethod} · ${reason}`,
                cashTicketText: `${label}\nTicket origine: #${selectedTicket.ticketNumber}\nAncien: ${currentPaymentMethod}\nNouveau: ${nextPaymentMethod}\nMotif: ${reason}`,
                kitchenTicketText: `${label}\nTicket origine: #${selectedTicket.ticketNumber}\nAncien: ${currentPaymentMethod}\nNouveau: ${nextPaymentMethod}\nMotif: ${reason}`,
                orderStatus: 'sale',
            });

            await refreshStats();
            setSelectedTicketId(correctedSale.id);
            await loadRecentTickets();
            setPaymentCorrectionModalVisible(false);
            showToast('Encaissement corrigé et tracé.');
        } catch {
            showToast('Correction encaissement impossible.', 'error');
        } finally {
            setIsSavingPaymentCorrection(false);
        }
    };

    const submitTicketCorrection = async () => {
        if (!isAdminRole) {
            showToast('Annulation ticket réservée admin.', 'error');
            return;
        }
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
                ticketNumber: selectedTicket.ticketNumber,
                isDuplicate: true,
            };
            const runtimeSettings = resolveRuntimePrinterSettings(settings);

            if (ticketPreviewMode === 'caisse') {
                const c = await printCashTicket(runtimeSettings, payload, {
                    idempotencyKey: `reprint-cash-${selectedTicket.id}-${Date.now()}`,
                    maxRetries: 0,
                });
                if (c.ok) showToast('Duplicata caisse imprimé.', 'success');
                else showToast(c.message || 'Erreur impression duplicata caisse.', 'error');
            } else {
                // cuisine mode
                const k = await printKitchenTicket(runtimeSettings, payload, {
                    idempotencyKey: `reprint-kitchen-${selectedTicket.id}-${Date.now()}`,
                    maxRetries: 0,
                });
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
                {initError ? (
                    <Text style={[styles.subtitle, { color: COLORS.danger, marginTop: 16 }]}>{initError}</Text>
                ) : null}
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
                                await refreshPrintQueueState();
                                void processPrintQueue({ silent: true });
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

    const isBusy = payingMethod !== null;

    return (
        <SafeAreaView style={styles.screen}>
            <StatusBar style="light" />
            <View ref={layoutRef} style={styles.layout}>
                {isSidebarVisible ? (
                    <View style={styles.sidebar} onLayout={(e) => { sidebarWidthRef.current = e.nativeEvent.layout.width; }}>
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
                                    onPress={() => {
                                        setActiveSection('vente');
                                        setIsSidebarVisible(false);
                                    }}
                                >
                                    <Text style={[styles.navBtnText, activeSection === 'vente' && styles.navBtnTextActive]}>🛒 Vente</Text>
                                </Pressable>

                                <Pressable
                                    style={[styles.navBtn, activeSection === 'stock' && styles.navBtnActive]}
                                    onPress={() => { setActiveSection('stock'); setIsSidebarVisible(true); }}
                                >
                                    <Text style={[styles.navBtnText, activeSection === 'stock' && styles.navBtnTextActive]}>📦 Disponibilité</Text>
                                </Pressable>

                                <Pressable
                                    style={[styles.navBtn, activeSection === 'tickets' && styles.navBtnActive]}
                                    onPress={() => { setActiveSection('tickets'); setIsSidebarVisible(true); }}
                                >
                                    <Text style={[styles.navBtnText, activeSection === 'tickets' && styles.navBtnTextActive]}>
                                        🧾 Tickets
                                    </Text>
                                </Pressable>

                                {canAccessClosure ? (
                                    <Pressable
                                        style={[styles.navBtn, activeSection === 'fermeture' && styles.navBtnActive]}
                                        onPress={async () => {
                                            setActiveSection('fermeture');
                                            setIsSidebarVisible(true);
                                            // Auto-load X snapshot + period tickets
                                            try {
                                                setIsLoadingXReport(true);
                                                setIsLoadingPeriodTickets(true);
                                                const [snapshot, periodTickets] = await Promise.all([
                                                    getCurrentXSnapshot(),
                                                    getCurrentPeriodTickets(),
                                                ]);
                                                setXSnapshot(snapshot);
                                                setClosurePeriodTickets(periodTickets);
                                            } catch {
                                                showToast('Erreur chargement données fermeture.', 'error');
                                            } finally {
                                                setIsLoadingXReport(false);
                                                setIsLoadingPeriodTickets(false);
                                            }
                                        }}
                                    >
                                        <Text style={[styles.navBtnText, activeSection === 'fermeture' && styles.navBtnTextActive]}>
                                            🔒 Fermeture
                                        </Text>
                                    </Pressable>
                                ) : null}

                                {isAdminRole ? (
                                    <Pressable
                                        style={[styles.navBtn, activeSection === 'parametres' && styles.navBtnActive]}
                                        onPress={() => { setActiveSection('parametres'); setIsSidebarVisible(true); }}
                                    >
                                        <Text style={[styles.navBtnText, activeSection === 'parametres' && styles.navBtnTextActive]}>
                                            ⚙️ Paramètres
                                        </Text>
                                    </Pressable>
                                ) : null}
                            </View>
                        </View>

                        <View>
                            {/* ── Indicateur état caisse ── */}
                            <Pressable
                                style={{
                                    backgroundColor: caisseOpenState.isOpen ? COLORS.accentSoft : '#2A1414',
                                    borderRadius: 10,
                                    borderWidth: 1,
                                    borderColor: caisseOpenState.isOpen ? COLORS.accent : COLORS.danger,
                                    padding: 10,
                                    marginBottom: 10,
                                    gap: 2,
                                }}
                                onPress={() => {
                                    if (!caisseOpenState.isOpen) {
                                        setOuvertureModalVisible(true);
                                    }
                                }}
                            >
                                <Text style={{ color: caisseOpenState.isOpen ? COLORS.accent : COLORS.danger, fontWeight: '800', fontSize: 12 }}>
                                    {caisseOpenState.isOpen ? '🟢 Caisse ouverte' : '🔴 Caisse fermée'}
                                </Text>
                                {caisseOpenState.isOpen && caisseOpenState.openedAt ? (
                                    <>
                                        <Text style={{ color: COLORS.muted, fontSize: 10 }}>
                                            Depuis {new Date(caisseOpenState.openedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                        </Text>
                                    </>
                                ) : !caisseOpenState.isOpen ? (
                                    <Text style={{ color: COLORS.muted, fontSize: 10 }}>Appuyer pour ouvrir</Text>
                                ) : null}
                            </Pressable>
                            <Text style={styles.sidebarSession}>Session: {session.username}</Text>
                            <Text style={styles.topBadge}>
                                {session.role === 'admin' ? (session.username === 'admin' ? 'ADMIN' : 'MANAGER') : 'VENDEUR'}
                            </Text>
                            <Pressable style={styles.logoutBtn} onPress={onLogout}>
                                <Text style={styles.logoutText}>Déconnexion</Text>
                            </Pressable>
                        </View>
                    </View>
                ) : null}

                <View style={[styles.rightPanel, activeSection === 'vente' ? { flex: panelRatio } : { display: 'none' }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        {!isSidebarVisible ? (
                            <Pressable style={styles.sidebarCollapsedBtn} onPress={() => setIsSidebarVisible(true)}>
                                <Text style={styles.sidebarCollapsedBtnIcon}>☰</Text>
                            </Pressable>
                        ) : null}
                        <Text style={[styles.panelTitle, { marginBottom: 0, flex: 1 }]}>Commande</Text>
                        <Pressable
                            style={styles.orderTypeToggle}
                            onPress={() => setOrderType(orderType === 'sur_place' ? 'a_emporter' : 'sur_place')}
                            android_ripple={{ color: '#39FF5A22' }}
                        >
                            <Text style={styles.orderTypeToggleText}>
                                {orderType === 'sur_place' ? '🍽️ SP' : '🥡 AE'}
                            </Text>
                        </Pressable>
                        {hasCartItems ? (
                            <Pressable
                                style={[styles.headerIconBtn, kitchenAndServiceSentForCurrentCart ? { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft } : { borderColor: '#FF8C00', backgroundColor: '#2A1800' }]}
                                onPress={() => {
                                    sendCurrentCartToKitchen();
                                }}
                                disabled={isSendingKitchen || kitchenAndServiceSentForCurrentCart}
                                android_ripple={{ color: '#FF8C0033' }}
                            >
                                <Text style={{ fontSize: 20 }}>{kitchenAndServiceSentForCurrentCart ? '✅' : '🍳'}</Text>
                            </Pressable>
                        ) : null}
                        <Pressable
                            style={styles.headerIconBtn}
                            onPress={holdOrder}
                            android_ripple={{ color: '#39FF5A22' }}
                        >
                            <Text style={{ fontSize: 20 }}>⏸️</Text>
                        </Pressable>
                        {hasCartItems ? (
                            <Pressable
                                style={[styles.headerIconBtn, { borderColor: '#FF4444', backgroundColor: '#3A1010' }]}
                                onPress={() => {
                                    Alert.alert('Vider le panier', 'Supprimer tous les articles ?', [
                                        { text: 'Annuler', style: 'cancel' },
                                        {
                                            text: 'Vider',
                                            style: 'destructive',
                                            onPress: () => {
                                                setCart([]);
                                                setKitchenSentForCurrentCart(false);
                                                setServiceSentForCurrentCart(false);
                                                setCurrentOrderTicketNumberValue(null);
                                                resetComposedMenu();
                                                showToast('Panier vidé');
                                            },
                                        },
                                    ]);
                                }}
                                android_ripple={{ color: '#FF444433' }}
                            >
                                <Text style={{ fontSize: 20 }}>🗑️</Text>
                            </Pressable>
                        ) : null}
                    </View>

                    {standbyOrders.length > 0 ? (
                        <Pressable
                            style={styles.pendingOrdersBtn}
                            onPress={() => setStandbyModalVisible(true)}
                        >
                            <View style={styles.pendingOrdersBadge}>
                                <Text style={styles.pendingOrdersBadgeText}>{standbyOrders.length}</Text>
                            </View>
                            <Text style={styles.pendingOrdersBtnText}>
                                ⏸️ {standbyOrders.length} commande{standbyOrders.length > 1 ? 's' : ''} en attente
                            </Text>
                            <Text style={{ color: COLORS.muted, fontSize: 11 }}>Voir ›</Text>
                        </Pressable>
                    ) : null}

                    {kitchenSentForCurrentCart && hasCartItems ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A2A10', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6, borderWidth: 1, borderColor: '#3A5A20' }}>
                            <Text style={{ color: COLORS.accent, fontSize: 12, fontWeight: '700', flex: 1 }}>
                                {settings.serviceTicketEnabled
                                    ? (serviceSentForCurrentCart ? '✅ Envoyée cuisine + salle' : '⚠️ Cuisine OK, salle à réimprimer')
                                    : '✅ Envoyée en cuisine'}
                            </Text>
                        </View>
                    ) : null}

                    <ScrollView
                        style={styles.cartList}
                        contentContainerStyle={[styles.cartListContent, cartColumns === 2 && { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }]}
                        onLayout={(e) => setCartListWidth(e.nativeEvent.layout.width)}
                    >
                        {hasCartItems ? (
                            cart.map((line) => (
                                <View key={line.lineId} style={[styles.cartLine, editingMenuLineId === line.lineId && styles.cartLineEditing, cartColumns === 2 && { width: cartItemWidth, borderBottomWidth: 0, borderWidth: 1, borderColor: '#1F1F1F', borderRadius: 10, padding: 8 }]}>
                                    <View style={styles.cartLineMain}>
                                        <View style={styles.cartLineTitleRow}>
                                            {line.kind === 'menu' ? (
                                                <Pressable style={{ flex: 1 }} onPress={() => editMenuCartItem(line.lineId)}>
                                                    <Text style={[styles.cartLineTitle, { color: COLORS.accent }]}>{line.product.name} ✎</Text>
                                                </Pressable>
                                            ) : (
                                                <Text style={styles.cartLineTitle}>{line.product.name}</Text>
                                            )}
                                            <Pressable
                                                style={styles.noteBtn}
                                                onPress={() => openNoteModal(line.lineId)}
                                                hitSlop={6}
                                            >
                                                <Text style={styles.noteBtnText}>{line.note ? '📝' : '✏️'}</Text>
                                            </Pressable>
                                        </View>
                                        <Text style={styles.cartLineSub}>{lineTotal(line).toFixed(2)}€</Text>
                                        {line.note ? (
                                            <Pressable onPress={() => openNoteModal(line.lineId)}>
                                                <Text style={styles.cartLineNote}>📌 {line.note ?? ''}</Text>
                                            </Pressable>
                                        ) : null}
                                        {line.kind === 'menu' && line.menuItems ? (
                                            <View style={styles.menuSubLines}>
                                                {line.menuItems.map((mi) => (
                                                    <Pressable
                                                        key={`${line.lineId}-${mi.role}-${mi.product.id}`}
                                                        onPress={() => {
                                                            editMenuCartItem(line.lineId);
                                                            // Jump to the stage corresponding to this sub-item
                                                            setTimeout(() => setMenuStage(mi.role as MenuStage), 50);
                                                        }}
                                                    >
                                                        <Text style={styles.menuSubLine}>
                                                            • {mi.product.name} <Text style={{ color: COLORS.accent, fontSize: 10 }}>✎</Text>
                                                        </Text>
                                                    </Pressable>
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

                    {nightSurchargeActive && hasCartItems ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#1C1200', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6, borderWidth: 1.5, borderColor: '#7A5200' }}>
                            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#3D2900', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                                <Text style={{ fontSize: 14 }}>🌙</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: '#FFAA33', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 }}>MAJORATION NUIT</Text>
                                <Text style={{ color: '#CC8800', fontSize: 11, fontWeight: '600', marginTop: 1 }}>
                                    +{settings.nightSurchargePercent}% sur le total  ·  +{surchargeAmount.toFixed(2)}€
                                </Text>
                            </View>
                            <Pressable
                                onPress={() => { setNightSurchargeActive(false); showToast('Majoration nuit désactivée.'); }}
                                style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#3A1515', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#5A2020' }}
                            >
                                <Text style={{ color: '#FF6B6B', fontSize: 13, fontWeight: '800', marginTop: -1 }}>✕</Text>
                            </Pressable>
                        </View>
                    ) : null}

                    {hasCartItems ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.totalStrong}>Total {totalTtc.toFixed(2)}€</Text>
                                {discountPercent > 0 ? (
                                    <Text style={{ color: COLORS.accent, fontSize: 11 }}>-{discountAmount.toFixed(2)}€ ({discountPercent}%)</Text>
                                ) : null}
                                {surchargeAmount > 0 ? (
                                    <Text style={{ color: '#FFAA33', fontSize: 11, fontWeight: '600' }}>dont +{surchargeAmount.toFixed(2)}€ majoration nuit</Text>
                                ) : null}
                            </View>
                            <Pressable
                                style={[styles.primaryBtn, { flex: 1 }, isBusy && styles.primaryBtnDisabled]}
                                onPress={() => {
                                    if (!isBusy) {
                                        if (!ensureCaisseOpen('encaissement')) return;
                                        setPayChoiceOpen(true);
                                        // À l'appui sur Payer, on déclenche cuisine + salle ensemble.
                                        if (cart.length && (!kitchenSentForCurrentCart || !serviceSentForCurrentCart)) {
                                            sendCurrentCartToKitchen(true);
                                        }
                                    }
                                }}
                                disabled={isBusy}
                            >
                                <Text style={styles.primaryBtnText}>{payingMethod ? 'Encaissement…' : '💶 Payer'}</Text>
                            </Pressable>
                        </View>
                    ) : null}
                </View>

                {activeSection === 'vente' ? (
                    <View
                        {...dividerPanResponder.panHandlers}
                        style={{
                            width: DIVIDER_WIDTH,
                            alignSelf: 'stretch',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'col-resize' as any,
                        }}
                    >
                        <View style={{
                            width: 4,
                            height: 48,
                            borderRadius: 2,
                            backgroundColor: '#39FF5A44',
                        }} />
                    </View>
                ) : null}

                <View style={[styles.salesArea, activeSection === 'vente' && { flex: 1 - panelRatio }]}>
                    {activeSection === 'vente' ? (
                        <View style={styles.salesPanel}>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tunnelRowScroll} contentContainerStyle={styles.tunnelRow}>
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
                            </ScrollView>

                            {saleStep === 'menu' ? (
                                <View style={styles.menuFlowContainer}>
                                    {editingMenuLineId ? (
                                        <View style={styles.editingBanner}>
                                            <Text style={styles.editingBannerText}>
                                                ✏️ Clique sur l'élément à changer — un seul tap suffit
                                            </Text>
                                            <Pressable onPress={resetComposedMenu} hitSlop={8}>
                                                <Text style={styles.editingBannerCancel}>✕ Annuler</Text>
                                            </Pressable>
                                        </View>
                                    ) : null}
                                    <View style={styles.menuTypeRow}>
                                        {(Object.keys(MENU_FLOW_LABELS) as MenuFlowType[]).map((flow) => (
                                            <Pressable
                                                key={flow}
                                                style={[styles.menuTypeBtn, menuFlowType === flow && styles.menuTypeBtnActive]}
                                                onPress={() => handleMenuFlowChange(flow)}
                                            >
                                                <Text style={[styles.menuTypeBtnText, menuFlowType === flow && styles.menuTypeBtnTextActive]}>
                                                    {MENU_FLOW_BUTTON_LABELS[flow]}
                                                </Text>
                                            </Pressable>
                                        ))}
                                    </View>

                                    {isEditionLimiteeSimpleMode ? (
                                        <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 8 }}>
                                            Mode simple: un appui ajoute directement l'article au panier.
                                        </Text>
                                    ) : (
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
                                    )}

                                    <FlatList
                                        data={menuGridProducts}
                                        key={`menu-grid-${productGridColumns}`}
                                        keyExtractor={(item) => item.id}
                                        numColumns={productGridColumns}
                                        style={styles.productsList}
                                        contentContainerStyle={styles.productsGrid}
                                        columnWrapperStyle={productGridColumns > 1 ? styles.productsRow : undefined}
                                        renderItem={({ item, index }) => {
                                            const isSelected = !isEditionLimiteeSimpleMode && (
                                                item.id === selectedMenuMainId
                                                || item.id === selectedMenuSideId
                                                || item.id === selectedMenuDrinkId
                                                || item.id === selectedMenuSauceId
                                                || item.id === selectedMenuDessertId
                                                || item.id === selectedMenuToyId
                                            );
                                            const burgerFamilyLabel = getBurgerFamilyLabel(item);
                                            const showFamilySeparator = shouldShowMenuBurgerFamilySeparators
                                                && isBurgerFamilyBreak(menuGridProducts, index);
                                            return (
                                                <View style={[styles.productCardWrap, { width: productCardWidth }]}>
                                                    {showFamilySeparator && burgerFamilyLabel ? (
                                                        <View style={styles.productFamilySection}>
                                                            <View style={styles.productFamilySectionLine} />
                                                            <Text style={styles.productFamilySectionTitle}>{burgerFamilyLabel}</Text>
                                                            <View style={styles.productFamilySectionLine} />
                                                        </View>
                                                    ) : null}
                                                    <Pressable
                                                        style={[styles.productCard, isSelected && styles.productCardSelected]}
                                                        onPress={() => {
                                                            if (isEditionLimiteeSimpleMode) {
                                                                addProductToCart(item);
                                                                return;
                                                            }
                                                            handlePickMenuProduct(item);
                                                        }}
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
                                                        {!isEditionLimiteeSimpleMode && (item.menuSupplement ?? 0) > 0 ? (
                                                            <Text style={styles.productSupplement}>+{item.menuSupplement!.toFixed(2)}€ suppl.</Text>
                                                        ) : null}
                                                    </Pressable>
                                                </View>
                                            );
                                        }}
                                    />
                                </View>
                            ) : (
                                <FlatList
                                    data={filteredProducts}
                                    key={`solo-grid-${productGridColumns}`}
                                    keyExtractor={(item) => item.id}
                                    numColumns={productGridColumns}
                                    style={styles.productsList}
                                    contentContainerStyle={styles.productsGrid}
                                    columnWrapperStyle={productGridColumns > 1 ? styles.productsRow : undefined}
                                    renderItem={({ item, index }) => {
                                        const burgerFamilyLabel = getBurgerFamilyLabel(item);
                                        const showFamilySeparator = shouldShowSoloBurgerFamilySeparators
                                            && isBurgerFamilyBreak(filteredProducts, index);
                                        return (
                                            <View style={[styles.productCardWrap, { width: productCardWidth }]}>
                                                {showFamilySeparator && burgerFamilyLabel ? (
                                                    <View style={styles.productFamilySection}>
                                                        <View style={styles.productFamilySectionLine} />
                                                        <Text style={styles.productFamilySectionTitle}>{burgerFamilyLabel}</Text>
                                                        <View style={styles.productFamilySectionLine} />
                                                    </View>
                                                ) : null}
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
                                            </View>
                                        );
                                    }}
                                />
                            )}
                        </View>
                    ) : null}

                    {activeSection === 'stock' ? (
                        <View style={styles.salesPanel}>
                            {!isSidebarVisible ? (
                                <View style={styles.salesTopRow}>
                                    <Pressable style={styles.sidebarCollapsedBtn} onPress={() => setIsSidebarVisible(true)}>
                                        <Text style={styles.sidebarCollapsedBtnIcon}>☰</Text>
                                        <Text style={styles.sidebarCollapsedBtnText}>Menu</Text>
                                    </Pressable>
                                </View>
                            ) : null}
                            <View style={styles.stockHeader}>
                                <Text style={styles.panelTitle}>Disponibilité produits</Text>
                                {isAdminRole ? (
                                    <Pressable style={styles.stockAddBtn} onPress={() => openProductForm()}>
                                        <Text style={styles.stockAddBtnText}>+ Ajouter</Text>
                                    </Pressable>
                                ) : null}
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
                                    <Pressable
                                        style={[styles.stockCatChip, stockFilter === 'edition_limitee' && styles.stockCatChipActive]}
                                        onPress={() => setStockFilter('edition_limitee')}
                                    >
                                        <Text style={[styles.stockCatChipText, stockFilter === 'edition_limitee' && styles.stockCatChipTextActive]}>
                                            Edition Limitee ({editionLimiteeStockCount})
                                        </Text>
                                    </Pressable>
                                </ScrollView>
                            </View>

                            <ScrollView style={styles.stockList} showsVerticalScrollIndicator>
                                {filteredStockProducts.length ? (
                                    filteredStockProducts.map((item) => (
                                        <View key={item.id} style={styles.stockLine}>
                                            <View style={styles.stockInfoPress}>
                                                <Text numberOfLines={1} style={styles.stockName}>{item.name}</Text>
                                                <Text style={styles.stockMeta}>
                                                    {item.price.toFixed(2)}€ · {CATEGORY_LABELS[item.category]}
                                                    {item.menuPrice ? ` · Menu ${item.menuPrice.toFixed(2)}€` : ''}
                                                </Text>
                                            </View>
                                            <View style={styles.stockActions}>
                                                <Pressable
                                                    style={[styles.stockToggle, item.active ? styles.stockActive : styles.stockInactive]}
                                                    onPress={() => handleToggleStock(item.id, !item.active)}
                                                >
                                                    <Text style={styles.stockToggleText}>{item.active ? 'Actif' : 'Inactif'}</Text>
                                                </Pressable>
                                                {isAdminRole ? (
                                                    <>
                                                        <Pressable style={styles.stockEditBtn} onPress={() => openProductForm(item)}>
                                                            <Text style={styles.stockEditBtnText}>✎</Text>
                                                        </Pressable>
                                                        <Pressable style={styles.stockDeleteBtn} onPress={() => handleDeleteProduct(item)}>
                                                            <Text style={styles.stockDeleteBtnText}>🗑</Text>
                                                        </Pressable>
                                                    </>
                                                ) : null}
                                            </View>
                                        </View>
                                    ))
                                ) : (
                                    <Text style={styles.emptyCartSub}>Aucun produit trouvé.</Text>
                                )}
                            </ScrollView>
                        </View>
                    ) : null}

                    {activeSection === 'tickets' ? (
                        <View style={styles.salesPanel}>
                            {!isSidebarVisible ? (
                                <View style={styles.salesTopRow}>
                                    <Pressable style={styles.sidebarCollapsedBtn} onPress={() => setIsSidebarVisible(true)}>
                                        <Text style={styles.sidebarCollapsedBtnIcon}>☰</Text>
                                        <Text style={styles.sidebarCollapsedBtnText}>Menu</Text>
                                    </Pressable>
                                </View>
                            ) : null}
                            <Text style={styles.panelTitle}>Tickets caisse</Text>
                            <Text style={styles.adminStat}>Tickets imprimés sauvegardés</Text>
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
                                                <Pressable
                                                    style={styles.ticketThumbPaper}
                                                    onPress={() => setFullscreenTicketText(ticket.cashTicketText ?? 'Ticket sans texte enregistré.')}
                                                >
                                                    <Text numberOfLines={5} style={styles.ticketThumbText}>
                                                        {ticket.cashTicketText ?? 'Ticket sans texte enregistré.'}
                                                    </Text>
                                                </Pressable>
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
                                                <Pressable style={styles.ticketPaper} onPress={() => setFullscreenTicketText(selectedTicketPreviewText ?? null)}>
                                                    <Text style={styles.ticketPaperText}>{selectedTicketPreviewText}</Text>
                                                </Pressable>
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
                                                    style={[styles.ticketCorrectionBtn, (!isAdminRole || !canCorrectSelectedTicket) && styles.primaryBtnDisabled]}
                                                    onPress={() => openTicketCorrection('cancel')}
                                                    disabled={!isAdminRole || !canCorrectSelectedTicket}
                                                >
                                                    <Text style={styles.ticketActionBtnText} numberOfLines={2}>Annuler ticket</Text>
                                                </Pressable>
                                                <Pressable
                                                    style={[styles.ticketPaymentEditBtn, (!isAdminRole || !canEditPaymentSelectedTicket) && styles.primaryBtnDisabled]}
                                                    onPress={openPaymentCorrectionModal}
                                                    disabled={!isAdminRole || !canEditPaymentSelectedTicket}
                                                >
                                                    <Text style={styles.ticketActionBtnText} numberOfLines={2}>Modifier encaissement</Text>
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

                    {activeSection === 'fermeture' && canAccessClosure ? (
                        <View style={styles.salesPanel}>
                            {!isSidebarVisible ? (
                                <View style={styles.salesTopRow}>
                                    <Pressable style={styles.sidebarCollapsedBtn} onPress={() => setIsSidebarVisible(true)}>
                                        <Text style={styles.sidebarCollapsedBtnIcon}>☰</Text>
                                        <Text style={styles.sidebarCollapsedBtnText}>Menu</Text>
                                    </Pressable>
                                </View>
                            ) : null}
                            <Text style={styles.panelTitle}>🔒 Fermeture de caisse</Text>
                            <ScrollView showsVerticalScrollIndicator style={{ flex: 1 }}>

                                {/* ══════ État ouverture de caisse ══════ */}
                                <View style={[styles.reportCard, { borderColor: caisseOpenState.isOpen ? COLORS.accent : COLORS.danger, borderWidth: 1 }]}>
                                    <Text style={styles.reportTitle}>{caisseOpenState.isOpen ? '🟢 Caisse ouverte' : '🔴 Caisse fermée'}</Text>
                                    {caisseOpenState.isOpen ? (
                                        <>
                                            <Text style={styles.reportText}>
                                                Ouverte le {caisseOpenState.openedAt ? new Date(caisseOpenState.openedAt).toLocaleString('fr-FR') : '—'}
                                            </Text>
                                            <Text style={styles.reportText}>
                                                Par : {caisseOpenState.openedBy ?? '—'}
                                            </Text>
                                        </>
                                    ) : (
                                        <>
                                            <Text style={styles.reportText}>La caisse n'a pas été ouverte pour cette session.</Text>
                                            <Pressable
                                                style={[styles.primaryBtn, { marginTop: 8 }]}
                                                onPress={() => setOuvertureModalVisible(true)}
                                            >
                                                <Text style={styles.primaryBtnText}>🔓 Ouvrir la caisse</Text>
                                            </Pressable>
                                        </>
                                    )}
                                </View>

                                {/* ══════ Rapport X flash ══════ */}
                                <View style={styles.reportCard}>
                                    <Text style={styles.reportTitle}>📊 Rapport de la période en cours</Text>
                                    {isLoadingXReport ? (
                                        <Text style={styles.reportText}>Chargement…</Text>
                                    ) : xSnapshot ? (
                                        <>
                                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                                                <View style={{ flex: 1 }}>
                                                    <Text style={{ color: COLORS.muted, fontSize: 11 }}>Nombre de tickets</Text>
                                                    <Text style={{ color: COLORS.text, fontSize: 20, fontWeight: '800' }}>{xSnapshot.ordersCount}</Text>
                                                </View>
                                                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                                                    <Text style={{ color: COLORS.muted, fontSize: 11 }}>Chiffre d'affaires TTC</Text>
                                                    <Text style={{ color: COLORS.accent, fontSize: 20, fontWeight: '800' }}>{xSnapshot.revenue.toFixed(2)}€</Text>
                                                </View>
                                            </View>
                                            <Text style={{ color: COLORS.muted, fontSize: 10, marginTop: 6 }}>
                                                Période : {new Date(xSnapshot.periodStart).toLocaleString('fr-FR')} → {new Date(xSnapshot.periodEnd).toLocaleString('fr-FR')}
                                            </Text>
                                            <Text style={{ color: COLORS.muted, fontSize: 10 }}>
                                                Dernier ticket : #{xSnapshot.lastTicketNumber}
                                            </Text>
                                        </>
                                    ) : (
                                        <Text style={styles.reportText}>Aucune donnée. Appuie sur 🔄 pour charger.</Text>
                                    )}
                                    <Pressable
                                        style={[styles.secondaryBtn, { marginTop: 8 }, isLoadingXReport && styles.primaryBtnDisabled]}
                                        onPress={async () => {
                                            setIsLoadingXReport(true);
                                            try {
                                                const [snapshot, periodTickets] = await Promise.all([
                                                    getCurrentXSnapshot(),
                                                    getCurrentPeriodTickets(),
                                                ]);
                                                setXSnapshot(snapshot);
                                                setClosurePeriodTickets(periodTickets);
                                            } catch {
                                                showToast('Erreur chargement rapport.', 'error');
                                            } finally {
                                                setIsLoadingXReport(false);
                                            }
                                        }}
                                        disabled={isLoadingXReport}
                                    >
                                        <Text style={styles.secondaryBtnText}>{isLoadingXReport ? 'Chargement…' : '🔄 Actualiser'}</Text>
                                    </Pressable>
                                </View>

                                {/* ══════ Ventilation par moyen de paiement ══════ */}
                                {xSnapshot && Object.keys(xSnapshot.paymentBreakdown).length > 0 ? (
                                    <View style={styles.reportCard}>
                                        <Text style={styles.reportTitle}>💳 Détail par ticket</Text>
                                        <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                                            {Object.entries(xSnapshot.paymentBreakdown)
                                                .sort(([, a], [, b]) => b - a)
                                                .map(([method, amount]) => (
                                                    <View key={method} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#1F1F1F' }}>
                                                        <Text style={{ color: COLORS.text, fontSize: 13, flex: 1 }}>{formatPaymentMethodLabel(method)}</Text>
                                                        <Text style={{ color: COLORS.accent, fontSize: 13, fontWeight: '700' }}>{amount.toFixed(2)}€</Text>
                                                    </View>
                                                ))}
                                        </ScrollView>
                                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, marginTop: 4 }}>
                                            <Text style={{ color: COLORS.text, fontSize: 14, fontWeight: '800' }}>TOTAL</Text>
                                            <Text style={{ color: COLORS.accent, fontSize: 14, fontWeight: '800' }}>{xSnapshot.revenue.toFixed(2)}€</Text>
                                        </View>
                                    </View>
                                ) : null}

                                {/* ══════ Totaux agrégés par moyen de paiement ══════ */}
                                {xSnapshot && Object.keys(xSnapshot.paymentBreakdown).length > 0 ? (() => {
                                    const agg: Record<string, number> = {};
                                    for (const [rawKey, totalAmount] of Object.entries(xSnapshot.paymentBreakdown)) {
                                        const parts = rawKey.split(' / ');
                                        if (parts.length > 1) {
                                            for (const part of parts) {
                                                const match = part.match(/^(.+?)\s+([\d.,]+)\s*€?$/);
                                                if (match) {
                                                    const m = match[1].trim();
                                                    const a = parseFloat(match[2].replace(',', '.')) || 0;
                                                    agg[m] = Number(((agg[m] ?? 0) + a).toFixed(2));
                                                }
                                            }
                                        } else {
                                            const m = formatPaymentMethodLabel(rawKey);
                                            agg[m] = Number(((agg[m] ?? 0) + totalAmount).toFixed(2));
                                        }
                                    }
                                    const entries = Object.entries(agg).sort(([, a], [, b]) => b - a);
                                    if (entries.length === 0) return null;
                                    return (
                                        <View style={styles.reportCard}>
                                            <Text style={styles.reportTitle}>📊 Total par moyen de paiement</Text>
                                            {entries.map(([method, amount]) => (
                                                <View key={method} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#1F1F1F' }}>
                                                    <Text style={{ color: COLORS.text, fontSize: 14, fontWeight: '600' }}>{method}</Text>
                                                    <Text style={{ color: COLORS.accent, fontSize: 14, fontWeight: '800' }}>{amount.toFixed(2)}€</Text>
                                                </View>
                                            ))}
                                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, marginTop: 4, backgroundColor: COLORS.accentSoft, borderRadius: 8, paddingHorizontal: 10 }}>
                                                <Text style={{ color: COLORS.accent, fontSize: 15, fontWeight: '900' }}>TOTAL</Text>
                                                <Text style={{ color: COLORS.accent, fontSize: 15, fontWeight: '900' }}>{xSnapshot.revenue.toFixed(2)}€</Text>
                                            </View>
                                        </View>
                                    );
                                })() : null}

                                {/* ══════ Liste des tickets de la période ══════ */}
                                <View style={styles.reportCard}>
                                    <Text style={styles.reportTitle}>🧾 Tickets de la période ({closurePeriodTickets.length})</Text>
                                    {isLoadingPeriodTickets ? (
                                        <Text style={styles.reportText}>Chargement…</Text>
                                    ) : closurePeriodTickets.length > 0 ? (
                                        <ScrollView style={{ maxHeight: 300, marginTop: 6 }} nestedScrollEnabled>
                                            {closurePeriodTickets.map((ticket) => (
                                                <View key={ticket.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#1F1F1F' }}>
                                                    <View style={{ flex: 1 }}>
                                                        <Text style={{ color: COLORS.text, fontSize: 12, fontWeight: '600' }}>
                                                            #{ticket.ticketNumber} · {ticket.orderStatus === 'cancel' ? '❌ ANNULÉ' : ticket.isCopy ? '📋 COPIE' : '✅ VENTE'}
                                                        </Text>
                                                        <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                                                            {new Date(ticket.createdAt).toLocaleString('fr-FR')} · {formatPaymentMethodLabel(ticket.paymentMethod)}
                                                        </Text>
                                                    </View>
                                                    <Text style={{ color: ticket.orderStatus === 'cancel' ? COLORS.danger : COLORS.accent, fontSize: 13, fontWeight: '700' }}>
                                                        {ticket.orderStatus === 'cancel' ? '-' : ''}{ticket.total.toFixed(2)}€
                                                    </Text>
                                                </View>
                                            ))}
                                        </ScrollView>
                                    ) : (
                                        <Text style={styles.reportText}>Aucun ticket sur cette période.</Text>
                                    )}
                                </View>

                                {/* ══════ Preview du ticket Z ══════ */}
                                <View style={styles.reportCard}>
                                    <Text style={styles.reportTitle}>🖨️ Aperçu du rapport Z</Text>
                                    {xSnapshot && zReportPreviewText ? (
                                        <>
                                            <ScrollView style={{ maxHeight: 320, marginTop: 6 }} nestedScrollEnabled>
                                                <Pressable
                                                    style={[styles.ticketPaper, { width: '100%', maxWidth: THERMAL_RECEIPT_WIDTH }]}
                                                    onPress={() => setFullscreenTicketText(zReportPreviewText)}
                                                >
                                                    <Text style={styles.ticketPaperText}>{zReportPreviewText}</Text>
                                                </Pressable>
                                            </ScrollView>
                                        </>
                                    ) : (
                                        <Text style={styles.reportText}>Chargez le rapport pour voir l'aperçu.</Text>
                                    )}
                                </View>

                                {/* ══════ Actions de fermeture ══════ */}
                                <View style={[styles.reportCard, { borderColor: COLORS.accent }]}>
                                    <Text style={[styles.reportTitle, { color: COLORS.accent }]}>⚡ Actions de clôture</Text>
                                    <Pressable
                                        style={[styles.primaryBtn, { marginTop: 8 }, isClosingZReport && styles.primaryBtnDisabled]}
                                        onPress={handleCloseZReport}
                                        disabled={isClosingZReport}
                                    >
                                        <Text style={styles.primaryBtnText}>
                                            {isClosingZReport ? 'Clôture en cours…' : '🔒 Clôturer la période Z + Imprimer'}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        style={[styles.secondaryBtn, { marginTop: 8 }, (isPrintingZTicketPreview || isClosingZReport) && styles.primaryBtnDisabled]}
                                        onPress={handlePrintZTicketPreview}
                                        disabled={isPrintingZTicketPreview || isClosingZReport}
                                    >
                                        <Text style={styles.secondaryBtnText}>
                                            {isPrintingZTicketPreview ? 'Impression…' : '🖨️ Imprimer le ticket de clôture (sans clôturer)'}
                                        </Text>
                                    </Pressable>
                                    <Text style={{ color: COLORS.muted, fontSize: 10, marginTop: 4, textAlign: 'center' }}>
                                        Cette action ferme la période, imprime le rapport Z et lance un audit d'intégrité.
                                    </Text>
                                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                                        <Pressable
                                            style={[styles.secondaryBtn, { flex: 1 }, isExportingCsv && styles.primaryBtnDisabled]}
                                            onPress={async () => {
                                                setIsExportingCsv(true);
                                                try {
                                                    const { csv, rowsCount } = await buildCurrentPeriodCsv();
                                                    const baseDir = `${FileSystem.documentDirectory ?? ''}exports`;
                                                    await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
                                                    const safeDate = sanitizeFilePart(new Date().toISOString());
                                                    const filePath = `${baseDir}/tickets_${safeDate}.csv`;
                                                    await FileSystem.writeAsStringAsync(filePath, csv, { encoding: FileSystem.EncodingType.UTF8 });
                                                    if (await Sharing.isAvailableAsync()) {
                                                        await Sharing.shareAsync(filePath, { mimeType: 'text/csv', dialogTitle: 'Exporter CSV tickets' });
                                                    }
                                                    showToast(`CSV exporté (${rowsCount} lignes) ✓`);
                                                } catch {
                                                    showToast('Erreur export CSV.', 'error');
                                                } finally {
                                                    setIsExportingCsv(false);
                                                }
                                            }}
                                            disabled={isExportingCsv}
                                        >
                                            <Text style={styles.secondaryBtnText}>{isExportingCsv ? 'Export…' : '📄 Export CSV'}</Text>
                                        </Pressable>
                                        <Pressable
                                            style={[styles.secondaryBtn, { flex: 1 }, isRunningAudit && styles.primaryBtnDisabled]}
                                            onPress={async () => {
                                                setIsRunningAudit(true);
                                                try {
                                                    const report = await runIntegrityAudit();
                                                    setAuditReport(report);
                                                    showToast(`Audit OK : ${report.issues.length} problème(s).`);
                                                } catch {
                                                    showToast('Erreur audit.', 'error');
                                                } finally {
                                                    setIsRunningAudit(false);
                                                }
                                            }}
                                            disabled={isRunningAudit}
                                        >
                                            <Text style={styles.secondaryBtnText}>{isRunningAudit ? 'Audit…' : '🔍 Audit intégrité'}</Text>
                                        </Pressable>
                                    </View>
                                </View>

                                {/* ══════ Historique des clôtures Z ══════ */}
                                <View style={styles.reportCard}>
                                    <Text style={styles.reportTitle}>📚 Historique des clôtures Z</Text>
                                    {zClosures.length > 0 ? (
                                        <ScrollView style={{ maxHeight: 300, marginTop: 8 }} nestedScrollEnabled>
                                            {zClosures.map((closure) => (
                                                <View key={closure.id} style={styles.closureRow}>
                                                    <Pressable
                                                        style={styles.closurePreviewPress}
                                                        onPress={() => setFullscreenTicketText(buildClosurePreviewText(closure))}
                                                        android_ripple={{ color: '#39FF5A33' }}
                                                    >
                                                        <Text style={styles.closureRowTitle}>
                                                            Z #{closure.id} — {closure.ordersCount} tickets — {closure.revenue.toFixed(2)}€
                                                        </Text>
                                                        <Text style={styles.closureRowText}>
                                                            Fermée le {new Date(closure.closedAt).toLocaleString('fr-FR')} par {closure.closedBy}
                                                        </Text>
                                                        <Text style={styles.closureRowHash}>
                                                            Hash: {closure.signatureHash.slice(0, 16)}…
                                                        </Text>
                                                        <Text style={{ color: COLORS.accent, fontSize: 10, marginTop: 2 }}>Appuyer pour voir le ticket ›</Text>
                                                    </Pressable>
                                                    <Pressable
                                                        style={[
                                                            styles.secondaryBtn,
                                                            styles.closurePrintBtn,
                                                            (isClosingZReport || isPrintingClosedFlashId === closure.id) && styles.primaryBtnDisabled,
                                                        ]}
                                                        onPress={() => void handlePrintClosedFlashTicket(closure)}
                                                        disabled={isClosingZReport || isPrintingClosedFlashId === closure.id}
                                                    >
                                                        <Text style={styles.secondaryBtnText}>
                                                            {isPrintingClosedFlashId === closure.id ? 'Impression…' : '🖨️ Imprimer le flash'}
                                                        </Text>
                                                    </Pressable>
                                                </View>
                                            ))}
                                        </ScrollView>
                                    ) : (
                                        <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 8 }}>Aucune clôture enregistrée.</Text>
                                    )}
                                </View>

                                {/* ══════ Résultat audit ══════ */}
                                {auditReport ? (
                                    <View style={styles.reportCard}>
                                        <Text style={styles.reportTitle}>🔍 Résultat audit d'intégrité</Text>
                                        <Text style={styles.reportText}>Tickets vérifiés: {auditReport.ordersChecked}</Text>
                                        <Text style={styles.reportText}>Clôtures vérifiées: {auditReport.closuresChecked}</Text>
                                        <Text style={styles.reportText}>Séquence stricte: {auditReport.strictSequenceOk ? '✅' : '❌'}</Text>
                                        <Text style={styles.reportText}>Chaînage tickets: {auditReport.orderChainOk ? '✅' : '❌'}</Text>
                                        <Text style={styles.reportText}>Chaînage clôtures: {auditReport.closureChainOk ? '✅' : '❌'}</Text>
                                        {auditReport.issues.length > 0 ? (
                                            <View style={styles.auditIssuesBox}>
                                                {auditReport.issues.slice(0, 10).map((issue, idx) => (
                                                    <Text key={idx} style={styles.auditIssueText}>
                                                        [{issue.scope}#{issue.id}] {issue.message}
                                                    </Text>
                                                ))}
                                                {auditReport.issues.length > 10 ? (
                                                    <Text style={styles.auditIssueText}>… +{auditReport.issues.length - 10} autres</Text>
                                                ) : null}
                                            </View>
                                        ) : (
                                            <Text style={{ color: COLORS.accent, fontSize: 12, marginTop: 4 }}>✅ Aucun problème détecté</Text>
                                        )}
                                    </View>
                                ) : null}

                                <View style={{ height: 30 }} />
                            </ScrollView>
                        </View>
                    ) : null}

                    {activeSection === 'parametres' && session.role === 'admin' ? (
                        <View style={styles.salesPanel}>
                            <ScrollView
                                style={{ flex: 1 }}
                                contentContainerStyle={{ paddingBottom: 24 }}
                                showsVerticalScrollIndicator
                                keyboardShouldPersistTaps="handled"
                                keyboardDismissMode="on-drag"
                            >
                            {!isSidebarVisible ? (
                                <View style={styles.salesTopRow}>
                                    <Pressable style={styles.sidebarCollapsedBtn} onPress={() => setIsSidebarVisible(true)}>
                                        <Text style={styles.sidebarCollapsedBtnIcon}>☰</Text>
                                        <Text style={styles.sidebarCollapsedBtnText}>Menu</Text>
                                    </Pressable>
                                </View>
                            ) : null}
                            <Text style={styles.panelTitle}>Paramètres admin</Text>
                            <Text style={styles.adminStat}>Commandes du jour: {stats.ordersCount}</Text>
                            <Text style={[styles.adminStat, { marginBottom: 12 }]}>CA du jour: {stats.revenue.toFixed(2)}€</Text>

                            <Text style={{ color: COLORS.muted, fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                                Mode impression
                            </Text>
                            <View style={[styles.reportActionsRow, { marginTop: 0 }]}>
                                <Pressable
                                    style={[
                                        styles.secondaryBtn,
                                        settings.printMode === 'network_dual' && { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
                                    ]}
                                    onPress={() => setSettings((prev) => ({ ...prev, printMode: 'network_dual' }))}
                                >
                                    <Text style={[styles.secondaryBtnText, settings.printMode === 'network_dual' && { color: '#000', fontWeight: '800' }]}>
                                        Réseau (2 imprimantes)
                                    </Text>
                                </Pressable>
                                <Pressable
                                    style={[
                                        styles.secondaryBtn,
                                        settings.printMode === 'usb_single' && { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
                                    ]}
                                    onPress={() => setSettings((prev) => ({ ...prev, printMode: 'usb_single' }))}
                                >
                                    <Text style={[styles.secondaryBtnText, settings.printMode === 'usb_single' && { color: '#000', fontWeight: '800' }]}>
                                        USB (1 imprimante)
                                    </Text>
                                </Pressable>
                            </View>

                            {settings.printMode === 'network_dual' ? (
                                <>
                                    <TextInput
                                        style={[styles.input, { marginBottom: 10 }]}
                                        value={settings.cashPrinterUrl}
                                        onChangeText={(value) => setSettings((prev) => ({ ...prev, cashPrinterUrl: value }))}
                                        placeholder="URL imprimante caisse (ex: http://192.168.1.50)"
                                        placeholderTextColor={COLORS.muted}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        keyboardType="url"
                                    />
                                    <TextInput
                                        style={styles.input}
                                        value={settings.kitchenPrinterUrl}
                                        onChangeText={(value) => setSettings((prev) => ({ ...prev, kitchenPrinterUrl: value }))}
                                        placeholder="URL imprimante cuisine (ex: http://192.168.1.51)"
                                        placeholderTextColor={COLORS.muted}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        keyboardType="url"
                                    />

                                    <View style={[styles.reportActionsRow, { marginTop: 10 }]}>
                                        <Pressable
                                            style={[styles.secondaryBtn, { flex: 1, backgroundColor: '#1A1A2E', borderColor: '#2A2A4A', borderWidth: 1 }, isScanningPrinters && styles.primaryBtnDisabled]}
                                            onPress={handleScanPrinters}
                                            disabled={isScanningPrinters}
                                        >
                                            <Text style={styles.secondaryBtnText}>{isScanningPrinters ? 'Scan réseau…' : 'Scanner le réseau'}</Text>
                                        </Pressable>
                                    </View>
                                    {discoveredPrinters.length > 0 ? (
                                        <View style={{ marginTop: 8, gap: 6 }}>
                                            <Text style={{ color: COLORS.muted, fontSize: 11, marginBottom: 2 }}>Imprimantes détectées :</Text>
                                            {discoveredPrinters.map((printer) => (
                                                <View key={printer.ip} style={{ flexDirection: 'row', gap: 6 }}>
                                                    <Pressable
                                                        style={{ flex: 1, backgroundColor: '#0D1F0D', borderRadius: 8, borderWidth: 1, borderColor: '#1A3A1A', paddingVertical: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                                                        onPress={() => {
                                                            setSettings((prev) => ({ ...prev, cashPrinterUrl: printer.url }));
                                                            showToast(`${printer.ip} → Caisse`);
                                                        }}
                                                    >
                                                        <Text style={{ color: COLORS.accent, fontSize: 13, fontWeight: '700' }}>{printer.ip}</Text>
                                                        <Text style={{ color: COLORS.muted, fontSize: 11 }}>→ Caisse</Text>
                                                    </Pressable>
                                                    <Pressable
                                                        style={{ backgroundColor: '#1F1A0D', borderRadius: 8, borderWidth: 1, borderColor: '#3A2A1A', paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }}
                                                        onPress={() => {
                                                            setSettings((prev) => ({ ...prev, kitchenPrinterUrl: printer.url }));
                                                            showToast(`${printer.ip} → Cuisine`);
                                                        }}
                                                    >
                                                        <Text style={{ color: '#FFAA33', fontSize: 11 }}>→ Cuisine</Text>
                                                    </Pressable>
                                                </View>
                                            ))}
                                        </View>
                                    ) : null}
                                </>
                            ) : (
                                <>
                                    <View style={{ marginTop: 8, backgroundColor: '#0E0E0E', borderRadius: 8, borderWidth: 1, borderColor: '#1F1F1F', padding: 10 }}>
                                        <Text style={{ color: COLORS.text, fontSize: 12, fontWeight: '700' }}>Mode USB direct</Text>
                                        <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 4 }}>
                                            Tous les tickets (caisse + cuisine) partent sur la meme imprimante USB.
                                        </Text>
                                        <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 6 }}>
                                            {isUsbPrinterSupported()
                                                ? `Selection: ${settings.usbPrinterName || 'aucune'}`
                                                : 'USB indisponible dans Expo Go (utiliser build natif).'}
                                        </Text>
                                    </View>
                                    <View style={[styles.reportActionsRow, { marginTop: 10 }]}>
                                        <Pressable
                                            style={[styles.secondaryBtn, isScanningUsbPrinters && styles.primaryBtnDisabled]}
                                            onPress={handleScanUsbPrinters}
                                            disabled={isScanningUsbPrinters || !isUsbPrinterSupported()}
                                        >
                                            <Text style={styles.secondaryBtnText}>{isScanningUsbPrinters ? 'Scan USB…' : 'Scanner USB'}</Text>
                                        </Pressable>
                                    </View>
                                    {usbPrinters.length > 0 ? (
                                        <View style={{ marginTop: 8, gap: 6 }}>
                                            <Text style={{ color: COLORS.muted, fontSize: 11, marginBottom: 2 }}>Imprimantes USB détectées :</Text>
                                            {usbPrinters.map((device) => {
                                                const label = [device.manufacturerName, device.productName]
                                                    .filter(Boolean)
                                                    .join(' ')
                                                    .trim() || `USB #${device.deviceId}`;
                                                const isSelected = settings.usbPrinterId === String(device.deviceId);
                                                return (
                                                    <Pressable
                                                        key={device.deviceId}
                                                        style={{
                                                            backgroundColor: isSelected ? '#0D1F0D' : '#111',
                                                            borderRadius: 8,
                                                            borderWidth: 1,
                                                            borderColor: isSelected ? '#2A5A2A' : '#252525',
                                                            paddingVertical: 10,
                                                            paddingHorizontal: 12,
                                                        }}
                                                        onPress={() => void handleSelectUsbPrinter(device)}
                                                        disabled={isAuthorizingUsbPrinter}
                                                    >
                                                        <Text style={{ color: isSelected ? COLORS.accent : COLORS.text, fontSize: 12, fontWeight: '700' }}>{label}</Text>
                                                        <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                                                            id:{device.deviceId} · vendor:{device.vendorId} · product:{device.productId}
                                                        </Text>
                                                    </Pressable>
                                                );
                                            })}
                                        </View>
                                    ) : null}
                                </>
                            )}

                            <View style={{ marginTop: 8, backgroundColor: '#0E0E0E', borderRadius: 8, borderWidth: 1, borderColor: '#1F1F1F', padding: 10 }}>
                                <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                                    File impression: {printQueueSummary.pending} en attente · {printQueueSummary.failed} en erreur
                                </Text>
                            </View>

                            {/* ── Toggle ticket de salle ── */}
                            <Pressable
                                style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, backgroundColor: COLORS.cardSoft, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: settings.serviceTicketEnabled ? '#1A3A1A' : '#1F1F1F' }}
                                onPress={() => setSettings((prev) => ({ ...prev, serviceTicketEnabled: !prev.serviceTicketEnabled }))}
                            >
                                <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: settings.serviceTicketEnabled ? COLORS.accent : '#333', justifyContent: 'center', paddingHorizontal: 2 }}>
                                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: settings.serviceTicketEnabled ? 'flex-end' : 'flex-start' }} />
                                </View>
                                <Text style={{ color: COLORS.text, fontSize: 13, fontWeight: '600', marginLeft: 10 }}>Ticket de salle (serveur)</Text>
                                <Text style={{ color: COLORS.muted, fontSize: 11, marginLeft: 'auto' }}>{settings.serviceTicketEnabled ? 'Activé' : 'Désactivé'}</Text>
                            </Pressable>

                            {/* ── Toggle tiroir-caisse physique ── */}
                            <Pressable
                                style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, backgroundColor: COLORS.cardSoft, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: settings.cashDrawerEnabled ? '#1A3A1A' : '#1F1F1F' }}
                                onPress={() => setSettings((prev) => ({ ...prev, cashDrawerEnabled: !prev.cashDrawerEnabled }))}
                            >
                                <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: settings.cashDrawerEnabled ? COLORS.accent : '#333', justifyContent: 'center', paddingHorizontal: 2 }}>
                                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: settings.cashDrawerEnabled ? 'flex-end' : 'flex-start' }} />
                                </View>
                                <Text style={{ color: COLORS.text, fontSize: 13, fontWeight: '600', marginLeft: 10 }}>Tiroir-caisse physique</Text>
                                <Text style={{ color: COLORS.muted, fontSize: 11, marginLeft: 'auto' }}>{settings.cashDrawerEnabled ? 'Utilisé' : 'Non utilisé'}</Text>
                            </Pressable>

                            <View style={styles.reportActionsRow}>
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

                            <View style={styles.reportActionsRow}>
                                <Pressable
                                    style={[
                                        styles.secondaryBtn,
                                        !settings.cashDrawerEnabled && styles.primaryBtnDisabled,
                                        isTestingCashDrawer && styles.primaryBtnDisabled,
                                    ]}
                                    onPress={handleTestCashDrawer}
                                    disabled={isTestingCashDrawer || !settings.cashDrawerEnabled}
                                >
                                    <Text style={styles.secondaryBtnText}>{isTestingCashDrawer ? 'Test tiroir…' : 'Tester ouverture tiroir'}</Text>
                                </Pressable>
                            </View>
                            {cashDrawerTestStatus ? (
                                <View style={{ marginTop: 8, backgroundColor: '#0E0E0E', borderRadius: 8, borderWidth: 1, borderColor: '#1F1F1F', padding: 10, gap: 4 }}>
                                    <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                                        Dernier test tiroir: {cashDrawerTestStatus.testedAt}
                                    </Text>
                                    <Text style={{ color: cashDrawerTestStatus.commandOk ? COLORS.accent : COLORS.danger, fontSize: 12, fontWeight: '700' }}>
                                        Commande ouverture: {cashDrawerTestStatus.commandOk ? 'OK' : 'KO'}
                                    </Text>
                                    <Text style={{ color: COLORS.text, fontSize: 12 }}>
                                        Ouverture constatée: {cashDrawerTestStatus.operatorConfirmedOpen === null ? 'Non confirmée' : cashDrawerTestStatus.operatorConfirmedOpen ? 'Oui' : 'Non'}
                                    </Text>
                                    <Text style={{ color: COLORS.muted, fontSize: 11 }}>{cashDrawerTestStatus.message}</Text>
                                </View>
                            ) : null}

                            <View style={[styles.payRow, { marginTop: 14 }]}>
                                <Pressable style={[styles.secondaryBtn, { backgroundColor: COLORS.accent }]} onPress={handleSaveSettings}>
                                    <Text style={[styles.secondaryBtnText, { color: '#000', fontWeight: '800' }]}>💾 Sauvegarder imprimantes</Text>
                                </Pressable>
                            </View>
                            <View style={[styles.reportActionsRow, { marginTop: 10 }]}>
                                <Pressable
                                    style={styles.secondaryBtn}
                                    onPress={async () => {
                                        await refreshPrintQueueState();
                                        await processPrintQueue({ silent: false, limit: 20 });
                                    }}
                                >
                                    <Text style={styles.secondaryBtnText}>↻ Relancer file impression</Text>
                                </Pressable>
                            </View>

                            <View style={[styles.reportCard, { marginTop: 12 }]}>
                                <Text style={styles.reportTitle}>🧾 Personnalisation ticket</Text>
                                <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 4 }}>
                                    Mode actif: {settings.printMode === 'usb_single' ? 'USB (1 imprimante)' : 'Réseau (2 imprimantes)'}.
                                </Text>
                                <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                                    En mode USB, caisse/cuisine/salle partent vers la meme imprimante.
                                </Text>

                                <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                                    En-tete
                                </Text>
                                <TextInput
                                    style={[styles.input, { marginBottom: 8 }]}
                                    value={settings.ticketCustomization.businessName}
                                    onChangeText={(value) => updateTicketCustomization({ businessName: value })}
                                    placeholder="Nom enseigne"
                                    placeholderTextColor={COLORS.muted}
                                    maxLength={120}
                                />
                                <TextInput
                                    style={[styles.input, { marginBottom: 8 }]}
                                    value={settings.ticketCustomization.businessAddress}
                                    onChangeText={(value) => updateTicketCustomization({ businessAddress: value })}
                                    placeholder="Adresse"
                                    placeholderTextColor={COLORS.muted}
                                    maxLength={120}
                                />
                                <TextInput
                                    style={[styles.input, { marginBottom: 8 }]}
                                    value={settings.ticketCustomization.businessSiret}
                                    onChangeText={(value) => updateTicketCustomization({ businessSiret: value })}
                                    placeholder="SIRET"
                                    placeholderTextColor={COLORS.muted}
                                    maxLength={120}
                                />
                                <TextInput
                                    style={[styles.input, { marginBottom: 8 }]}
                                    value={settings.ticketCustomization.businessTvaIntra}
                                    onChangeText={(value) => updateTicketCustomization({ businessTvaIntra: value })}
                                    placeholder="TVA intracom"
                                    placeholderTextColor={COLORS.muted}
                                    maxLength={120}
                                />
                                <TextInput
                                    style={[styles.input, { marginBottom: 8 }]}
                                    value={settings.ticketCustomization.businessPhone}
                                    onChangeText={(value) => updateTicketCustomization({ businessPhone: value })}
                                    placeholder="Téléphone"
                                    placeholderTextColor={COLORS.muted}
                                    maxLength={120}
                                />

                                <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 8, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                                    Pied de ticket
                                </Text>
                                <TextInput
                                    style={[styles.input, { marginBottom: 8 }]}
                                    value={settings.ticketCustomization.footerLine1}
                                    onChangeText={(value) => updateTicketCustomization({ footerLine1: value })}
                                    placeholder="Ligne 1 (ex: Bon appetit !)"
                                    placeholderTextColor={COLORS.muted}
                                    maxLength={120}
                                />
                                <TextInput
                                    style={styles.input}
                                    value={settings.ticketCustomization.footerLine2}
                                    onChangeText={(value) => updateTicketCustomization({ footerLine2: value })}
                                    placeholder="Ligne 2 (ex: Merci de votre visite !)"
                                    placeholderTextColor={COLORS.muted}
                                    maxLength={120}
                                />

                                <Pressable
                                    style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, backgroundColor: COLORS.cardSoft, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: settings.ticketCustomization.showLogo ? '#1A3A1A' : '#1F1F1F' }}
                                    onPress={() => toggleTicketCustomizationFlag('showLogo')}
                                >
                                    <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: settings.ticketCustomization.showLogo ? COLORS.accent : '#333', justifyContent: 'center', paddingHorizontal: 2 }}>
                                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: settings.ticketCustomization.showLogo ? 'flex-end' : 'flex-start' }} />
                                    </View>
                                    <Text style={{ color: COLORS.text, fontSize: 13, fontWeight: '600', marginLeft: 10 }}>Afficher logo</Text>
                                    <Text style={{ color: COLORS.muted, fontSize: 11, marginLeft: 'auto' }}>{settings.ticketCustomization.showLogo ? 'Oui' : 'Non'}</Text>
                                </Pressable>

                                <Pressable
                                    style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: COLORS.cardSoft, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: settings.ticketCustomization.headerBold ? '#1A3A1A' : '#1F1F1F' }}
                                    onPress={() => toggleTicketCustomizationFlag('headerBold')}
                                >
                                    <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: settings.ticketCustomization.headerBold ? COLORS.accent : '#333', justifyContent: 'center', paddingHorizontal: 2 }}>
                                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: settings.ticketCustomization.headerBold ? 'flex-end' : 'flex-start' }} />
                                    </View>
                                    <Text style={{ color: COLORS.text, fontSize: 13, fontWeight: '600', marginLeft: 10 }}>En-tête en gras</Text>
                                    <Text style={{ color: COLORS.muted, fontSize: 11, marginLeft: 'auto' }}>{settings.ticketCustomization.headerBold ? 'Oui' : 'Non'}</Text>
                                </Pressable>

                                <Pressable
                                    style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: COLORS.cardSoft, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: settings.ticketCustomization.footerBold ? '#1A3A1A' : '#1F1F1F' }}
                                    onPress={() => toggleTicketCustomizationFlag('footerBold')}
                                >
                                    <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: settings.ticketCustomization.footerBold ? COLORS.accent : '#333', justifyContent: 'center', paddingHorizontal: 2 }}>
                                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: settings.ticketCustomization.footerBold ? 'flex-end' : 'flex-start' }} />
                                    </View>
                                    <Text style={{ color: COLORS.text, fontSize: 13, fontWeight: '600', marginLeft: 10 }}>Pied de ticket en gras</Text>
                                    <Text style={{ color: COLORS.muted, fontSize: 11, marginLeft: 'auto' }}>{settings.ticketCustomization.footerBold ? 'Oui' : 'Non'}</Text>
                                </Pressable>

                                <Pressable
                                    style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: COLORS.cardSoft, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: settings.ticketCustomization.showSeller ? '#1A3A1A' : '#1F1F1F' }}
                                    onPress={() => toggleTicketCustomizationFlag('showSeller')}
                                >
                                    <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: settings.ticketCustomization.showSeller ? COLORS.accent : '#333', justifyContent: 'center', paddingHorizontal: 2 }}>
                                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: settings.ticketCustomization.showSeller ? 'flex-end' : 'flex-start' }} />
                                    </View>
                                    <Text style={{ color: COLORS.text, fontSize: 13, fontWeight: '600', marginLeft: 10 }}>Afficher vendeur</Text>
                                    <Text style={{ color: COLORS.muted, fontSize: 11, marginLeft: 'auto' }}>{settings.ticketCustomization.showSeller ? 'Oui' : 'Non'}</Text>
                                </Pressable>

                                <Pressable
                                    style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: COLORS.cardSoft, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: settings.ticketCustomization.showTable ? '#1A3A1A' : '#1F1F1F' }}
                                    onPress={() => toggleTicketCustomizationFlag('showTable')}
                                >
                                    <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: settings.ticketCustomization.showTable ? COLORS.accent : '#333', justifyContent: 'center', paddingHorizontal: 2 }}>
                                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: settings.ticketCustomization.showTable ? 'flex-end' : 'flex-start' }} />
                                    </View>
                                    <Text style={{ color: COLORS.text, fontSize: 13, fontWeight: '600', marginLeft: 10 }}>Afficher table</Text>
                                    <Text style={{ color: COLORS.muted, fontSize: 11, marginLeft: 'auto' }}>{settings.ticketCustomization.showTable ? 'Oui' : 'Non'}</Text>
                                </Pressable>

                                <Pressable
                                    style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: COLORS.cardSoft, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: settings.ticketCustomization.showPaymentLine ? '#1A3A1A' : '#1F1F1F' }}
                                    onPress={() => toggleTicketCustomizationFlag('showPaymentLine')}
                                >
                                    <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: settings.ticketCustomization.showPaymentLine ? COLORS.accent : '#333', justifyContent: 'center', paddingHorizontal: 2 }}>
                                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: settings.ticketCustomization.showPaymentLine ? 'flex-end' : 'flex-start' }} />
                                    </View>
                                    <Text style={{ color: COLORS.text, fontSize: 13, fontWeight: '600', marginLeft: 10 }}>Afficher mode de paiement</Text>
                                    <Text style={{ color: COLORS.muted, fontSize: 11, marginLeft: 'auto' }}>{settings.ticketCustomization.showPaymentLine ? 'Oui' : 'Non'}</Text>
                                </Pressable>

                                <Pressable
                                    style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: COLORS.cardSoft, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: settings.ticketCustomization.showTaxTable ? '#1A3A1A' : '#1F1F1F' }}
                                    onPress={() => toggleTicketCustomizationFlag('showTaxTable')}
                                >
                                    <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: settings.ticketCustomization.showTaxTable ? COLORS.accent : '#333', justifyContent: 'center', paddingHorizontal: 2 }}>
                                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: settings.ticketCustomization.showTaxTable ? 'flex-end' : 'flex-start' }} />
                                    </View>
                                    <Text style={{ color: COLORS.text, fontSize: 13, fontWeight: '600', marginLeft: 10 }}>Afficher tableau TVA</Text>
                                    <Text style={{ color: COLORS.muted, fontSize: 11, marginLeft: 'auto' }}>{settings.ticketCustomization.showTaxTable ? 'Oui' : 'Non'}</Text>
                                </Pressable>

                                <Pressable
                                    style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: COLORS.cardSoft, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: settings.ticketCustomization.compactMode ? '#1A3A1A' : '#1F1F1F' }}
                                    onPress={() => toggleTicketCustomizationFlag('compactMode')}
                                >
                                    <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: settings.ticketCustomization.compactMode ? COLORS.accent : '#333', justifyContent: 'center', paddingHorizontal: 2 }}>
                                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: settings.ticketCustomization.compactMode ? 'flex-end' : 'flex-start' }} />
                                    </View>
                                    <Text style={{ color: COLORS.text, fontSize: 13, fontWeight: '600', marginLeft: 10 }}>Mode compact (moins de lignes)</Text>
                                    <Text style={{ color: COLORS.muted, fontSize: 11, marginLeft: 'auto' }}>{settings.ticketCustomization.compactMode ? 'Oui' : 'Non'}</Text>
                                </Pressable>

                                <View style={[styles.reportActionsRow, { marginTop: 10 }]}>
                                    <Pressable style={styles.secondaryBtn} onPress={() => openTicketCustomizationPreview('cash')}>
                                        <Text style={styles.secondaryBtnText}>Aperçu caisse</Text>
                                    </Pressable>
                                    <Pressable style={styles.secondaryBtn} onPress={() => openTicketCustomizationPreview('kitchen')}>
                                        <Text style={styles.secondaryBtnText}>Aperçu cuisine</Text>
                                    </Pressable>
                                    <Pressable style={styles.secondaryBtn} onPress={() => openTicketCustomizationPreview('service')}>
                                        <Text style={styles.secondaryBtnText}>Aperçu salle</Text>
                                    </Pressable>
                                </View>
                                <View style={[styles.reportActionsRow, { marginTop: 8 }]}>
                                    <Pressable
                                        style={styles.secondaryBtn}
                                        onPress={() => {
                                            updateTicketCustomization({ ...DEFAULT_TICKET_CUSTOMIZATION });
                                            showToast('Personnalisation ticket réinitialisée.');
                                        }}
                                    >
                                        <Text style={styles.secondaryBtnText}>Réinitialiser</Text>
                                    </Pressable>
                                </View>
                            </View>

                            {/* ── Majoration nuit ── */}
                            <View style={[styles.reportCard, { borderColor: nightSurchargeActive ? '#7A5200' : '#1F1F1F', overflow: 'hidden' }]}>
                                {/* Header avec indicateur de statut */}
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: nightSurchargeActive ? '#3D2900' : '#1A1A1A', alignItems: 'center', justifyContent: 'center', marginRight: 10, borderWidth: 1, borderColor: nightSurchargeActive ? '#7A5200' : '#333' }}>
                                        <Text style={{ fontSize: 18 }}>🌙</Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ color: COLORS.text, fontWeight: '800', fontSize: 14 }}>Majoration nuit</Text>
                                        <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 1 }}>Pop-up automatique après minuit</Text>
                                    </View>
                                    {nightSurchargeActive ? (
                                        <View style={{ backgroundColor: '#2D1A00', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#7A5200' }}>
                                            <Text style={{ color: '#FFAA33', fontSize: 10, fontWeight: '800' }}>ACTIVE</Text>
                                        </View>
                                    ) : (
                                        <View style={{ backgroundColor: '#1A1A1A', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#333' }}>
                                            <Text style={{ color: COLORS.muted, fontSize: 10, fontWeight: '700' }}>INACTIVE</Text>
                                        </View>
                                    )}
                                </View>

                                {/* Pourcentage avec boutons presets */}
                                <View style={{ backgroundColor: '#0D0D0D', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#1F1F1F', marginBottom: 10 }}>
                                    <Text style={{ color: COLORS.muted, fontSize: 11, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Pourcentage de majoration</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                        {[5, 10, 15, 20].map((pct) => (
                                            <Pressable
                                                key={pct}
                                                style={{
                                                    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8,
                                                    backgroundColor: settings.nightSurchargePercent === pct ? '#3D2900' : '#141414',
                                                    borderWidth: 1.5,
                                                    borderColor: settings.nightSurchargePercent === pct ? '#FFAA33' : '#252525',
                                                }}
                                                onPress={() => setSettings((prev) => ({ ...prev, nightSurchargePercent: pct }))}
                                            >
                                                <Text style={{
                                                    color: settings.nightSurchargePercent === pct ? '#FFAA33' : COLORS.muted,
                                                    fontSize: 15, fontWeight: '800',
                                                }}>{pct}%</Text>
                                            </Pressable>
                                        ))}
                                        <View style={{ width: 72, borderRadius: 8, borderWidth: 1.5, borderColor: ![5, 10, 15, 20].includes(settings.nightSurchargePercent) && settings.nightSurchargePercent > 0 ? '#FFAA33' : '#252525', backgroundColor: ![5, 10, 15, 20].includes(settings.nightSurchargePercent) && settings.nightSurchargePercent > 0 ? '#3D2900' : '#141414', overflow: 'hidden' }}>
                                            <TextInput
                                                style={{ color: '#FFAA33', fontSize: 15, fontWeight: '800', textAlign: 'center', paddingVertical: 8, paddingHorizontal: 4 }}
                                                value={![5, 10, 15, 20].includes(settings.nightSurchargePercent) ? String(settings.nightSurchargePercent || '') : ''}
                                                onChangeText={(t) => {
                                                    const cleaned = t.replace(/[^0-9.]/g, '');
                                                    const val = parseFloat(cleaned);
                                                    setSettings((prev) => ({ ...prev, nightSurchargePercent: Number.isFinite(val) ? val : 0 }));
                                                }}
                                                placeholder="__"
                                                placeholderTextColor="#555"
                                                keyboardType="decimal-pad"
                                                maxLength={5}
                                            />
                                        </View>
                                        <Text style={{ color: '#555', fontSize: 14, fontWeight: '600' }}>%</Text>
                                    </View>
                                </View>

                                {/* Actions */}
                                <View style={{ flexDirection: 'row', gap: 8 }}>
                                    <Pressable
                                        style={{
                                            flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                                            paddingVertical: 12, borderRadius: 10,
                                            backgroundColor: nightSurchargeActive ? '#2A0F0F' : '#0F1A0F',
                                            borderWidth: 1.5,
                                            borderColor: nightSurchargeActive ? '#993333' : '#2A5A2A',
                                        }}
                                        onPress={() => {
                                            if (!nightSurchargeActive && (!settings.nightSurchargePercent || settings.nightSurchargePercent <= 0)) {
                                                showToast('Configure un pourcentage avant d\'activer.', 'error');
                                                return;
                                            }
                                            setNightSurchargeActive(!nightSurchargeActive);
                                            showToast(nightSurchargeActive ? 'Majoration nuit désactivée.' : `Majoration nuit activée (${settings.nightSurchargePercent}%).`);
                                        }}
                                    >
                                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: nightSurchargeActive ? COLORS.danger : COLORS.accent }} />
                                        <Text style={{ color: nightSurchargeActive ? '#FF7777' : COLORS.accent, fontSize: 13, fontWeight: '700' }}>
                                            {nightSurchargeActive ? 'Désactiver' : 'Activer'}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        style={{
                                            paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10,
                                            backgroundColor: '#111', borderWidth: 1.5, borderColor: '#252525',
                                        }}
                                        onPress={async () => {
                                            const nextSettings: PrinterSettings = {
                                                ...settings,
                                                ticketCustomization: normalizeTicketCustomization(settings.ticketCustomization),
                                            };
                                            await savePrinterSettings(nextSettings);
                                            setSettings(nextSettings);
                                            showToast('Paramètre majoration sauvegardé ✓');
                                        }}
                                    >
                                        <Text style={{ color: COLORS.muted, fontSize: 13, fontWeight: '700' }}>Sauvegarder</Text>
                                    </Pressable>
                                </View>
                            </View>

                            <View style={styles.reportCard}>
                                <Text style={styles.reportTitle}>Changer un code PIN</Text>
                                <View style={{ gap: 8, marginTop: 8 }}>
                                    <View style={{ flexDirection: 'row', gap: 8 }}>
                                        {getUsernames().map((u) => (
                                            (() => {
                                                const isBlocked = u === 'admin' && !isAdminAccount;
                                                return (
                                            <Pressable
                                                key={u}
                                                style={[
                                                    styles.secondaryBtn,
                                                    changePinUser === u && { backgroundColor: COLORS.accent },
                                                    isBlocked && styles.primaryBtnDisabled,
                                                ]}
                                                onPress={() => {
                                                    if (isBlocked) {
                                                        showToast('Seul le compte Admin peut modifier le code Admin.', 'error');
                                                        return;
                                                    }
                                                    setChangePinUser(u);
                                                    setChangePinValue('');
                                                    setChangePinConfirm('');
                                                }}
                                                disabled={isBlocked}
                                            >
                                                <Text style={[styles.secondaryBtnText, changePinUser === u && { color: '#000' }]}>
                                                    {displayNameForUser(u)}
                                                </Text>
                                            </Pressable>
                                                );
                                            })()
                                        ))}
                                    </View>
                                    {changePinUser ? (
                                        <>
                                            <Text style={styles.reportText}>Nouveau code pour « {displayNameForUser(changePinUser)} » (4 chiffres)</Text>
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
                                                    if (changePinUser === 'admin' && !isAdminAccount) {
                                                        showToast('Seul le compte Admin peut modifier le code Admin.', 'error');
                                                        return;
                                                    }
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
                                                        showToast(`Code PIN de « ${displayNameForUser(changePinUser)} » mis à jour.`);
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
                            </View>

                            <View style={styles.reportCard}>
                                <Text style={styles.reportTitle}>Rapport hebdomadaire</Text>
                                <Text style={styles.reportText}>Période: 7 derniers jours</Text>
                                <Text style={styles.reportText}>Tickets: {weeklyStats.ordersCount}</Text>
                                <Text style={styles.reportText}>CA: {weeklyStats.revenue.toFixed(2)}€</Text>
                            </View>
                            </ScrollView>
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
                                    style={[styles.productFormToggle, formSendToSalle && styles.productFormToggleActive]}
                                    onPress={() => setFormSendToSalle(!formSendToSalle)}
                                >
                                    <Text style={[styles.productFormToggleText, formSendToSalle && styles.productFormToggleTextActive]}>
                                        {formSendToSalle ? '🧾 Ticket salle' : '🚫 Pas en salle'}
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
                        <Text style={styles.correctionTitle}>Choisir le moyen de paiement</Text>
                        <View style={styles.otherPayGrid}>
                            {[
                                { label: 'Espèces', icon: '💵' },
                                { label: 'Carte', icon: '💳' },
                                { label: 'Ticket Restaurant', icon: '🎫' },
                                { label: 'Chèque Vacances', icon: '🏖️' },
                                { label: 'Titre Restaurant CB', icon: '💳' },
                            ].map((m: { label: string; icon: string }) => (
                                <Pressable
                                    key={m.label}
                                    style={styles.otherPayOption}
                                    onPress={() => {
                                        setOtherPayModalVisible(false);
                                        requestPay(m.label);
                                    }}
                                    android_ripple={{ color: '#39FF5A33' }}
                                >
                                    <Text style={styles.otherPayOptionIcon}>{m.icon}</Text>
                                    <Text style={styles.otherPayOptionLabel}>{m.label}</Text>
                                </Pressable>
                            ))}
                        </View>

                        <Pressable
                            style={styles.secondaryBtn}
                            onPress={() => setOtherPayModalVisible(false)}
                        >
                            <Text style={styles.secondaryBtnText}>Fermer</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            <Modal visible={noteModalVisible} transparent animationType="fade">
                <View style={styles.correctionBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setNoteModalVisible(false)} />
                    <View style={styles.otherPayCard}>
                        <Text style={styles.correctionTitle}>
                            📝 Note — {cart.find((l) => l.lineId === noteTargetLineId)?.product.name ?? 'Article'}
                        </Text>
                        <View style={styles.otherPayGrid}>
                            {[
                                { label: 'Sans sauce', icon: '🚫' },
                                { label: 'Sans crudités', icon: '🥗' },
                                { label: 'Sans fromage', icon: '🧀' },
                                { label: 'Sans oignon', icon: '🧅' },
                                { label: 'Bien cuit', icon: '🔥' },
                                { label: 'Sans tomate', icon: '🍅' },
                            ].map((opt) => (
                                <Pressable
                                    key={opt.label}
                                    style={styles.otherPayOption}
                                    onPress={() => {
                                        setNoteModalText((prev) => prev ? `${prev}, ${opt.label.toLowerCase()}` : opt.label.toLowerCase());
                                    }}
                                    android_ripple={{ color: '#39FF5A33' }}
                                >
                                    <Text style={styles.otherPayOptionIcon}>{opt.icon}</Text>
                                    <Text style={styles.otherPayOptionLabel}>{opt.label}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <TextInput
                            style={[styles.input, { marginTop: 10, marginBottom: 10 }]}
                            value={noteModalText}
                            onChangeText={setNoteModalText}
                            placeholder="Note libre (ex: sans tomate, extra ketchup…)"
                            placeholderTextColor={COLORS.muted}
                        />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                            {noteModalText ? (
                                <Pressable
                                    style={[styles.secondaryBtn, { flex: 1, borderColor: '#e74c3c' }]}
                                    onPress={() => setNoteModalText('')}
                                >
                                    <Text style={[styles.secondaryBtnText, { color: '#e74c3c' }]}>Effacer</Text>
                                </Pressable>
                            ) : null}
                            <Pressable
                                style={[styles.primaryBtn, { flex: 2 }]}
                                onPress={() => {
                                    if (noteTargetLineId) setItemNote(noteTargetLineId, noteModalText.trim());
                                    setNoteModalVisible(false);
                                }}
                            >
                                <Text style={styles.primaryBtnText}>✅ Valider</Text>
                            </Pressable>
                        </View>
                        <Pressable
                            style={[styles.secondaryBtn, { marginTop: 6 }]}
                            onPress={() => setNoteModalVisible(false)}
                        >
                            <Text style={styles.secondaryBtnText}>Annuler</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            <Modal visible={marinadeModalVisible} transparent animationType="fade">
                <View style={styles.correctionBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={closeMarinadeModal} />
                    <View style={styles.otherPayCard}>
                        <Text style={styles.correctionTitle}>
                            🍢 Marinade — {marinadeProduct?.name ?? 'Satay'}
                        </Text>
                        <View style={styles.otherPayGrid}>
                            {SATAY_MARINADES.map((opt) => (
                                <Pressable
                                    key={opt.label}
                                    style={styles.otherPayOption}
                                    onPress={() => addSatayWithMarinade(opt.label)}
                                    android_ripple={{ color: '#39FF5A33' }}
                                >
                                    <Text style={styles.otherPayOptionIcon}>{opt.icon}</Text>
                                    <Text style={styles.otherPayOptionLabel}>{opt.label}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <Pressable
                            style={[styles.secondaryBtn, { marginTop: 10 }]}
                            onPress={closeMarinadeModal}
                        >
                            <Text style={styles.secondaryBtnText}>Annuler</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            <Modal visible={snackSauceModalVisible} transparent animationType="fade">
                <View style={styles.correctionBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={closeSnackSauceModal} />
                    <View style={styles.otherPayCard}>
                        <Text style={styles.correctionTitle}>
                            🥫 Choix sauce — {snackSauceProduct?.name ?? 'Snack'}
                        </Text>
                        <Text style={styles.correctionSub}>
                            Choisir {snackSauceRequiredCount} sauce{snackSauceRequiredCount > 1 ? 's' : ''} ({snackSauceSelections.length}/{snackSauceRequiredCount})
                        </Text>
                        <View style={styles.otherPayGrid}>
                            {snackSauceOptions.map((sauceLabel) => {
                                const isSelected = snackSauceSelections.includes(sauceLabel);
                                const isDisabled = !isSelected && snackSauceSelections.length >= snackSauceRequiredCount;
                                return (
                                    <Pressable
                                        key={sauceLabel}
                                        style={[
                                            styles.otherPayOption,
                                            isSelected && { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft, borderWidth: 1.5 },
                                            isDisabled && { opacity: 0.45 },
                                        ]}
                                        onPress={() => {
                                            setSnackSauceSelections((prev) => {
                                                if (prev.includes(sauceLabel)) {
                                                    return prev.filter((label) => label !== sauceLabel);
                                                }
                                                if (prev.length >= snackSauceRequiredCount) {
                                                    return prev;
                                                }
                                                return [...prev, sauceLabel];
                                            });
                                        }}
                                        disabled={isDisabled}
                                        android_ripple={{ color: '#39FF5A33' }}
                                    >
                                        <Text style={styles.otherPayOptionIcon}>🥫</Text>
                                        <Text style={styles.otherPayOptionLabel}>{sauceLabel}</Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                        <Pressable
                            style={[
                                styles.primaryBtn,
                                { marginTop: 10 },
                                snackSauceSelections.length !== snackSauceRequiredCount && styles.primaryBtnDisabled,
                            ]}
                            onPress={addSnackWithSauces}
                            disabled={snackSauceSelections.length !== snackSauceRequiredCount}
                        >
                            <Text style={styles.primaryBtnText}>
                                {snackSauceSelectionTarget === 'menu_main' ? '✅ Valider le menu' : '✅ Ajouter au panier'}
                            </Text>
                        </Pressable>
                        <Pressable
                            style={[styles.secondaryBtn, { marginTop: 10 }]}
                            onPress={closeSnackSauceModal}
                        >
                            <Text style={styles.secondaryBtnText}>Annuler</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            <Modal visible={sundaeModalVisible} transparent animationType="fade">
                <View style={styles.correctionBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={closeSundaeModal} />
                    <View style={styles.otherPayCard}>
                        <Text style={styles.correctionTitle}>
                            🍨 Options Sundae — {sundaeProduct?.name ?? 'Sundae'}
                        </Text>
                        <Text style={styles.correctionSub}>Nappage (1 choix)</Text>
                        <View style={styles.otherPayGrid}>
                            {SUNDAE_NAPPAGE_OPTIONS.map((nappageLabel) => (
                                <Pressable
                                    key={nappageLabel}
                                    style={[
                                        styles.otherPayOption,
                                        sundaeNappageSelection === nappageLabel
                                        && { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft, borderWidth: 1.5 },
                                    ]}
                                    onPress={() => setSundaeNappageSelection(nappageLabel)}
                                    android_ripple={{ color: '#39FF5A33' }}
                                >
                                    <Text style={styles.otherPayOptionIcon}>🍯</Text>
                                    <Text style={styles.otherPayOptionLabel}>{nappageLabel}</Text>
                                </Pressable>
                            ))}
                        </View>

                        <Text style={[styles.correctionSub, { marginTop: 10 }]}>
                            Croquant (0 à {MAX_SUNDAE_CROQUANTS} choix)
                        </Text>
                        <View style={styles.otherPayGrid}>
                            {SUNDAE_CROQUANT_OPTIONS.map((croquantLabel) => {
                                const isSelected = sundaeCroquantSelections.includes(croquantLabel);
                                const hasSansCroquant = sundaeCroquantSelections.includes('Sans Croquant');
                                const selectedCroquantsCount = sundaeCroquantSelections.filter((entry) => entry !== 'Sans Croquant').length;
                                const isSansCroquantOption = croquantLabel === 'Sans Croquant';
                                const isDisabled = !isSelected
                                    && (
                                        (isSansCroquantOption && selectedCroquantsCount > 0)
                                        || (!isSansCroquantOption && (hasSansCroquant || selectedCroquantsCount >= MAX_SUNDAE_CROQUANTS))
                                    );

                                return (
                                    <Pressable
                                        key={croquantLabel}
                                        style={[
                                            styles.otherPayOption,
                                            isSelected && { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft, borderWidth: 1.5 },
                                            isDisabled && { opacity: 0.45 },
                                        ]}
                                        onPress={() => toggleSundaeCroquant(croquantLabel)}
                                        disabled={isDisabled}
                                        android_ripple={{ color: '#39FF5A33' }}
                                    >
                                        <Text style={styles.otherPayOptionIcon}>🍫</Text>
                                        <Text style={styles.otherPayOptionLabel}>{croquantLabel}</Text>
                                    </Pressable>
                                );
                            })}
                        </View>

                        <Pressable
                            style={[
                                styles.primaryBtn,
                                { marginTop: 10 },
                                !sundaeNappageSelection && styles.primaryBtnDisabled,
                            ]}
                            onPress={addSundaeWithOptions}
                            disabled={!sundaeNappageSelection}
                        >
                            <Text style={styles.primaryBtnText}>✅ Ajouter au panier</Text>
                        </Pressable>
                        <Pressable
                            style={[styles.secondaryBtn, { marginTop: 10 }]}
                            onPress={closeSundaeModal}
                        >
                            <Text style={styles.secondaryBtnText}>Annuler</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            <Modal visible={saladModalVisible} transparent animationType="fade">
                <View style={styles.correctionBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={closeSaladModal} />
                    <View style={styles.otherPayCard}>
                        <Text style={styles.correctionTitle}>
                            🥗 Composition salade — {saladProduct?.name ?? 'Salade'}
                        </Text>
                        <Text style={styles.correctionSub}>Choisir 1 protéine et 1 sauce</Text>

                        <Text style={[styles.correctionSub, { marginTop: 10, fontWeight: '700' }]}>Protéine</Text>
                        <View style={styles.otherPayGrid}>
                            {SALAD_PROTEIN_OPTIONS.map((proteinLabel) => (
                                <Pressable
                                    key={proteinLabel}
                                    style={[
                                        styles.otherPayOption,
                                        saladProteinSelection === proteinLabel
                                        && { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft, borderWidth: 1.5 },
                                    ]}
                                    onPress={() => setSaladProteinSelection(proteinLabel)}
                                    android_ripple={{ color: '#39FF5A33' }}
                                >
                                    <Text style={styles.otherPayOptionIcon}>🥗</Text>
                                    <Text style={styles.otherPayOptionLabel}>{proteinLabel}</Text>
                                </Pressable>
                            ))}
                        </View>

                        <Text style={[styles.correctionSub, { marginTop: 10, fontWeight: '700' }]}>Sauce</Text>
                        <View style={styles.otherPayGrid}>
                            {SALAD_SAUCE_OPTIONS.map((sauceLabel) => (
                                <Pressable
                                    key={sauceLabel}
                                    style={[
                                        styles.otherPayOption,
                                        saladSauceSelection === sauceLabel
                                        && { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft, borderWidth: 1.5 },
                                    ]}
                                    onPress={() => setSaladSauceSelection(sauceLabel)}
                                    android_ripple={{ color: '#39FF5A33' }}
                                >
                                    <Text style={styles.otherPayOptionIcon}>🥣</Text>
                                    <Text style={styles.otherPayOptionLabel}>{sauceLabel}</Text>
                                </Pressable>
                            ))}
                        </View>

                        <Pressable
                            style={[
                                styles.primaryBtn,
                                { marginTop: 10 },
                                (!saladProteinSelection || !saladSauceSelection) && styles.primaryBtnDisabled,
                            ]}
                            onPress={addSaladWithComposition}
                            disabled={!saladProteinSelection || !saladSauceSelection}
                        >
                            <Text style={styles.primaryBtnText}>
                                {saladSelectionTarget === 'menu_main' ? '✅ Valider le menu' : '✅ Ajouter au panier'}
                            </Text>
                        </Pressable>
                        <Pressable
                            style={[styles.secondaryBtn, { marginTop: 10 }]}
                            onPress={closeSaladModal}
                        >
                            <Text style={styles.secondaryBtnText}>Annuler</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            <Modal visible={editionLimiteeModeModalVisible} transparent animationType="fade">
                <View style={styles.correctionBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditionLimiteeModeModalVisible(false)} />
                    <View style={[styles.otherPayCard, styles.editionModeCard]}>
                        <Text style={styles.correctionTitle}>✨ Edition Limitee</Text>
                        <Text style={styles.correctionSub}>
                            Choisir comment tu veux travailler ce catalogue.
                        </Text>

                        <Pressable
                            style={[styles.editionModeOption, styles.editionModeOptionMenu]}
                            onPress={() => applyEditionLimiteeSelectionMode('menu')}
                            android_ripple={{ color: '#39FF5A33' }}
                        >
                            <Text style={styles.editionModeOptionTitle}>🧩 Mode Menu</Text>
                            <Text style={styles.editionModeOptionSub}>
                                Composition guidée: principal + accompagnement + boisson.
                            </Text>
                        </Pressable>

                        <Pressable
                            style={styles.editionModeOption}
                            onPress={() => applyEditionLimiteeSelectionMode('simple')}
                            android_ripple={{ color: '#39FF5A33' }}
                        >
                            <Text style={styles.editionModeOptionTitle}>⚡ Mode Simple</Text>
                            <Text style={styles.editionModeOptionSub}>
                                Un appui = ajout direct du produit au panier.
                            </Text>
                        </Pressable>

                        <Pressable
                            style={[styles.secondaryBtn, { marginTop: 2 }]}
                            onPress={() => setEditionLimiteeModeModalVisible(false)}
                        >
                            <Text style={styles.secondaryBtnText}>Annuler</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            <Modal visible={payChoiceOpen} transparent animationType="fade">
                <View style={styles.correctionBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setPayChoiceOpen(false)} />
                    <View style={[styles.otherPayCard, { minWidth: 340 }]}>
                        <Text style={styles.correctionTitle}>💶 Que souhaitez-vous faire ?</Text>
                        <View style={{ gap: 12, marginTop: 8 }}>
                            {[
                                { key: 'remise', icon: '🏷️', label: discountPercent > 0 ? `Modifier remise (${discountPercent}%)` : 'Appliquer une remise', color: '#1A2A1A', border: '#39FF5A' },
                                { key: 'payer', icon: '💶', label: 'Encaisser la commande', color: '#1A2A1A', border: '#39FF5A' },
                                { key: 'mixte', icon: '✂️', label: 'Paiement mixte', color: '#1A2A1A', border: '#39FF5A' },
                            ].map((opt) => (
                                <Pressable
                                    key={opt.key}
                                    style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 14,
                                        backgroundColor: opt.color,
                                        borderWidth: 1.5,
                                        borderColor: opt.border,
                                        borderRadius: 14,
                                        paddingVertical: 16,
                                        paddingHorizontal: 18,
                                    }}
                                    android_ripple={{ color: '#39FF5A22' }}
                                    onPress={() => {
                                        setPayChoiceOpen(false);
                                        if (opt.key === 'remise') {
                                            setDiscountInput(discountPercent > 0 ? String(discountPercent) : '');
                                            setDiscountModalVisible(true);
                                        } else if (opt.key === 'payer') {
                                            setOtherPayModalVisible(true);
                                        } else {
                                            setSplitParts([{ method: 'Espèces', amount: '' }, { method: 'Carte', amount: '' }]);
                                            setSplitPayModalVisible(true);
                                        }
                                    }}
                                >
                                    <Text style={{ fontSize: 28 }}>{opt.icon}</Text>
                                    <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700' }}>{opt.label}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <Pressable
                            style={{ alignSelf: 'center', marginTop: 16, paddingVertical: 8, paddingHorizontal: 24 }}
                            onPress={() => setPayChoiceOpen(false)}
                        >
                            <Text style={{ color: '#888', fontSize: 14 }}>Annuler</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            <Modal visible={discountModalVisible} transparent animationType="fade">
                <View style={styles.correctionBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setDiscountModalVisible(false)} />
                    <View style={styles.otherPayCard}>
                        <Text style={styles.correctionTitle}>Appliquer une remise</Text>
                        <View style={styles.otherPayGrid}>
                            {[5, 10, 15, 20].map((pct) => (
                                <Pressable
                                    key={pct}
                                    style={[styles.otherPayOption, discountPercent === pct && { borderColor: COLORS.accent, borderWidth: 2 }]}
                                    onPress={() => { setDiscountPercent(pct); setDiscountModalVisible(false); setPayChoiceOpen(true); }}
                                    android_ripple={{ color: '#39FF5A33' }}
                                >
                                    <Text style={[styles.otherPayOptionIcon, { color: COLORS.text }]}>{pct}%</Text>
                                </Pressable>
                            ))}
                        </View>
                        <Text style={[styles.correctionSub, { marginTop: 8 }]}>Ou saisir un pourcentage :</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                            <TextInput
                                style={[styles.input, { flex: 1 }]}
                                value={discountInput}
                                onChangeText={setDiscountInput}
                                placeholder="Ex: 12"
                                placeholderTextColor={COLORS.muted}
                                keyboardType="numeric"
                            />
                            <Pressable
                                style={[styles.secondaryBtn, { flex: 0.9 }, !discountInput.trim() && styles.primaryBtnDisabled]}
                                onPress={() => {
                                    const val = parseInt(discountInput, 10);
                                    if (val > 0 && val <= 100) { setDiscountPercent(val); setDiscountModalVisible(false); setPayChoiceOpen(true); }
                                    else { Alert.alert('Erreur', 'Remise entre 1 et 100%.'); }
                                }}
                                disabled={!discountInput.trim()}
                            >
                                <Text style={styles.secondaryBtnText}>OK</Text>
                            </Pressable>
                        </View>
                        {discountPercent > 0 ? (
                            <Pressable
                                style={[styles.clearBtn, { marginTop: 8 }]}
                                onPress={() => { setDiscountPercent(0); setDiscountModalVisible(false); setPayChoiceOpen(true); }}
                            >
                                <Text style={styles.secondaryBtnText}>Supprimer la remise</Text>
                            </Pressable>
                        ) : null}
                        <Pressable style={[styles.secondaryBtn, { marginTop: 4 }]} onPress={() => setDiscountModalVisible(false)}>
                            <Text style={styles.secondaryBtnText}>Fermer</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            <Modal visible={standbyModalVisible} transparent animationType="fade">
                <View style={styles.correctionBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setStandbyModalVisible(false)} />
                    <View style={styles.standbyCard}>
                        <View style={styles.standbyHeader}>
                            <Text style={{ color: COLORS.text, fontWeight: '800', fontSize: 18 }}>
                                ⏸️ Commandes en attente
                            </Text>
                            <View style={styles.standbyBadge}>
                                <Text style={{ color: '#000', fontSize: 14, fontWeight: '800' }}>{standbyOrders.length}</Text>
                            </View>
                            <View style={{ flex: 1 }} />
                            <Pressable onPress={() => setStandbyModalVisible(false)} style={styles.standbyCloseBtn}>
                                <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '700' }}>✕</Text>
                            </Pressable>
                        </View>

                        {cart.length > 0 ? (
                            <Pressable
                                style={[styles.primaryBtn, { marginBottom: 2 }]}
                                onPress={() => { setStandbyModalVisible(false); holdOrder(); }}
                            >
                                <Text style={styles.primaryBtnText}>+ Mettre la commande actuelle en attente</Text>
                            </Pressable>
                        ) : null}

                        <ScrollView style={styles.standbyList} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator>
                            {standbyOrders.length > 0 ? standbyOrders.map((order) => (
                                <View key={order.id} style={[styles.standbyRow, order.kitchenSent && { borderColor: '#3A5A20' }]}>
                                    <View style={{ flex: 1, gap: 2 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                            <Text style={{ color: COLORS.text, fontSize: 15, fontWeight: '700', flex: 1 }}>
                                                {order.tableLabel ? `🍽️ Table ${order.tableLabel}` : '📦 Sans table'} — {order.savedAt}
                                            </Text>
                                            {order.kitchenSent ? (
                                                <View style={{ backgroundColor: '#1A2A10', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#3A5A20' }}>
                                                    <Text style={{ color: COLORS.accent, fontSize: 10, fontWeight: '700' }}>EN CUISINE</Text>
                                                </View>
                                            ) : null}
                                        </View>
                                        <Text style={{ color: COLORS.accent, fontSize: 13, fontWeight: '600' }}>
                                            {order.cart.length} article{order.cart.length > 1 ? 's' : ''} • {order.cart.reduce((acc, l) => acc + l.product.price * l.quantity, 0).toFixed(2)}€
                                        </Text>
                                        <Text numberOfLines={2} style={{ color: COLORS.muted, fontSize: 11, marginTop: 1 }}>
                                            {order.cart.map((l) => `${l.quantity}× ${l.product.name}`).join(', ')}
                                        </Text>
                                    </View>
                                    <View style={{ gap: 6, marginLeft: 10 }}>
                                        {!order.kitchenSent ? (
                                            <Pressable
                                                style={[styles.standbyActionBtn, { backgroundColor: '#FF8C00' }]}
                                                onPress={() => sendStandbyToKitchen(order.id)}
                                            >
                                                <Text style={{ color: '#000', fontSize: 13, fontWeight: '700' }}>🍳 Cuisine</Text>
                                            </Pressable>
                                        ) : null}
                                        <Pressable
                                            style={styles.standbyActionBtn}
                                            onPress={() => restoreOrder(order.id)}
                                        >
                                            <Text style={{ color: '#000', fontSize: 13, fontWeight: '700' }}>▶ Reprendre</Text>
                                        </Pressable>
                                        <Pressable
                                            style={styles.standbyDeleteBtn}
                                            onPress={() => {
                                                setStandbyOrders((prev) => prev.filter((o) => o.id !== order.id));
                                                if (standbyOrders.length <= 1) setStandbyModalVisible(false);
                                            }}
                                        >
                                            <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>Supprimer</Text>
                                        </Pressable>
                                    </View>
                                </View>
                            )) : (
                                <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
                                    <Text style={{ fontSize: 40 }}>📋</Text>
                                    <Text style={{ color: COLORS.muted, fontSize: 15, marginTop: 8 }}>Aucune commande en attente</Text>
                                </View>
                            )}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            <Modal visible={splitPayModalVisible} transparent animationType="fade">
                <View style={styles.correctionBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setSplitPayModalVisible(false)} />
                    <View style={styles.splitCard}>
                        {/* ── Header ── */}
                        <View style={styles.splitHeader}>
                            <Text style={styles.splitHeaderTitle}>✂️  Paiement mixte</Text>
                            <View style={styles.splitTotalBadge}>
                                <Text style={styles.splitTotalBadgeText}>{totalTtc.toFixed(2)} €</Text>
                            </View>
                            <Pressable style={styles.splitCloseBtn} onPress={() => setSplitPayModalVisible(false)}>
                                <Text style={{ color: COLORS.text, fontSize: 20, fontWeight: '700' }}>✕</Text>
                            </Pressable>
                        </View>

                        {/* ── Parts ── */}
                        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
                            {splitParts.map((part, idx) => {
                                const SPLIT_METHODS: { key: string; icon: string; short: string }[] = [
                                    { key: 'Espèces', icon: '💵', short: 'Espèces' },
                                    { key: 'Carte', icon: '💳', short: 'Carte' },
                                    { key: 'CB Restaurant', icon: '🏧', short: 'CB Restau' },
                                    { key: 'Ticket Restaurant', icon: '🎫', short: 'Ticket Resto' },
                                    { key: 'Chèque Vacances', icon: '🏖️', short: 'Chèque Vac.' },
                                ];
                                const othersTotal = splitParts.reduce((sum, p, i) => i === idx ? sum : sum + (parseFloat(p.amount) || 0), 0);
                                const autoAmount = Math.max(0, totalTtc - othersTotal);
                                return (
                                    <View key={idx} style={styles.splitPartRow}>
                                        {/* Left: badge + methods */}
                                        <View style={{ flex: 1, gap: 10 }}>
                                            <View style={styles.splitPartLabelRow}>
                                                <View style={styles.splitPartBadge}>
                                                    <Text style={styles.splitPartBadgeText}>{idx + 1}</Text>
                                                </View>
                                                <Text style={styles.splitPartLabel}>Moyen de paiement</Text>
                                                {splitParts.length > 2 ? (
                                                    <Pressable
                                                        style={styles.splitDeleteBtn}
                                                        onPress={() => setSplitParts((prev) => prev.filter((_, i) => i !== idx))}
                                                        hitSlop={8}
                                                    >
                                                        <Text style={styles.splitDeleteBtnText}>🗑️</Text>
                                                    </Pressable>
                                                ) : null}
                                            </View>
                                            <View style={styles.splitMethodGrid}>
                                                {SPLIT_METHODS.map((m) => (
                                                    <Pressable
                                                        key={m.key}
                                                        style={[styles.splitMethodBtn, part.method === m.key && styles.splitMethodBtnActive]}
                                                        onPress={() => setSplitParts((prev) => prev.map((p, i) => i === idx ? { ...p, method: m.key } : p))}
                                                    >
                                                        <Text style={styles.splitMethodIcon}>{m.icon}</Text>
                                                        <Text style={[styles.splitMethodLabel, part.method === m.key && styles.splitMethodLabelActive]}>{m.short}</Text>
                                                    </Pressable>
                                                ))}
                                            </View>
                                        </View>
                                        {/* Right: amount */}
                                        <View style={styles.splitAmountCol}>
                                            <Text style={styles.splitAmountLabel}>Montant</Text>
                                            <View style={styles.splitAmountInputWrap}>
                                                <TextInput
                                                    style={styles.splitAmountInput}
                                                    value={part.amount}
                                                    onChangeText={(val) => setSplitParts((prev) => prev.map((p, i) => i === idx ? { ...p, amount: val } : p))}
                                                    placeholder="0.00"
                                                    placeholderTextColor="#444"
                                                    keyboardType="numeric"
                                                />
                                                <Text style={styles.splitAmountSuffix}>€</Text>
                                            </View>
                                            <Pressable
                                                style={styles.splitAutoBtn}
                                                onPress={() => setSplitParts((prev) => prev.map((p, i) => i === idx ? { ...p, amount: autoAmount.toFixed(2) } : p))}
                                            >
                                                <Text style={styles.splitAutoBtnText}>Auto → {autoAmount.toFixed(2)}€</Text>
                                            </Pressable>
                                        </View>
                                    </View>
                                );
                            })}
                        </ScrollView>

                        {/* ── Footer ── */}
                        <View style={styles.splitFooter}>
                            {/* Add part */}
                            <Pressable
                                style={styles.splitAddBtn}
                                onPress={() => setSplitParts((prev) => [...prev, { method: 'Espèces', amount: '' }])}
                            >
                                <Text style={styles.splitAddBtnText}>＋  Ajouter un moyen de paiement</Text>
                            </Pressable>

                            {/* Progress */}
                            {(() => {
                                const filledTotal = splitParts.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
                                const remaining = totalTtc - filledTotal;
                                const pct = Math.min(100, Math.round((filledTotal / totalTtc) * 100));
                                const allFilled = splitParts.every((p) => parseFloat(p.amount) > 0);
                                const isValid = allFilled && Math.abs(remaining) < 0.01;
                                return (
                                    <>
                                        <View style={styles.splitProgressWrap}>
                                            <View style={styles.splitProgressTrack}>
                                                <View style={[styles.splitProgressFill, { width: `${pct}%` }, isValid && { backgroundColor: COLORS.accent }, !isValid && remaining < -0.01 && { backgroundColor: COLORS.danger }]} />
                                            </View>
                                            <Text style={[styles.splitProgressText, isValid ? { color: COLORS.accent } : remaining < -0.01 ? { color: COLORS.danger } : {}]}>
                                                {isValid ? '✅ Total couvert' : remaining > 0 ? `Reste ${remaining.toFixed(2)} €` : `Excès de ${Math.abs(remaining).toFixed(2)} €`}
                                            </Text>
                                        </View>

                                        <View style={styles.splitActionRow}>
                                            <Pressable style={styles.splitCancelBtn} onPress={() => setSplitPayModalVisible(false)}>
                                                <Text style={styles.splitCancelBtnText}>Annuler</Text>
                                            </Pressable>
                                            <Pressable
                                                style={[styles.splitValidateBtn, !isValid && styles.splitValidateBtnDisabled]}
                                                onPress={() => {
                                                    const label = splitParts.map((p) => `${p.method} ${parseFloat(p.amount).toFixed(2)}€`).join(' / ');
                                                    setSplitPayModalVisible(false);
                                                    handlePay(label);
                                                }}
                                                disabled={!isValid}
                                            >
                                                <Text style={styles.splitValidateBtnText}>✅  Valider le paiement</Text>
                                            </Pressable>
                                        </View>
                                    </>
                                );
                            })()}
                        </View>
                    </View>
                </View>
            </Modal>

            <Modal visible={paymentCorrectionModalVisible} transparent animationType="fade">
                <View style={styles.correctionBackdrop}>
                    <Pressable
                        style={StyleSheet.absoluteFill}
                        onPress={() => {
                            if (!isSavingPaymentCorrection) {
                                setPaymentCorrectionModalVisible(false);
                            }
                        }}
                    />
                    <View style={styles.correctionCard}>
                        <Text style={styles.correctionTitle}>Modifier encaissement</Text>
                        <Text style={styles.correctionSub}>
                            Ticket #{selectedTicket?.ticketNumber ?? '-'} · actuel: {formatPaymentMethodLabel(selectedTicket?.paymentMethod ?? '')}
                        </Text>

                        <Text style={styles.productFormLabel}>Nouveau moyen</Text>
                        <View style={styles.otherPayGrid}>
                            {PAYMENT_METHOD_OPTIONS.map((method) => (
                                <Pressable
                                    key={method}
                                    style={[
                                        styles.otherPayOption,
                                        { paddingVertical: 12 },
                                        normalizePaymentMethodForCompare(paymentCorrectionMethod) === normalizePaymentMethodForCompare(method)
                                        && { borderColor: COLORS.accent, borderWidth: 2 },
                                    ]}
                                    onPress={() => setPaymentCorrectionMethod(method)}
                                    android_ripple={{ color: '#39FF5A33' }}
                                >
                                    <Text style={styles.otherPayOptionLabel}>{method}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <View style={styles.otherPayGrid}>
                            {PAYMENT_METHOD_MIX_PRESETS.map((preset) => (
                                <Pressable
                                    key={preset}
                                    style={[
                                        styles.otherPayOption,
                                        { width: '48%', paddingVertical: 10 },
                                        normalizePaymentMethodForCompare(paymentCorrectionMethod) === normalizePaymentMethodForCompare(preset)
                                        && { borderColor: COLORS.accent, borderWidth: 2 },
                                    ]}
                                    onPress={() => setPaymentCorrectionMethod(preset)}
                                    android_ripple={{ color: '#39FF5A33' }}
                                >
                                    <Text style={styles.otherPayOptionLabel}>{preset}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <TextInput
                            style={styles.input}
                            value={paymentCorrectionMethod}
                            onChangeText={setPaymentCorrectionMethod}
                            placeholder="Ex: Carte / Titre Restaurant CB"
                            placeholderTextColor={COLORS.muted}
                        />

                        <Text style={styles.productFormLabel}>Motif *</Text>
                        <TextInput
                            style={styles.input}
                            value={paymentCorrectionReason}
                            onChangeText={setPaymentCorrectionReason}
                            placeholder="Ex: erreur de moyen d'encaissement"
                            placeholderTextColor={COLORS.muted}
                        />

                        <View style={styles.correctionActions}>
                            <Pressable
                                style={[styles.secondaryBtn, isSavingPaymentCorrection && styles.primaryBtnDisabled]}
                                onPress={() => setPaymentCorrectionModalVisible(false)}
                                disabled={isSavingPaymentCorrection}
                            >
                                <Text style={styles.secondaryBtnText}>Fermer</Text>
                            </Pressable>
                            <Pressable
                                style={[styles.primaryBtn, isSavingPaymentCorrection && styles.primaryBtnDisabled]}
                                onPress={submitPaymentMethodCorrection}
                                disabled={isSavingPaymentCorrection}
                            >
                                <Text style={styles.primaryBtnText}>
                                    {isSavingPaymentCorrection ? 'Enregistrement…' : 'Confirmer correction'}
                                </Text>
                            </Pressable>
                        </View>
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

            {/* ══════ Modal Confirmation avant paiement ══════ */}
            <Modal visible={confirmPayVisible} transparent animationType="fade">
                <View style={styles.correctionBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setConfirmPayVisible(false)} />
                    <View style={styles.otherPayCard}>
                        <Text style={styles.correctionTitle}>Confirmer le paiement</Text>
                        <View style={{ backgroundColor: COLORS.cardSoft, borderRadius: 10, padding: 14, gap: 6, marginVertical: 8 }}>
                            <Text style={{ color: COLORS.text, fontSize: 14 }}>
                                {cart.length} article{cart.length > 1 ? 's' : ''} au panier
                            </Text>
                            <Text style={{ color: COLORS.accent, fontSize: 22, fontWeight: '800' }}>
                                Total : {totalTtc.toFixed(2)}€
                            </Text>
                            {discountPercent > 0 ? (
                                <Text style={{ color: COLORS.muted, fontSize: 13 }}>Remise {discountPercent}% : -{discountAmount.toFixed(2)}€</Text>
                            ) : null}
                            <Text style={{ color: COLORS.muted, fontSize: 13 }}>
                                Paiement : {pendingPaymentMethod}
                            </Text>
                            <Text style={{ color: COLORS.muted, fontSize: 13 }}>
                                Mode : {orderType === 'a_emporter' ? 'À emporter' : 'Sur place'}
                            </Text>
                        </View>
                        <View style={styles.correctionActions}>
                            <Pressable style={styles.secondaryBtn} onPress={() => setConfirmPayVisible(false)}>
                                <Text style={styles.secondaryBtnText}>Annuler</Text>
                            </Pressable>
                            <Pressable style={styles.primaryBtn} onPress={confirmAndPay}>
                                <Text style={styles.primaryBtnText}>✓ Confirmer {totalTtc.toFixed(2)}€</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ══════ Modal Rendu de monnaie (Espèces) ══════ */}
            <Modal visible={cashChangeVisible} transparent animationType="fade">
                <View style={styles.correctionBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setCashChangeVisible(false)} />
                    <View style={styles.otherPayCard}>
                        <Text style={styles.correctionTitle}>💵 Paiement Espèces</Text>
                        <View style={{ backgroundColor: COLORS.cardSoft, borderRadius: 10, padding: 14, gap: 6, marginVertical: 4 }}>
                            <Text style={{ color: COLORS.accent, fontSize: 22, fontWeight: '800' }}>
                                Total : {totalTtc.toFixed(2)}€
                            </Text>
                        </View>
                        <Text style={styles.correctionSub}>Montant reçu du client :</Text>
                        <TextInput
                            style={[styles.input, { fontSize: 22, textAlign: 'center', fontWeight: '700', marginVertical: 6 }]}
                            value={cashGivenInput}
                            onChangeText={setCashGivenInput}
                            placeholder={totalTtc.toFixed(2)}
                            placeholderTextColor={COLORS.muted}
                            keyboardType="decimal-pad"
                            autoFocus
                        />
                        {(() => {
                            const given = parseFloat(cashGivenInput || '0');
                            const change = given - totalTtc;
                            if (cashGivenInput && given > 0) {
                                return (
                                    <View style={{ backgroundColor: change >= 0 ? '#102417' : '#2C1919', borderRadius: 10, padding: 14, alignItems: 'center', marginVertical: 6 }}>
                                        {change >= 0 ? (
                                            <>
                                                <Text style={{ color: COLORS.accent, fontSize: 14 }}>Rendu de monnaie</Text>
                                                <Text style={{ color: COLORS.accent, fontSize: 32, fontWeight: '900' }}>{change.toFixed(2)}€</Text>
                                            </>
                                        ) : (
                                            <Text style={{ color: COLORS.danger, fontSize: 16, fontWeight: '700' }}>
                                                Montant insuffisant (manque {Math.abs(change).toFixed(2)}€)
                                            </Text>
                                        )}
                                    </View>
                                );
                            }
                            return null;
                        })()}
                        <View style={[styles.otherPayGrid, { marginTop: 6 }]}>
                            {[5, 10, 20, 50].map((amount) => (
                                <Pressable
                                    key={amount}
                                    style={[styles.otherPayOption, { paddingVertical: 12 }]}
                                    onPress={() => setCashGivenInput(String(amount))}
                                    android_ripple={{ color: '#39FF5A33' }}
                                >
                                    <Text style={styles.otherPayOptionLabel}>{amount}€</Text>
                                </Pressable>
                            ))}
                        </View>
                        <View style={styles.correctionActions}>
                            <Pressable style={styles.secondaryBtn} onPress={() => setCashChangeVisible(false)}>
                                <Text style={styles.secondaryBtnText}>Annuler</Text>
                            </Pressable>
                            <Pressable
                                style={[styles.primaryBtn, (cashGivenInput && parseFloat(cashGivenInput) < totalTtc) ? styles.primaryBtnDisabled : null]}
                                onPress={() => {
                                    setCashChangeVisible(false);
                                    confirmAndPay();
                                }}
                                disabled={!!(cashGivenInput && parseFloat(cashGivenInput) < totalTtc)}
                            >
                                <Text style={styles.primaryBtnText}>✓ Encaisser {totalTtc.toFixed(2)}€</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ══════ Modal Paiement Titre Restaurant ══════ */}
            <Modal visible={voucherModalVisible} transparent animationType="fade">
                <View style={styles.correctionBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setVoucherModalVisible(false)} />
                    <View style={[styles.otherPayCard, { maxWidth: 560 }]}>
                        <Text style={styles.correctionTitle}>
                            🎫 Paiement {pendingPaymentMethod}
                        </Text>
                        <View style={{ backgroundColor: COLORS.cardSoft, borderRadius: 10, padding: 14, gap: 6, marginVertical: 4 }}>
                            <Text style={{ color: COLORS.accent, fontSize: 22, fontWeight: '800' }}>
                                Total : {totalTtc.toFixed(2)}€
                            </Text>
                        </View>
                        <Text style={styles.correctionSub}>Montant remis :</Text>
                        <TextInput
                            style={[styles.input, { fontSize: 22, textAlign: 'center', fontWeight: '700', marginVertical: 6 }]}
                            value={voucherAmountInput}
                            onChangeText={(val) => {
                                setVoucherAmountInput(val);
                                setVoucherComplement(null);
                            }}
                            placeholder={totalTtc.toFixed(2)}
                            placeholderTextColor={COLORS.muted}
                            keyboardType="decimal-pad"
                            autoFocus
                        />
                        {/* Boutons montants rapides */}
                        <View style={[styles.otherPayGrid, { marginTop: 2 }]}>
                            {[5, 8, 10, 12, 15, 20, 25].map((amount) => (
                                <Pressable
                                    key={amount}
                                    style={[styles.otherPayOption, { paddingVertical: 10 }]}
                                    onPress={() => { setVoucherAmountInput(String(amount)); setVoucherComplement(null); }}
                                    android_ripple={{ color: '#39FF5A33' }}
                                >
                                    <Text style={styles.otherPayOptionLabel}>{amount}€</Text>
                                </Pressable>
                            ))}
                        </View>
                        {(() => {
                            const given = parseFloat(voucherAmountInput || '0');
                            if (!voucherAmountInput || given <= 0) return null;
                            const diff = given - totalTtc;
                            if (diff >= 0) {
                                // Titre couvre ou dépasse le total
                                return (
                                    <View style={{ backgroundColor: '#102417', borderRadius: 10, padding: 14, alignItems: 'center', marginVertical: 6, gap: 4 }}>
                                        {diff > 0.005 ? (
                                            <>
                                                <Text style={{ color: COLORS.accent, fontSize: 13 }}>Surplus (non rendu)</Text>
                                                <Text style={{ color: COLORS.accent, fontSize: 28, fontWeight: '900' }}>+{diff.toFixed(2)}€</Text>
                                                <Text style={{ color: COLORS.muted, fontSize: 11, textAlign: 'center' }}>
                                                    Pas de rendu sur ce moyen de paiement
                                                </Text>
                                            </>
                                        ) : (
                                            <Text style={{ color: COLORS.accent, fontSize: 16, fontWeight: '700' }}>✅ Montant exact</Text>
                                        )}
                                    </View>
                                );
                            }
                            // Titre insuffisant → complément
                            const remainder = totalTtc - given;
                            return (
                                <View style={{ backgroundColor: '#1A1A1A', borderRadius: 10, padding: 14, marginVertical: 6, gap: 8 }}>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                        <Text style={{ color: COLORS.text, fontSize: 14 }}>{pendingPaymentMethod}</Text>
                                        <Text style={{ color: COLORS.accent, fontSize: 14, fontWeight: '700' }}>{given.toFixed(2)}€</Text>
                                    </View>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                        <Text style={{ color: COLORS.danger, fontSize: 14, fontWeight: '700' }}>Reste à payer</Text>
                                        <Text style={{ color: COLORS.danger, fontSize: 18, fontWeight: '900' }}>{remainder.toFixed(2)}€</Text>
                                    </View>
                                    <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}>Complément par :</Text>
                                    <View style={styles.otherPayGrid}>
                                        {['Espèces', 'Carte', 'CB Restaurant'].map((m) => (
                                            <Pressable
                                                key={m}
                                                style={[styles.otherPayOption, { paddingVertical: 10 }, voucherComplement === m && { borderColor: COLORS.accent, borderWidth: 2 }]}
                                                onPress={() => setVoucherComplement(m)}
                                                android_ripple={{ color: '#39FF5A33' }}
                                            >
                                                <Text style={styles.otherPayOptionLabel}>{m}</Text>
                                            </Pressable>
                                        ))}
                                    </View>
                                </View>
                            );
                        })()}
                        <View style={styles.correctionActions}>
                            <Pressable style={styles.secondaryBtn} onPress={() => setVoucherModalVisible(false)}>
                                <Text style={styles.secondaryBtnText}>Annuler</Text>
                            </Pressable>
                            {(() => {
                                const given = parseFloat(voucherAmountInput || '0');
                                const diff = given - totalTtc;
                                const isFullCover = given > 0 && diff >= -0.005;
                                const hasComplement = given > 0 && diff < -0.005 && voucherComplement;
                                const canValidate = isFullCover || hasComplement;
                                return (
                                    <Pressable
                                        style={[styles.primaryBtn, !canValidate && styles.primaryBtnDisabled]}
                                        disabled={!canValidate}
                                        onPress={() => {
                                            setVoucherModalVisible(false);
                                            if (isFullCover) {
                                                // Titre couvre tout → paiement direct
                                                handlePay(`${pendingPaymentMethod} ${given.toFixed(2)}€${diff > 0.005 ? ` (surplus ${diff.toFixed(2)}€)` : ''}`);
                                            } else if (hasComplement) {
                                                // Paiement mixte
                                                const remainder = (totalTtc - given);
                                                const label = `${pendingPaymentMethod} ${given.toFixed(2)}€ / ${voucherComplement} ${remainder.toFixed(2)}€`;
                                                handlePay(label);
                                            }
                                        }}
                                    >
                                        <Text style={styles.primaryBtnText}>
                                            ✓ Encaisser {totalTtc.toFixed(2)}€
                                        </Text>
                                    </Pressable>
                                );
                            })()}
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ══════ Modal plein écran ticket ══════ */}
            <Modal visible={fullscreenTicketText !== null} transparent animationType="fade">
                <View style={styles.fullscreenTicketBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setFullscreenTicketText(null)} />
                    <View style={styles.fullscreenTicketCard}>
                        <View style={styles.fullscreenTicketHeader}>
                            <Text style={{ color: COLORS.text, fontWeight: '700', fontSize: 16 }}>🧾 Aperçu du ticket</Text>
                            <Pressable onPress={() => setFullscreenTicketText(null)} style={styles.fullscreenCloseBtn}>
                                <Text style={{ color: COLORS.text, fontSize: 20, fontWeight: '700' }}>✕</Text>
                            </Pressable>
                        </View>
                        <ScrollView
                            style={styles.fullscreenTicketScroll}
                            contentContainerStyle={{ alignItems: 'center', paddingVertical: 16 }}
                            nestedScrollEnabled
                        >
                            <View style={[styles.ticketPaper, { maxWidth: 360, width: '100%' }]}>
                                <Text style={[styles.ticketPaperText, { fontSize: 13, lineHeight: 18 }]}>
                                    {fullscreenTicketText}
                                </Text>
                            </View>
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* ══════ Modal Majoration nuit ══════ */}
            <Modal visible={nightSurchargeModalVisible} transparent animationType="fade">
                <View style={[styles.correctionBackdrop, { backgroundColor: 'rgba(0,0,0,0.85)' }]}>
                    <View style={{
                        backgroundColor: '#0C0C0C', borderRadius: 20, borderWidth: 1.5, borderColor: '#7A5200',
                        width: '90%', maxWidth: 400, padding: 0, overflow: 'hidden',
                    }}>
                        {/* Bande dorée en haut */}
                        <View style={{ height: 4, backgroundColor: '#FFAA33' }} />

                        <View style={{ paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 }}>
                            {/* Icône + heure */}
                            <View style={{ alignItems: 'center', marginBottom: 20 }}>
                                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#1C1200', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#7A5200', marginBottom: 12 }}>
                                    <Text style={{ fontSize: 32 }}>🌙</Text>
                                </View>
                                <Text style={{ color: COLORS.text, fontSize: 20, fontWeight: '800', letterSpacing: 0.3 }}>Majoration nuit</Text>
                                <Text style={{ color: '#CC8800', fontSize: 13, fontWeight: '600', marginTop: 4 }}>
                                    Il est {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} — service de nuit
                                </Text>
                            </View>

                            {/* Pourcentage highlight */}
                            <View style={{ backgroundColor: '#1C1200', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#3D2900' }}>
                                <Text style={{ color: '#FFAA33', fontSize: 42, fontWeight: '900', letterSpacing: -1 }}>{settings.nightSurchargePercent}%</Text>
                                <Text style={{ color: '#AA7700', fontSize: 12, fontWeight: '600', marginTop: 4 }}>de majoration sur chaque encaissement</Text>
                            </View>

                            {/* Boutons */}
                            <View style={{ gap: 10 }}>
                                <Pressable
                                    style={{
                                        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
                                        backgroundColor: '#1A2A10', borderWidth: 1.5, borderColor: COLORS.accent,
                                        borderRadius: 14, paddingVertical: 16,
                                    }}
                                    onPress={() => {
                                        setNightSurchargeActive(true);
                                        setNightSurchargeModalVisible(false);
                                        showToast(`Majoration nuit activée (${settings.nightSurchargePercent}%).`);
                                    }}
                                >
                                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.accent }} />
                                    <Text style={{ color: COLORS.accent, fontSize: 16, fontWeight: '800' }}>Activer la majoration</Text>
                                </Pressable>
                                <Pressable
                                    style={{
                                        alignItems: 'center', justifyContent: 'center',
                                        paddingVertical: 14, borderRadius: 14,
                                        backgroundColor: '#111', borderWidth: 1, borderColor: '#2A2A2A',
                                    }}
                                    onPress={() => setNightSurchargeModalVisible(false)}
                                >
                                    <Text style={{ color: '#777', fontSize: 14, fontWeight: '600' }}>Pas maintenant</Text>
                                </Pressable>
                            </View>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ══════ Modal Ouverture de caisse ══════ */}
            <Modal visible={ouvertureModalVisible} transparent animationType="fade" onRequestClose={() => { }}>
                <View style={styles.correctionBackdrop}>
                    <View style={styles.otherPayCard}>
                        <Text style={styles.correctionTitle}>🔓 Ouverture de caisse</Text>
                        <Text style={styles.correctionSub}>
                            La caisse n'est pas encore ouverte. Voulez-vous l'ouvrir maintenant ?
                        </Text>
                        <View style={{ backgroundColor: COLORS.cardSoft, borderRadius: 10, padding: 14, gap: 4 }}>
                            <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                                Opérateur : {session.username} ({session.role === 'admin' ? (session.username === 'admin' ? 'admin' : 'manager') : 'vendeur'})
                            </Text>
                            <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                                {new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                            </Text>
                        </View>
                        <View style={styles.correctionActions}>
                            <Pressable
                                style={[styles.primaryBtn, { flex: 1 }, isOpeningCaisse && styles.primaryBtnDisabled]}
                                disabled={isOpeningCaisse}
                                onPress={async () => {
                                    setIsOpeningCaisse(true);
                                    try {
                                        const runtimeSettings = resolveRuntimePrinterSettings(settings);
                                        const state = await openCaisse(session.username);
                                        setCaisseOpenStateLocal(state);
                                        setOuvertureModalVisible(false);
                                        if (!settings.cashDrawerEnabled) {
                                            showToast('Caisse ouverte ✓');
                                        } else {
                                            const drawerResult = await openCashDrawer(runtimeSettings.cashPrinterUrl);
                                            if (!drawerResult.ok) {
                                                showToast(`Caisse ouverte, tiroir non déclenche (${drawerResult.message})`, 'error');
                                            } else {
                                                showToast('Caisse ouverte + tiroir déclenché ✓');
                                            }
                                        }
                                    } catch {
                                        showToast('Erreur lors de l\'ouverture de la caisse.', 'error');
                                    } finally {
                                        setIsOpeningCaisse(false);
                                    }
                                }}
                            >
                                <Text style={styles.primaryBtnText}>
                                    {isOpeningCaisse ? 'Ouverture…' : '✓ Ouvrir la caisse'}
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
        gap: 0,
        padding: 0,
    },
    sidebar: {
        width: 210,
        backgroundColor: COLORS.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#1A1A1A',
        padding: 10,
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
        gap: 8,
        marginTop: 14,
    },
    navBtn: {
        backgroundColor: COLORS.cardSoft,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 14,
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
        flex: 1,
    },
    salesTopRow: {
        flexDirection: 'row',
        marginBottom: 8,
    },
    salesPanel: {
        flex: 1,
        backgroundColor: COLORS.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#1A1A1A',
        padding: 8,
        overflow: 'hidden',
    },
    tunnelRowScroll: {
        flexGrow: 0,
        marginBottom: 8,
    },
    tunnelRow: {
        flexDirection: 'row',
        gap: 8,
        paddingRight: 8,
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
    editingBanner: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        backgroundColor: 'rgba(57, 255, 90, 0.12)',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: COLORS.accent,
    },
    editingBannerText: {
        color: COLORS.accent,
        fontSize: 12,
        fontWeight: '600' as const,
        flex: 1,
    },
    editingBannerCancel: {
        color: '#e74c3c',
        fontSize: 12,
        fontWeight: '700' as const,
        paddingLeft: 12,
    },
    menuTypeRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 8,
    },
    menuTypeBtn: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 8,
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
        gap: 8,
        marginBottom: 8,
    },
    menuStageBtn: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 8,
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
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#1A1A1A',
        padding: 14,
    },
    rightPanel: {
        backgroundColor: COLORS.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#1A1A1A',
        padding: 8,
        overflow: 'hidden',
    },
    categoriesRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 10,
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
        paddingBottom: 36,
        gap: 14,
    },
    productsRow: {
        gap: 14,
    },
    productCardWrap: {
        marginBottom: 6,
    },
    productFamilySection: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 6,
    },
    productFamilySectionLine: {
        flex: 1,
        height: 1,
        backgroundColor: '#284033',
    },
    productFamilySectionTitle: {
        color: '#8FCFA2',
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
    productCard: {
        backgroundColor: '#0F0F0F',
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#232323',
    },
    productCardSelected: {
        borderColor: COLORS.accent,
        borderWidth: 2,
    },
    productImage: {
        width: '100%',
        height: 92,
    },
    imageFallback: {
        backgroundColor: '#151515',
    },
    productName: {
        color: COLORS.text,
        fontWeight: '700',
        paddingHorizontal: 10,
        paddingTop: 10,
        minHeight: 50,
    },
    productPrice: {
        color: COLORS.accent,
        fontWeight: '700',
        paddingHorizontal: 10,
        paddingBottom: 10,
        paddingTop: 4,
    },
    productSupplement: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: '600',
        paddingHorizontal: 10,
        paddingBottom: 8,
        marginTop: -5,
    },
    panelTitle: {
        color: COLORS.text,
        fontWeight: '700',
        fontSize: 17,
        marginBottom: 10,
    },
    metaRow: {
        flexDirection: 'row',
        gap: 8,
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
    orderTypeToggle: {
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: COLORS.accent,
        backgroundColor: COLORS.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 44,
    },
    orderTypeToggleText: {
        color: COLORS.accent,
        fontSize: 15,
        fontWeight: '700',
    },
    headerIconBtn: {
        width: 44,
        height: 44,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: COLORS.accent,
        backgroundColor: COLORS.accentSoft,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
    pendingOrdersBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1A1A2E',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: COLORS.accent,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 6,
        gap: 8,
    },
    pendingOrdersBadge: {
        backgroundColor: COLORS.accent,
        borderRadius: 10,
        width: 22,
        height: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pendingOrdersBadgeText: {
        color: '#000',
        fontSize: 12,
        fontWeight: '800',
    },
    pendingOrdersBtnText: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: '700',
        flex: 1,
    },
    cartList: {
        flex: 1,
        flexShrink: 1,
        minHeight: 80,
        marginTop: 6,
        backgroundColor: COLORS.cardSoft,
        borderRadius: 10,
        padding: 6,
    },
    cartListContent: {
        flexGrow: 1,
        paddingBottom: 12,
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
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#1F1F1F',
    },
    cartLineEditing: {
        borderLeftWidth: 3,
        borderLeftColor: COLORS.accent,
        paddingLeft: 6,
        backgroundColor: 'rgba(57, 255, 90, 0.05)',
    },
    cartLineMain: {
        flex: 1,
        paddingRight: 10,
    },
    cartLineTitle: {
        color: COLORS.text,
        fontWeight: '600',
        flex: 1,
    },
    cartLineTitleRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 6,
    },
    noteBtn: {
        paddingHorizontal: 4,
        paddingVertical: 2,
    },
    noteBtnText: {
        fontSize: 14,
    },
    cartLineNote: {
        color: COLORS.accent,
        fontSize: 11,
        fontStyle: 'italic' as const,
        marginTop: 2,
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
        padding: 14,
        marginTop: 10,
        gap: 6,
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
        marginTop: 10,
        gap: 10,
    },
    payRow: {
        flexDirection: 'row',
        gap: 8,
    },
    secondaryBtn: {
        flex: 1,
        backgroundColor: COLORS.accentSoft,
        borderRadius: 12,
        minHeight: 40,
        paddingVertical: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#39FF5A',
    },
    clearBtn: {
        backgroundColor: COLORS.danger,
        borderRadius: 12,
        minHeight: 40,
        paddingVertical: 8,
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
        marginTop: 10,
        backgroundColor: COLORS.cardSoft,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 6,
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
        marginTop: 10,
        gap: 8,
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
        paddingVertical: 10,
        paddingHorizontal: 2,
        borderBottomWidth: 1,
        borderBottomColor: '#1F1F1F',
    },
    stockInfoPress: {
        flex: 1,
        marginRight: 10,
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
        gap: 6,
    },
    bulkBar: {
        backgroundColor: '#1A1A2E',
        borderRadius: 12,
        padding: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#2A2A3A',
    },
    bulkBarLabel: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: '600',
        marginBottom: 8,
    },
    bulkBarActions: {
        flexDirection: 'row',
        gap: 10,
    },
    bulkChip: {
        flex: 1,
        borderRadius: 8,
        paddingVertical: 8,
        alignItems: 'center',
        borderWidth: 1,
    },
    bulkChipOn: {
        backgroundColor: COLORS.accentSoft,
        borderColor: COLORS.accent,
    },
    bulkChipOff: {
        backgroundColor: '#2A1A1A',
        borderColor: '#4A2A2A',
    },
    bulkChipText: {
        color: '#FFF',
        fontSize: 12,
        fontWeight: '700',
    },
    stockPrintTags: {
        flexDirection: 'row',
        gap: 4,
        marginRight: 8,
    },
    printTag: {
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderWidth: 1,
    },
    printTagOn: {
        backgroundColor: COLORS.accentSoft,
        borderColor: COLORS.accent,
    },
    printTagOff: {
        backgroundColor: '#1A1A1A',
        borderColor: '#2A2A2A',
    },
    printTagText: {
        fontSize: 10,
        fontWeight: '700',
    },
    printTagTextOn: {
        color: COLORS.text,
    },
    printTagTextOff: {
        color: COLORS.muted,
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
    serviceTicketToggle: {
        backgroundColor: '#1A1A1A',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#333',
        padding: 12,
        marginTop: 10,
    },
    serviceTicketToggleActive: {
        borderColor: COLORS.accent,
        backgroundColor: COLORS.accentSoft,
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
        gap: 10,
        marginTop: 12,
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
    csvExportBtn: {
        marginTop: 8,
    },
    exportsPathInfo: {
        marginTop: 8,
        color: COLORS.muted,
        fontSize: 11,
    },
    reportCard: {
        marginTop: 12,
        backgroundColor: COLORS.cardSoft,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#1F1F1F',
        padding: 14,
        gap: 6,
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
    closurePreviewPress: {
        borderRadius: 6,
        paddingVertical: 2,
    },
    closurePrintBtn: {
        marginTop: 8,
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
    fullscreenTicketBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.85)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    fullscreenTicketCard: {
        backgroundColor: COLORS.card,
        borderRadius: 16,
        width: '90%',
        maxWidth: 460,
        height: '85%',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#2A2A2A',
    },
    fullscreenTicketHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#1F1F1F',
    },
    fullscreenCloseBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#2A2A2A',
        alignItems: 'center',
        justifyContent: 'center',
    },
    fullscreenTicketScroll: {
        flex: 1,
        paddingHorizontal: 16,
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
    ticketPaymentEditBtn: {
        flex: 1,
        backgroundColor: '#17232F',
        borderWidth: 1,
        borderColor: '#2C5A7A',
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
    editionModeCard: {
        maxWidth: 520,
        gap: 10,
    },
    editionModeOption: {
        backgroundColor: COLORS.cardSoft,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#273127',
        paddingVertical: 14,
        paddingHorizontal: 14,
        gap: 4,
    },
    editionModeOptionMenu: {
        borderColor: COLORS.accent,
        backgroundColor: '#152018',
    },
    editionModeOptionTitle: {
        color: COLORS.text,
        fontWeight: '800',
        fontSize: 14,
    },
    editionModeOptionSub: {
        color: COLORS.muted,
        fontSize: 12,
        lineHeight: 17,
    },
    standbyCard: {
        width: '96%',
        maxWidth: 600,
        height: '75%',
        backgroundColor: COLORS.card,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#1F1F1F',
        gap: 10,
    },
    standbyHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    standbyBadge: {
        backgroundColor: COLORS.accent,
        borderRadius: 12,
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    standbyCloseBtn: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: '#2A2A2A',
        alignItems: 'center',
        justifyContent: 'center',
    },
    standbyList: {
        flex: 1,
        backgroundColor: COLORS.cardSoft,
        borderRadius: 12,
        padding: 10,
    },
    standbyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.card,
        borderRadius: 12,
        padding: 14,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#232323',
    },
    standbyActionBtn: {
        backgroundColor: COLORS.accent,
        borderRadius: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        alignItems: 'center',
    },
    standbyDeleteBtn: {
        backgroundColor: COLORS.danger,
        borderRadius: 8,
        paddingHorizontal: 14,
        paddingVertical: 8,
        alignItems: 'center',
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
    splitCard: {
        width: '96%',
        maxWidth: 960,
        height: '92%',
        backgroundColor: COLORS.card,
        borderRadius: 18,
        padding: 22,
        borderWidth: 1,
        borderColor: '#1F1F1F',
        gap: 12,
    },
    splitHeader: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 14,
    },
    splitHeaderTitle: {
        color: COLORS.text,
        fontWeight: '800',
        fontSize: 24,
        flex: 1,
    },
    splitTotalBadge: {
        backgroundColor: COLORS.accentSoft,
        borderRadius: 12,
        paddingHorizontal: 18,
        paddingVertical: 8,
        borderWidth: 1.5,
        borderColor: COLORS.accent,
    },
    splitTotalBadgeText: {
        color: COLORS.accent,
        fontWeight: '900',
        fontSize: 22,
    },
    splitCloseBtn: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: '#1A1A1A',
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        borderWidth: 1,
        borderColor: '#2A2A2A',
    },
    splitPartRow: {
        backgroundColor: COLORS.cardSoft,
        borderRadius: 14,
        padding: 16,
        borderWidth: 1,
        borderColor: '#1A1A1A',
        flexDirection: 'row' as const,
        gap: 16,
    },
    splitPartLabelRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 8,
    },
    splitPartLabel: {
        color: COLORS.muted,
        fontWeight: '700',
        fontSize: 13,
        flex: 1,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.5,
    },
    splitPartBadge: {
        backgroundColor: COLORS.accent,
        borderRadius: 10,
        width: 34,
        height: 34,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
    splitPartBadgeText: {
        color: '#000',
        fontWeight: '900',
        fontSize: 16,
    },
    splitDeleteBtn: {
        backgroundColor: 'rgba(216, 76, 76, 0.12)',
        borderRadius: 10,
        width: 40,
        height: 40,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
    splitDeleteBtnText: {
        fontSize: 18,
    },
    splitMethodGrid: {
        flexDirection: 'row' as const,
        flexWrap: 'wrap' as const,
        gap: 8,
    },
    splitMethodBtn: {
        backgroundColor: '#1A1A1A',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        borderWidth: 2,
        borderColor: '#252525',
        flexDirection: 'row' as const,
        gap: 6,
        minWidth: 120,
    },
    splitMethodBtnActive: {
        borderColor: COLORS.accent,
        backgroundColor: 'rgba(57, 255, 90, 0.10)',
    },
    splitMethodIcon: {
        fontSize: 20,
    },
    splitMethodLabel: {
        color: COLORS.muted,
        fontSize: 15,
        fontWeight: '700',
    },
    splitMethodLabelActive: {
        color: COLORS.accent,
    },
    splitAmountCol: {
        width: 200,
        gap: 8,
    },
    splitAmountLabel: {
        color: COLORS.muted,
        fontWeight: '700',
        fontSize: 12,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.5,
    },
    splitAmountInputWrap: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        backgroundColor: '#0D0D0D',
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: '#1F1F1F',
        paddingHorizontal: 16,
    },
    splitAmountInput: {
        flex: 1,
        color: COLORS.text,
        fontSize: 26,
        fontWeight: '800',
        paddingVertical: 12,
    },
    splitAmountSuffix: {
        color: COLORS.muted,
        fontSize: 26,
        fontWeight: '800',
    },
    splitAutoBtn: {
        backgroundColor: COLORS.accentSoft,
        borderRadius: 10,
        paddingVertical: 10,
        alignItems: 'center' as const,
        borderWidth: 1,
        borderColor: 'rgba(57, 255, 90, 0.2)',
    },
    splitAutoBtnText: {
        color: COLORS.accent,
        fontWeight: '700',
        fontSize: 13,
    },
    splitFooter: {
        gap: 10,
    },
    splitAddBtn: {
        borderWidth: 1.5,
        borderColor: '#2A2A2A',
        borderStyle: 'dashed' as const,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center' as const,
    },
    splitAddBtnText: {
        color: COLORS.muted,
        fontWeight: '700',
        fontSize: 16,
    },
    splitProgressWrap: {
        gap: 6,
    },
    splitProgressTrack: {
        height: 10,
        backgroundColor: '#1A1A1A',
        borderRadius: 5,
        overflow: 'hidden' as const,
    },
    splitProgressFill: {
        height: '100%' as const,
        backgroundColor: '#FFA726',
        borderRadius: 5,
    },
    splitProgressText: {
        color: COLORS.muted,
        fontWeight: '700',
        fontSize: 16,
        textAlign: 'center' as const,
    },
    splitActionRow: {
        flexDirection: 'row' as const,
        gap: 12,
    },
    splitCancelBtn: {
        flex: 1,
        backgroundColor: '#1A1A1A',
        borderRadius: 14,
        paddingVertical: 16,
        alignItems: 'center' as const,
        borderWidth: 1,
        borderColor: '#2A2A2A',
    },
    splitCancelBtnText: {
        color: COLORS.muted,
        fontWeight: '700',
        fontSize: 17,
    },
    splitValidateBtn: {
        flex: 2,
        backgroundColor: COLORS.accent,
        borderRadius: 14,
        paddingVertical: 16,
        alignItems: 'center' as const,
    },
    splitValidateBtnDisabled: {
        opacity: 0.35,
    },
    splitValidateBtnText: {
        color: '#000',
        fontWeight: '800',
        fontSize: 16,
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
