"use client";

import type { CSSProperties } from "react";

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
import { CustomerReviewSubmission } from "./CustomerReviewSubmission";

export type ProductContentSupplementalFaq = {
  id: string;
  question: string;
  answer: string;
  order: number;
};

export type ProductContentSupplementalTestimonial = {
  id: string;
  authorName: string;
  body: string;
  rating?: number | null;
};

export type ProductContentSupplementalVideo = {
  id: string;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
};

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
  faqs = [],
  testimonials = [],
  videos = [],
  onCtaClick,
  merchantSlug,
  productId,
  productName,
}: {
  blocks: ProductContentBlockType[];
  faqs?: ProductContentSupplementalFaq[];
  testimonials?: ProductContentSupplementalTestimonial[];
  videos?: ProductContentSupplementalVideo[];
  onCtaClick?: (href: string) => void;
  merchantSlug?: string;
  productId?: string;
  productName?: string;
}) {
  if (!blocks || (blocks.length === 0 && faqs.length === 0 && testimonials.length === 0 && videos.length === 0 && !productId)) return null;

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
      <ProductContentSupplementalSections
        faqs={faqs}
        testimonials={testimonials}
        videos={videos}
        merchantSlug={merchantSlug}
        productId={productId}
        productName={productName}
      />
    </div>
  );
}

function ProductContentSupplementalSections({
  faqs,
  testimonials,
  videos,
  merchantSlug,
  productId,
  productName,
}: {
  faqs: ProductContentSupplementalFaq[];
  testimonials: ProductContentSupplementalTestimonial[];
  videos: ProductContentSupplementalVideo[];
  merchantSlug?: string;
  productId?: string;
  productName?: string;
}) {
  const faqItems = faqs
    .filter((faq) => typeof faq.question === "string" && faq.question.trim() && typeof faq.answer === "string" && faq.answer.trim())
    .sort((a, b) => a.order - b.order)
    .map((faq) => ({ question: faq.question, answer: faq.answer }));
  const approvedTestimonials = testimonials.filter(
    (item) => typeof item.authorName === "string" && item.authorName.trim() && typeof item.body === "string" && item.body.trim(),
  );
  const playableVideos = videos.flatMap((video) => toVideoBlock(video));

  return (
    <>
      {faqItems.length > 0 ? (
        <section aria-labelledby="product-content-faq-heading">
          <h2 id="product-content-faq-heading" style={sectionHeadingStyle}>Perguntas frequentes</h2>
          <FaqBlock block={{ id: "product-content-faqs", type: "faq", order: Number.MAX_SAFE_INTEGER - 2, items: faqItems }} />
        </section>
      ) : null}
      {approvedTestimonials.length > 0 ? (
        <section aria-labelledby="product-content-reviews-heading">
          <h2 id="product-content-reviews-heading" style={sectionHeadingStyle}>Avaliações de clientes</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: "24px", margin: "10px 0 14px" }}>
            {approvedTestimonials.map((item) => (
              <figure key={item.id} style={{ margin: 0, padding: "6px 0 18px", background: "var(--aacp-surface)" }}>
                {typeof item.rating === "number" && item.rating >= 1 && item.rating <= 5 ? (
                  <div aria-label={`${item.rating} de 5 estrelas`} style={{ color: "var(--aacp-accent)", letterSpacing: "0.08em", fontSize: "13px" }}>{"★".repeat(item.rating)}{"☆".repeat(5 - item.rating)}</div>
                ) : null}
                <blockquote style={{ margin: "8px 0", color: "var(--aacp-fg)", fontSize: "14px", lineHeight: 1.55 }}>&ldquo;{item.body}&rdquo;</blockquote>
                <figcaption style={{ color: "var(--aacp-muted)", fontSize: "12.5px", fontWeight: 600 }}>{item.authorName}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}
      {playableVideos.length > 0 ? (
        <section aria-labelledby="product-content-videos-heading">
          <h2 id="product-content-videos-heading" style={sectionHeadingStyle}>O produto em vídeo</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: "24px" }}>
            {playableVideos.map((block) => <VideoBlock key={block.id} block={block} />)}
          </div>
        </section>
      ) : null}
      <CustomerReviewSubmission merchantSlug={merchantSlug} productId={productId} productName={productName} />
    </>
  );
}

const sectionHeadingStyle: CSSProperties = {
  margin: "24px 0 2px",
  color: "var(--aacp-fg)",
  fontSize: "18px",
  lineHeight: 1.3,
};

function toVideoBlock(video: ProductContentSupplementalVideo): Extract<ProductContentBlockType, { type: "video" }>[] {
  if (!video || typeof video.id !== "string" || typeof video.title !== "string" || typeof video.videoUrl !== "string") return [];
  try {
    const url = new URL(video.videoUrl);
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be" || host === "www.youtu.be") {
      const ref = url.pathname.split("/").filter(Boolean)[0];
      return ref ? [{ id: `submitted-video-${video.id}`, type: "video", order: 0, provider: "youtube", ref, caption: video.title, thumbnailUrl: video.thumbnailUrl ?? undefined }] : [];
    }
    if (host === "youtube.com" || host === "www.youtube.com") {
      const ref = url.searchParams.get("v") ?? url.pathname.split("/").filter(Boolean).find((part) => part !== "embed" && part !== "shorts");
      return ref ? [{ id: `submitted-video-${video.id}`, type: "video", order: 0, provider: "youtube", ref, caption: video.title, thumbnailUrl: video.thumbnailUrl ?? undefined }] : [];
    }
    if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
      const ref = [...url.pathname.split("/").filter(Boolean)].reverse().find((part) => /^\d+$/.test(part));
      return ref ? [{ id: `submitted-video-${video.id}`, type: "video", order: 0, provider: "vimeo", ref, caption: video.title, thumbnailUrl: video.thumbnailUrl ?? undefined }] : [];
    }
    if (url.protocol === "https:" && /\.mp4(?:$|[?#])/i.test(url.pathname + url.search)) {
      return [{ id: `submitted-video-${video.id}`, type: "video", order: 0, provider: "mp4", ref: url.toString(), caption: video.title, thumbnailUrl: video.thumbnailUrl ?? undefined }];
    }
  } catch {
    return [];
  }
  return [];
}
