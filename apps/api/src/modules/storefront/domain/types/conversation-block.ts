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
    description?: string;
    price: number;
    priceFormatted: string;
    image?: string;
    variants?: Array<{ id: string; name: string; value: string }>;
    inStock: boolean;
    rating?: number;
    reviewCount?: number;
    originalPrice?: number;
    originalPriceFormatted?: string;
    discountPercent?: number;
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
    cartId?: string;
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

export interface ShippingQuoteInputBlock {
  type: "shipping_quote_input";
  data: { productName: string; productId: string };
}

export interface VariantSelectorBlock {
  type: "variant_selector";
  data: {
    productId: string;
    productName: string;
    groups: Array<{
      name: string;
      options: Array<{ id: string; value: string; available: boolean }>;
    }>;
  };
}

export interface ProductComparisonBlock {
  type: "product_comparison";
  data: {
    products: Array<{
      id: string;
      name: string;
      price: number;
      priceFormatted: string;
      rating?: number;
      inStock: boolean;
      attributes: Record<string, string>;
    }>;
  };
}

export interface ReviewsBlock {
  type: "reviews";
  data: {
    productId: string;
    productName: string;
    averageRating: number;
    totalReviews: number;
    reviews: Array<{
      id: string;
      author: string;
      rating: number;
      text: string;
      date: string;
    }>;
    nextCursor?: string;
  };
}

export interface AddReviewBlock {
  type: "add_review";
  data: { productId: string; productName: string };
}

export interface CrossSellBlock {
  type: "cross_sell";
  data: {
    trigger: string;
    products: Array<{
      id: string;
      name: string;
      price: number;
      priceFormatted: string;
      image?: string;
      inStock: boolean;
    }>;
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
  | OrderConfirmationBlock
  | ShippingQuoteInputBlock
  | VariantSelectorBlock
  | ProductComparisonBlock
  | ReviewsBlock
  | AddReviewBlock
  | CrossSellBlock;
