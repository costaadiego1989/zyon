export type NetworkErrorModel = {
  message: string;
  onRetry: () => void;
};

export type CouponBoxModel = {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
};

export type OfferBannerModel = {
  discountLabel: string;
  orderTotalLabel: string;
  shippingLabel: string | null;
  busy: boolean;
  onContinue: () => void | Promise<void>;
};

export type PendingOfferBannerModel = {
  savingsLabel: string;
  busy: boolean;
  onApply: () => void | Promise<void>;
};
