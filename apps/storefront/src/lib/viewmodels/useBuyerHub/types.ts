import type { ValidBuyer } from "@/lib/buyer-auth";

export interface BuyerProfile {
  global_user_id: string;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  cpf?: string | null;
  address?: BuyerAddress | null;
}

export interface BuyerAddress {
  id: string;
  zip: string;
  street: string;
  number: string;
  complement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
  is_default?: boolean;
  created_at?: string;
}

export interface TrackingEvent {
  status: string;
  description?: string;
  location?: string;
  occurred_at: string;
}

export interface PurchaseItem {
  name: string;
  quantity: number;
  unit_price: number;
}

export interface BuyerPurchase {
  id: string;
  order_id: string;
  merchant_name: string;
  tracking_code?: string | null;
  tracking_status?: string | null;
  tracking_url?: string | null;
  carrier?: string | null;
  tracking_events?: TrackingEvent[];
  total: number;
  discount_amount?: number;
  items: PurchaseItem[];
  items_count: number;
  currency: string;
  created_at: string;
  payment_method?: string | null;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "agent" | "assistant" | "system";
  content: string;
  created_at: string;
  rating?: "up" | "down" | null;
}

export interface BuyerConversation {
  id: string;
  session_id: string;
  merchant_id: string;
  started_at: string;
  last_message_at: string;
  messages: ConversationMessage[];
}

export interface BuyerPreferences {
  email_opt_in: boolean;
  sms_opt_in: boolean;
  whatsapp_opt_in: boolean;
  push_notifications_enabled: boolean;
  m2m_negotiation_enabled: boolean;
  language: string;
}

export interface BuyerLoyalty {
  total_orders: number;
  total_spent_cents: number;
  avg_order_value_cents: number;
  top_categories: string[];
  preferred_brands: string[];
  discount_sensitivity?: string | null;
  last_purchase_at?: string | null;
}

export interface DiscountRule {
  id: string;
  code: string;
  discount_type: "percent" | "fixed" | "shipping_free" | "shipping_percent" | "shipping_fixed";
  discount_value: number;
  min_cart_total: number | null;
  max_usages: number | null;
  usages_count: number;
}

export interface BuyerSummary {
  orders_count: number;
  total_spent: number;
  average_ticket: number;
  currency: string;
}

export interface BuyerReview {
  id: string;
  product_name: string;
  rating: number;
  body?: string;
  status: string;
  created_at: string;
}

export interface BuyerIntentProfile {
  has_consent: boolean;
  primary_intent?: string | null;
  category_focus?: string[];
  budget_tier?: string | null;
  conversion_likelihood?: number | null;
}

export interface AvailableBenefit {
  id: string;
  name: string;
  description: string;
  condition: string;
}

export interface EarnedBenefit {
  id: string;
  name: string;
  description: string;
  origin: string;
}

export interface BenefitProgress {
  id: string;
  name: string;
  description: string;
  current_value: number;
  target_value: number;
  remaining_value?: number;
}

export interface BuyerBenefits {
  available: AvailableBenefit[];
  earned: EarnedBenefit[];
  progress: BenefitProgress[];
}

export interface PurchasePage {
  items: BuyerPurchase[];
  next_cursor: string | null;
}

export type TabType =
  | "profile"
  | "orders"
  | "tracking"
  | "conversations"
  | "preferences"
  | "loyalty"
  | "settings";

export interface SectionState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface UseBuyerHub {
  auth: ValidBuyer | null;
  signOut: () => void;

  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;

  profile: SectionState<BuyerProfile>;
  loadProfile: () => Promise<void>;
  updateProfile: (patch: Partial<BuyerProfile>) => Promise<void>;

  addresses: SectionState<BuyerAddress[]>;
  loadAddresses: () => Promise<void>;
  createAddress: (input: Omit<BuyerAddress, "id" | "created_at">) => Promise<BuyerAddress>;
  updateAddress: (id: string, input: Omit<BuyerAddress, "id" | "created_at">) => Promise<BuyerAddress>;
  deleteAddress: (id: string) => Promise<void>;

  purchases: SectionState<BuyerPurchase[]>;
  purchasesCursor: string | null;
  purchasesHasMore: boolean;
  loadPurchases: (reset?: boolean) => Promise<void>;
  loadMorePurchases: () => Promise<void>;
  summary: SectionState<BuyerSummary>;

  tracking: SectionState<BuyerPurchase[]>;
  loadTracking: () => Promise<void>;

  conversations: SectionState<BuyerConversation[]>;
  loadConversations: () => Promise<void>;
  rateMessage: (conversationId: string, messageId: string, rating: "up" | "down") => Promise<void>;

  preferences: SectionState<BuyerPreferences>;
  loadPreferences: () => Promise<void>;
  updatePreferences: (patch: Partial<BuyerPreferences>) => Promise<void>;

  loyalty: SectionState<BuyerLoyalty>;
  loadLoyalty: () => Promise<void>;

  benefits: SectionState<BuyerBenefits>;
  loadBenefits: () => Promise<void>;

  discountRules: SectionState<DiscountRule[]>;
  loadDiscountRules: (merchantSlug: string) => Promise<void>;

  reviews: SectionState<BuyerReview[]>;
  loadReviews: () => Promise<void>;

  intentProfile: SectionState<BuyerIntentProfile>;
  loadIntentProfile: () => Promise<void>;
  exportData: () => Promise<void>;
  deleteAccount: () => Promise<{ deleted: boolean; anonymized_purchases: number } | null>;

  refresh: () => Promise<void>;
}
