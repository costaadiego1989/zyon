export interface Product {
  id: string;
  title: string;
  subtitle: string;
  price: number;
  tags: string[];
}

export interface Bundle {
  id: string;
  title: string;
  subtitle: string;
  price: number;
  was: number;
}

export interface Coupon {
  code: string;
  amount: number;
  label: string;
  displayAmount?: number;
  totalPercent?: number;
  appliedPercent?: number;
  pendingPercent?: number;
  pendingCode?: string;
  pendingAmount?: number;
  urgencyMinutes?: number;
}

export interface ShippingOption {
  key: string;
  label: string;
  tag: string;
  sub: string;
  cost: number;
}

export interface Order {
  store: string;
  region: string;
  items: string;
  amount: string;
  tone: 'done' | 'progress';
  status: string;
  initial: string;
  bg: string;
}

export interface Cart {
  product: Product | null;
  qty: number;
  bundle: Bundle | null;
  coupon: Coupon | null;
  shipping: ShippingOption | null;
  payMethod: PayMethod | null;
}

export type PayMethod = 'pix' | 'credito' | 'debito' | 'crypto';

export interface Customer {
  name: string;
  email: string;
  cpf: string;
  cep: string;
  number: string;
  complement: string;
  phone: string;
}

export interface Prefs {
  currency: string;
  lang: string;
  notifPromo: boolean;
  notifStatus: boolean;
  notifPush: boolean;
  twoFA: boolean;
  faceUnlock: boolean;
  defaultPay: string;
}

export interface ChatMessage {
  role: 'agent' | 'user';
  kind: string;
  text?: string;
  field?: string;
  method?: PayMethod;
  subline?: string;
  orderId?: string;
  installments?: boolean;
}

export interface ThemeTokens {
  bg: string;
  tx: string;
  mut: string;
  card: string;
  bd: string;
  chip: string;
  sheet: string;
  sheetbd: string;
  dot: string;
  g1: string;
  g2: string;
  g3: string;
  tile1: string;
  tile2: string;
  scrim: string;
  userTx: string;
  shadow: string;
}

export interface TenantDiscount {
  initialPercent?: number;
  bonusPercent?: number;
  urgencyMinutes?: number;
  code?: string;
}

export interface CheckoutProps {
  storeName?: string;
  agentName?: string;
  theme?: 'dark' | 'light';
  faceLogin?: boolean;
  voiceEnabled?: boolean;
  supportFab?: boolean;
  discount?: TenantDiscount;
  accentColor?: string;
  // Native checkout header wiring
  storeUrl?: string;
  merchantLogoUrl?: string;
  // Real API wiring (injected from widget host)
  apiBaseUrl?: string;
  merchantId?: string;
  sessionToken?: string;
  sessionId?: string;
  initialCart?: { product: Product; qty: number };
  initialCustomer?: Partial<Customer>;
  privacyUrl?: string;
  allowDemoFallbacks?: boolean;
  cartRef?: string;
}

export interface PulseAPIConfig {
  storeName?: string;
  agentName?: string;
  currency?: string;
  baseUrl?: string;
  discount?: TenantDiscount;
  // Real API wiring
  merchantId?: string;
  sessionToken?: string;
  sessionId?: string;
  initialCart?: { product: Product; qty: number };
  initialCustomer?: Partial<Customer>;
  allowDemoFallbacks?: boolean;
  cartRef?: string;
}

export interface FaceUser {
  id: string;
  name: string;
  email: string;
  initial: string;
  verified: boolean;
}
