"use client";

import {
  ParagraphBlock,
  HeadingBlock,
  ListBlock,
  ImageBlock,
  ImageTextSplitBlock,
  CalloutBlock,
  TableBlock,
  FaqBlock,
  VideoBlock,
  CarouselBlock,
  BannerBlock,
  ButtonBlock,
  type ProductContentBlock as ProductContentBlockType,
} from "./ContentBlocks";

/**
 * Dispatches a list of product-content sub-blocks to the right renderer.
 * Pure, no innerHTML — every text field becomes a React text child.
 *
 * `onCtaClick` is invoked for ButtonBlock + BannerBlock CTAs; when omitted,
 * the browser handles navigation via the anchor's href (subject to client-side
 * URL safety checks in the individual block components).
 */
export default function ProductContentRenderer({
  blocks,
  onCtaClick,
}: {
  blocks: ProductContentBlockType[];
  onCtaClick?: (href: string) => void;
}) {
  if (!blocks || blocks.length === 0) return null;

  // Sort defensively by `order` in case the producer forgot to.
  const sorted = [...blocks].sort((a, b) => a.order - b.order);

  return (
    <div
      className="aacp-product-content"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        width: "100%",
        minWidth: 0,
        fontFamily: "var(--aacp-font)",
      }}
    >
      {sorted.map((block) => {
        switch (block.type) {
          case "paragraph":
            return <ParagraphBlock key={block.id} block={block} />;
          case "heading":
            return <HeadingBlock key={block.id} block={block} />;
          case "list":
            return <ListBlock key={block.id} block={block} />;
          case "image":
            return <ImageBlock key={block.id} block={block} />;
          case "image_text_split":
            return <ImageTextSplitBlock key={block.id} block={block} />;
          case "callout":
            return <CalloutBlock key={block.id} block={block} />;
          case "table":
            return <TableBlock key={block.id} block={block} />;
          case "faq":
            return <FaqBlock key={block.id} block={block} />;
          case "video":
            return <VideoBlock key={block.id} block={block} />;
          case "carousel":
            return <CarouselBlock key={block.id} block={block} />;
          case "banner":
            return <BannerBlock key={block.id} block={block} onCtaClick={onCtaClick} />;
          case "button":
            return <ButtonBlock key={block.id} block={block} onCtaClick={onCtaClick} />;
          default: {
            // Exhaustiveness: unreachable as long as the union stays in sync.
            const _exhaustive: never = block;
            void _exhaustive;
            return null;
          }
        }
      })}
    </div>
  );
}
