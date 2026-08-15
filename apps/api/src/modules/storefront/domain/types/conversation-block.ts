/**
 * Conversation block types for structured UI rendering in storefront.
 *
 * Blocks allow the agent to return rich, renderable content alongside text messages:
 * product cards, carousels, shipping options, quick replies, etc.
 */

export interface ProductCardBlock {
  type: "product_card";
  data: {
    id: string;
    name: string;
    price: number;
    priceFormatted: string;
    image?: string;
    variants?: Array<{ id: string; name: string; value: string }>;
    inStock: boolean;
    rating?: number;
    reviewCount?: number;
  };
}

export interface ProductCarouselBlock {
  type: "product_carousel";
  data: {
    products: ProductCardBlock["data"][];
    nextCursor?: string;
    merchantId?: string;
    query?: string;
    categoryId?: string;
  };
}

export interface ComparisonTableBlock {
  type: "comparison_table";
  data: {
    products: Array<{
      id: string;
      name: string;
      price: number;
      attributes: Record<string, string>;
      stock: number;
      rating?: number;
    }>;
    attributes: string[];
  };
}

export interface CartSummaryBlock {
  type: "cart_summary";
  data: {
    items: Array<{
      variantId: string;
      productName: string;
      quantity: number;
      price: number;
      subtotal: number;
    }>;
    itemCount: number;
    subtotal: number;
    discount?: number;
    total: number;
  };
}

export interface ShippingOptionsBlock {
  type: "shipping_options";
  data: {
    options: Array<{
      carrier: string;
      name: string;
      price: number;
      priceFormatted: string;
      days: number;
    }>;
  };
}

export interface QuickRepliesBlock {
  type: "quick_replies";
  data: {
    options: string[];
  };
}

export interface CheckoutRedirectBlock {
  type: "checkout_redirect";
  data: {
    url: string;
    sessionId: string;
  };
}

export interface OrderConfirmationBlock {
  type: "order_confirmation";
  data: {
    orderId: string;
    total: number;
    items: Array<{ productName: string; quantity: number; price: number }>;
    estimatedDelivery?: string;
  };
}

export type ConversationBlock =
  | ProductCardBlock
  | ProductCarouselBlock
  | ComparisonTableBlock
  | CartSummaryBlock
  | ShippingOptionsBlock
  | QuickRepliesBlock
  | CheckoutRedirectBlock
  | OrderConfirmationBlock;
