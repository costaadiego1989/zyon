import type { CryptoBuyerFacingQuote } from "../../hooks/crypto-payment.types.js";

export type CryptoPaymentPanelModel = {
  intentId: string;
  orderTotalLabel: string | null;
  quote: CryptoBuyerFacingQuote;
  expired: boolean;
  onConfirmPayment: (intentId: string, txHashes: string[], walletAddress: string) => Promise<void>;
  onClose: () => void;
};
