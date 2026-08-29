export type Message = {
  id: string;
  role: "user" | "agent";
  text?: string;
  blocks?: any[];
};

export type Channel = "chat" | "voice";
export type Theme = "dark" | "light";
export type Mode = "intro" | "chat";

export interface ConversationViewModelProps {
  storeName: string;
  merchantId?: string;
  merchantSlug?: string;
  agentName?: string;
  agentGreeting?: string;
  quickReplies?: string[];
  returnOrderId?: string;
  themeMode?: "dark" | "light" | "grey";
  agentMode?: "silent_until_trigger" | "proactive" | "manual_only";
  agentInitialDelaySeconds?: number;
}

export interface ConversationViewModelState {
  mode: Mode;
  channel: Channel | null;
  theme: Theme;
  messages: Message[];
  input: string;
  isLoading: boolean;
  listening: boolean;
  conversationId: string | null;
  supportOpen: boolean;
  buyerHubOpen: boolean;
  cartDrawerForceOpen: boolean;
  showBuyerAuth: boolean;
  checkoutIntent: string | null;
  policyModal: { title: string; content: string } | null;
  crossSellPending: CrossSellInterstitialData | null;
}

export interface CrossSellInterstitialData {
  trigger: string;
  products: Array<{
    id: string;
    name: string;
    price: number;
    priceFormatted: string;
    image?: string;
    inStock: boolean;
    discountPercent?: number;
  }>;
}

export interface ConversationViewModelActions {
  selectChannel: (ch: Channel) => void;
  toggleChannel: () => void;
  toggleTheme: () => void;
  sendMessage: (text: string) => Promise<void>;
  handleQuickReply: (option: string) => void;
  handleUpdateQuantity: (variantId: string, quantity: number) => void;
  setInput: (value: string) => void;
  setSupportOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setBuyerHubOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setShowBuyerAuth: (value: boolean) => void;
  setCheckoutIntent: (value: string | null) => void;
  setPolicyModal: (value: { title: string; content: string } | null) => void;
  setCartDrawerForceOpen: (value: boolean) => void;
  dismissCrossSell: () => void;
  startListening: () => void;
  stopListening: () => void;
}
