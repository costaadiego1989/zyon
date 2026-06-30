import type { MerchantTheme } from "@zyon/shared-types";

export type CartPanelItemModel = {
  sku: string;
  name: string;
  description?: string;
  variant?: string;
  imageUrl?: string;
  quantity: number;
  lineTotalLabel: string;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
};

export type CartHeaderModel = {
  merchantName: string;
  merchantInitials: string;
  logoUrl?: string;
  orderRef: string;
  journeyLabel: string;
  journeyHint: string;
  showDevReset: boolean;
  onClose: () => void;
  onDevReset: () => void;
};

export type CartPanelTotalsModel = {
  subtotalLabel: string;
  shippingLabel: string;
  discountLabel: string | null;
  serviceFeeLabel: string | null;
  totalLabel: string;
};

export type CartPanelModel = {
  open: boolean;
  busy: boolean;
  itemCount: number;
  items: CartPanelItemModel[];
  totals: CartPanelTotalsModel;
  emptyCartRedirectUrl?: string;
  header: CartHeaderModel;
};

export type CartFabModel = {
  visible: boolean;
  totalLabel: string;
  itemCount: number;
  onOpen: () => void;
};

export type CartOverlayModel = {
  open: boolean;
  onClose: () => void;
};
