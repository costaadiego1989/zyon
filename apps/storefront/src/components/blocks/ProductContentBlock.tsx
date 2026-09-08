"use client";

import { useEffect, useState } from "react";
import type { ConversationBlock } from "@/lib/types";
import type { PublicProductContent, ProductContentPurchaseResponse } from "@/lib/api/product-content";
import ProductContentRenderer from "./ProductContentRenderer";
import RichProductContentRenderer from "./RichProductContentRenderer";
import { flattenProductContentBlocks } from "./product-content-normalizer";
import type { ProductContentBlock as ProductContentBlockType } from "./ContentBlocks";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
const CATALOG_ID = /^[A-Za-z0-9_-]{1,191}$/;

type ProductContentData = {
  productId?: unknown;
  blocks?: unknown;
};

function readPublicContent(body: unknown, fallbackProductId: string): PublicProductContent | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (!Array.isArray(value.blocks)) return null;

  const rawPurchase = value.purchase;
  const purchase = rawPurchase && typeof rawPurchase === "object"
    ? rawPurchase as Record<string, unknown>
    : null;
  const usablePurchase = purchase && typeof purchase.productName === "string" &&
    (purchase.defaultVariantId === null || typeof purchase.defaultVariantId === "string")
    ? {
        ...purchase,
        variants: Array.isArray(purchase.variants) ? purchase.variants : [],
        images: Array.isArray(purchase.images) ? purchase.images : [],
        optionGroups: Array.isArray(purchase.optionGroups) ? purchase.optionGroups : [],
      } as ProductContentPurchaseResponse
    : undefined;

  return {
    merchantId: typeof value.merchantId === "string" ? value.merchantId : undefined,
    productId: typeof value.productId === "string" ? value.productId : fallbackProductId,
    blocks: value.blocks as PublicProductContent["blocks"],
    faqs: Array.isArray(value.faqs) ? value.faqs as PublicProductContent["faqs"] : [],
    testimonials: Array.isArray(value.testimonials) ? value.testimonials as PublicProductContent["testimonials"] : [],
    videos: Array.isArray(value.videos) ? value.videos as PublicProductContent["videos"] : [],
    purchase: usablePurchase,
  };
}

/**
 * A product-details response is an agent turn. It fetches the same public,
 * feature-gated representation used on direct product links, then presents it
 * in the chat's product overlay. A compact action remains in the conversation
 * so the buyer can reopen the product without losing their place.
 */
export default function ProductContentBlock({
  block,
  merchantSlug,
  onQuickReply,
  immersive = false,
  narrationEnabled = true,
}: {
  block: ConversationBlock & { type: "product_content" };
  merchantSlug?: string;
  onQuickReply?: (option: string) => void;
  immersive?: boolean;
  narrationEnabled?: boolean;
}) {
  const data = block.data as unknown as ProductContentData;
  const productId = typeof data?.productId === "string" && CATALOG_ID.test(data.productId) ? data.productId : null;
  const [content, setContent] = useState<PublicProductContent | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "unavailable">("idle");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!immersive || !merchantSlug || !productId) return;
    const controller = new AbortController();
    setStatus("loading");
    setContent(null);

    fetch(`${API_BASE}/storefront/${encodeURIComponent(merchantSlug)}/products/${encodeURIComponent(productId)}/content`, {
      // Use the storefront's displayed language. The browser preference can
      // differ (e.g. English browser on the Portuguese storefront).
      headers: { Accept: "application/json", "Accept-Language": document.documentElement.lang || "pt-BR" },
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return readPublicContent(await response.json(), productId);
      })
      .then((next) => {
        if (controller.signal.aborted) return;
        setContent(next);
        setStatus(next ? "idle" : "unavailable");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("unavailable");
      });

    return () => controller.abort();
  }, [merchantSlug, productId, immersive, attempt]);

  const onCtaClick = (href: string) => onQuickReply?.(href);
  const fallbackBlocks = Array.isArray(data?.blocks) ? data.blocks as ProductContentBlockType[] : [];

  if (!productId && fallbackBlocks.length === 0) return null;

  if (!immersive && productId && merchantSlug) {
    return <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("aacp:open-product-content", { detail: { productId } }))}
      style={{ minHeight: 46, padding: "12px 18px", border: "1px solid var(--aacp-line)", borderRadius: "var(--aacp-radius-sm)", background: "var(--aacp-surface)", color: "var(--aacp-fg)", font: "inherit", cursor: "pointer" }}>
      Explorar detalhes do produto
    </button>;
  }

  if (content) {
    const blocks = flattenProductContentBlocks(content);
    return (
      <article
        aria-label={`Detalhes de ${content.purchase?.productName ?? "produto"}`}
        aria-busy={false}
        data-aacp-product-content
        data-product-id={content.productId}
        style={{ width: "100%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", flex: 1, fontFamily: "var(--aacp-font)" }}
      >
        <RichProductContentRenderer
          blocks={blocks}
          faqs={content.faqs}
          testimonials={content.testimonials}
          videos={content.videos}
          purchase={content.purchase}
          embedded={!immersive}
          immersive={immersive}
          narrationEnabled={narrationEnabled}
        />
      </article>
    );
  }

  if (fallbackBlocks.length > 0) {
    return (
      <section aria-label="Conteúdo do produto" style={{ width: "100%", minWidth: 0 }}>
        <ProductContentRenderer blocks={fallbackBlocks} onCtaClick={onCtaClick} />
      </section>
    );
  }

  return (
    <section
      aria-live="polite"
      aria-busy={status === "loading"}
      style={{ width: "100%", padding: "24px", color: "var(--aacp-muted)", fontSize: "14px" }}
    >
      {status === "unavailable" ? "Os detalhes completos deste produto não estão disponíveis agora." : "Preparando os detalhes do produto…"}
      {status === "unavailable" ? <button type="button" onClick={() => setAttempt((value) => value + 1)} style={{ display: "block", minHeight: 44, marginTop: 16, padding: "10px 16px", border: "1px solid var(--aacp-line)", borderRadius: "var(--aacp-radius-sm)", background: "var(--aacp-surface)", color: "var(--aacp-fg)", font: "inherit", cursor: "pointer" }}>Tentar novamente</button> : null}
    </section>
  );
}
