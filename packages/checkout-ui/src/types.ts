/** Display metadata compatible with shared CommercialNotice; this UI package
 * deliberately has no dependency on application or economics packages. */
export interface CommercialNoticeData {
  version: 1;
  code: "discount_limit_reached" | "discount_limited" | "discount_unavailable" | "benefit_not_combinable" | "benefit_conditions_not_met";
  message: string;
}

export interface CartItemData {
  selectionLabel?: string;
  optionItemIds?: string[];
  serviceSlotId?: string | null;
  variantId: string;
  productName: string;
  quantity: number;
  price: number;
  subtotal: number;
  image?: string;
}

export interface CartState {
  cartId: string | null;
  items: CartItemData[];
  itemCount: number;
  subtotal: number;
  discount: number;
  total: number;
  commercialNotices?: CommercialNoticeData[];
}

export interface CartSheetProps {
  open: boolean;
  updating?: boolean;
  error?: string | null;
  cart: CartState;
  mode?: "checkout" | "budget";
  onClose: () => void;
  onCheckout: () => void;
  onBudgetSubmit?: (data: { customerName: string; customerEmail: string; customerPhone: string; note?: string }) => void;
  onUpdateQty: (variantId: string, quantity: number, selection?: CartLineSelection) => void;
  onRemoveItem: (variantId: string, selection?: CartLineSelection) => void;
}

export interface CartLineSelection { optionItemIds?: string[]; serviceSlotId?: string | null }

export interface CartFABProps {
  itemCount: number;
  total: number;
  onClick: () => void;
}
