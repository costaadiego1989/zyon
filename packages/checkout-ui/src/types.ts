export interface CartItemData {
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
}

export interface CartSheetProps {
  open: boolean;
  cart: CartState;
  onClose: () => void;
  onCheckout: () => void;
  onUpdateQty: (variantId: string, quantity: number) => void;
  onRemoveItem: (variantId: string) => void;
}

export interface CartFABProps {
  itemCount: number;
  total: number;
  onClick: () => void;
}
