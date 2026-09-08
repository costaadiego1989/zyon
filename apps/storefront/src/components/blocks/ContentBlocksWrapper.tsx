/**
 * ContentBlocksWrapper
 *
 * Server component. Fetches the public, flag-gated `product_content` payload
 * for one (slug, productId) pair, then flattens each block's `props` into
 * the shape consumed by `ProductContentRenderer`.
 *
 * Rendering rules:
 *  - When `fetchProductContent` returns null (merchant lacks flag, product
 *    404, network down) we render NOTHING. The chat shell underneath still
 *    shows the legacy ProductCardBlock fallback automatically.
 *  - When the payload is present but `blocks.length === 0` we ALSO render
 *    nothing. An empty carousel of paragraph blocks is not a useful surface.
 *  - When the payload is present and non-empty we mount the existing
 *    `ProductContentRenderer` (client component) inside an `<article>` shell
 *    that mirrors the chat-shell width.
 *
 * The component is server-rendered, so the block tree reaches the browser in
 * HTML — no client JS is needed unless an interactive sub-block (FAQ
 * accordion, video player, carousel) requests it.
 */

import "server-only";

import { fetchProductContent } from "@/lib/api/product-content";
import RichProductContentRenderer from "./RichProductContentRenderer";
import { flattenProductContentBlocks } from "./product-content-normalizer";

type Props = {
  slug: string;
  productId: string;
  /** Optional override — used by tests / fixtures. */
  productName?: string;
  shareUrl?: string;
};

export default async function ContentBlocksWrapper({ slug, productId, productName, shareUrl }: Props) {
  const content = await fetchProductContent(slug, productId);

  if (!content) {
    return null;
  }

  const blocks = flattenProductContentBlocks(content);

  if (!content.purchase && blocks.length === 0 && content.faqs.length === 0 && content.testimonials.length === 0 && content.videos.length === 0) {
    return null;
  }

  return (
    <article
      aria-label={productName ? `Conteúdo rico do produto ${productName}` : "Conteúdo rico do produto"}
      data-aacp-product-content
      data-product-id={content.productId ?? productId}
      style={{
        width: "100%",
        minWidth: 0,
        background: "var(--aacp-surface, transparent)",
        color: "var(--aacp-fg)",
        fontFamily: "var(--aacp-font)",
        boxSizing: "border-box",
      }}
    >
      <RichProductContentRenderer
        blocks={blocks}
        faqs={content.faqs}
        testimonials={content.testimonials}
        videos={content.videos}
        purchase={content.purchase}
        embedded={false}
        shareUrl={shareUrl}
      />
    </article>
  );
}
