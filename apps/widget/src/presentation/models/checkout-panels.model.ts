import type { ShippingQuote, SuggestedProduct } from "@aacp/shared-types";
import type { QuickReplyChoice } from "../../hooks/checkout-presentation.js";
import type { CouponBoxModel } from "./checkout-action-panels.model.js";
import type { CreditCardFormModel } from "./credit-card-form.model.js";
import type { CryptoPaymentPanelModel } from "./crypto-payment-panel.model.js";
import type { NetworkErrorModel } from "./checkout-action-panels.model.js";
import type { OfferBannerModel } from "./checkout-action-panels.model.js";
import type { PendingOfferBannerModel } from "./checkout-action-panels.model.js";

export type ShippingSelectorPanelModel = {
  options: ShippingQuote[];
  selectedMethod?: string;
  busy: boolean;
  onSelect: (option: ShippingQuote) => void | Promise<void>;
};

export type CatalogResultsPanelModel = {
  products: SuggestedProduct[];
  currency: string;
  onAdd: (product: SuggestedProduct) => Promise<boolean>;
};

export type CrossSellPanelModel = {
  products: SuggestedProduct[];
  currency: string;
  onAdd: (product: SuggestedProduct) => Promise<boolean>;
  onDismiss: () => void;
  onProceedToPayment: () => void;
};

export type QuickRepliesPanelModel = {
  items: QuickReplyChoice[];
  onTap: (reply: QuickReplyChoice) => void | Promise<void>;
  variant: "thread" | "voice";
  disabled?: boolean;
};

export type CheckoutPanelsModel = {
  networkError: NetworkErrorModel | null;
  offerBanner: OfferBannerModel | null;
  pendingOffer: PendingOfferBannerModel | null;
  couponBox: CouponBoxModel | null;
  shipping: ShippingSelectorPanelModel | null;
  catalogResults: CatalogResultsPanelModel | null;
  crossSell: CrossSellPanelModel | null;
  creditCardForm: CreditCardFormModel | null;
  cryptoPanel: CryptoPaymentPanelModel | null;
  quickReplies: QuickRepliesPanelModel | null;
};
