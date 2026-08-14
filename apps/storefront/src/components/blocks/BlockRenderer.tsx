"use client";

import type { ConversationBlock } from "@/lib/types.js";
import ProductCardBlock from "./ProductCardBlock.js";
import ProductCarouselBlock from "./ProductCarouselBlock.js";
import ComparisonTableBlock from "./ComparisonTableBlock.js";
import CartSummaryBlock from "./CartSummaryBlock.js";
import ShippingOptionsBlock from "./ShippingOptionsBlock.js";
import QuickRepliesBlock from "./QuickRepliesBlock.js";
import CheckoutRedirectBlock from "./CheckoutRedirectBlock.js";
import OrderConfirmationBlock from "./OrderConfirmationBlock.js";

export default function BlockRenderer({
  block,
  onQuickReply,
}: {
  block: ConversationBlock;
  onQuickReply?: (option: string) => void;
}) {
  switch (block.type) {
    case "product_card":
      return <ProductCardBlock block={block} />;
    case "product_carousel":
      return <ProductCarouselBlock block={block} />;
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
    default:
      return null;
  }
}
