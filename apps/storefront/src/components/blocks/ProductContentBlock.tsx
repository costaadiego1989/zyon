"use client";

import type { ConversationBlock } from "@/lib/types";
import ProductContentRenderer from "./ProductContentRenderer";
import type { ProductContentBlock as ProductContentBlockType } from "./ContentBlocks";

/**
 * Thin wrapper that lets `BlockRenderer` stay flat. Receives the full
 * conversation-block shape and forwards the typed sub-block array to the
 * dispatcher renderer.
 */
export default function ProductContentBlock({
  block,
  onQuickReply,
}: {
  block: ConversationBlock & { type: "product_content" };
  onQuickReply?: (option: string) => void;
}) {
  const data = block.data as unknown as {
    productId: string;
    blocks: ProductContentBlockType[];
  };

  if (!data?.blocks || data.blocks.length === 0) return null;

  const onCtaClick = (href: string) => {
    if (onQuickReply) onQuickReply(href);
  };

  return (
    <section
      aria-label={`Conteudo do produto`}
      style={{
        width: "100%",
        minWidth: 0,
        padding: "0",
      }}
    >
      <ProductContentRenderer blocks={data.blocks} onCtaClick={onCtaClick} />
    </section>
  );
}
