"use client";

import type { ConversationBlock } from "@/lib/types";
import ProductCardBlock from "./ProductCardBlock";
import ProductCarouselBlock from "./ProductCarouselBlock";
import ComparisonTableBlock from "./ComparisonTableBlock";
import CartSummaryBlock from "./CartSummaryBlock";
import ShippingOptionsBlock from "./ShippingOptionsBlock";
import QuickRepliesBlock from "./QuickRepliesBlock";
import CheckoutRedirectBlock from "./CheckoutRedirectBlock";
import OrderConfirmationBlock from "./OrderConfirmationBlock";
import ReviewsBlock from "./ReviewsBlock";
import AddReviewBlock from "./AddReviewBlock";
import CrossSellBlock from "./CrossSellBlock";
import ShippingQuoteBlock from "./ShippingQuoteBlock";
import VariantSelectorBlock from "./VariantSelectorBlock";
import ProductComparisonBlock from "./ProductComparisonBlock";
import CategoryCarouselBlock from "./CategoryCarouselBlock";

export default function BlockRenderer({
  block,
  onQuickReply,
}: {
  block: ConversationBlock;
  onQuickReply?: (option: string) => void;
}) {
  switch (block.type) {
    case "product_card":
      return <ProductCardBlock block={block} onQuickReply={onQuickReply} />;
    case "product_carousel":
      return <ProductCarouselBlock block={block} onQuickReply={onQuickReply} />;
    case "comparison_table":
      return <ComparisonTableBlock block={block} />;
    case "cart_summary":
      return <CartSummaryBlock block={block} />;
    case "shipping_options":
      return <ShippingOptionsBlock block={block} />;
    case "quick_replies":
      return <QuickRepliesBlock block={block} onSelect={onQuickReply} />;
    case "checkout_redirect":
      return <CheckoutRedirectBlock block={block} />;
    case "order_confirmation":
      return <OrderConfirmationBlock block={block} />;
    case "shipping_quote_input":
      return <ShippingQuoteBlock block={block} onQuickReply={onQuickReply} />;
    case "variant_selector":
      return <VariantSelectorBlock block={block} onQuickReply={onQuickReply} />;
    case "product_comparison":
      return <ProductComparisonBlock block={block} onQuickReply={onQuickReply} />;
    case "reviews":
      return <ReviewsBlock block={block} onQuickReply={onQuickReply} />;
    case "add_review":
      return <AddReviewBlock block={block} onQuickReply={onQuickReply} />;
    case "cross_sell":
      return <CrossSellBlock block={block} onQuickReply={onQuickReply} />;
    case "category_carousel":
      return <CategoryCarouselBlock block={block as any} onQuickReply={onQuickReply} />;
    default:
      return null;
  }
}
