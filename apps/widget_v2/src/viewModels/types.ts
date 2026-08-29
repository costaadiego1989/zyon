export interface Message {
  id: string;
  role: "user" | "agent" | "merchant";
  text: string;
  agentName?: string;
  timestamp?: number;
}

export interface SupportMessage extends Message {}

export interface FaqItem {
  id?: string;
  icon?: string;
  question: string;
  answer: string;
}

export type CryptoStep = "idle" | "connecting" | "connected" | "confirming" | "confirmed";

export interface ChatViewModelInterface {
  messages: Message[];
  input: string;
  loading: boolean;
  error: string | null;
  currentStep: CryptoStep;
  wallet: string;

  setInput: (text: string) => void;
  sendMessage: (text: string) => Promise<void>;
  clearHistory: () => void;

  connectWallet: (chain: string) => Promise<void>;
  confirmCryptoPayment: (txHash: string) => Promise<void>;
  disconnectWallet: () => void;

  canSend: boolean;
  isProcessing: boolean;
}

export interface SupportViewModelInterface {
  messages: SupportMessage[];
  input: string;
  loading: boolean;
  view: "welcome" | "chat";
  faqItems: FaqItem[];
  ticketId: string | null;
  error: string | null;

  loadFaq: () => Promise<void>;
  setInput: (text: string) => void;
  sendMessage: (text: string, isFaqClick?: boolean) => Promise<void>;
  switchToChat: () => void;
  switchToWelcome: () => void;

  hasTicket: boolean;
}

export interface PaymentViewModelInterface {
  processing: boolean;
  error: string | null;
  success: boolean;

  confirmStripePayment: (paymentMethodId: string) => Promise<void>;
  confirmPixPayment: (pixKey: string) => Promise<void>;
  reset: () => void;
}
