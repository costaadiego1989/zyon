"use client";

import { useEffect, useRef, useState } from "react";
import { FiArrowLeft, FiLink, FiX } from "react-icons/fi";
import type { ConversationBlock } from "@/lib/types";
import ProductContentBlock, { type ProductNarrationDetails } from "./ProductContentBlock";
import ProductNarration from "./ProductNarration";
import styles from "./ProductExperienceOverlay.module.css";

/** A product surface contained by the chat. Its scroll never moves the conversation. */
export default function ProductExperienceOverlay({ productId, merchantSlug, onClose }: {
  productId: string;
  merchantSlug?: string;
  onClose: (result: { productId: string; productName?: string; defaultVariantId?: string | null; cartAdded: boolean }) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  const [closing, setClosing] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [narration, setNarration] = useState<ProductNarrationDetails | null>(null);
  const [product, setProduct] = useState<{ name: string; defaultVariantId: string | null } | null>(null);
  const [cartAdded, setCartAdded] = useState(false);

  const close = () => setClosing(true);
  useEffect(() => {
    if (!merchantSlug) return;
    const url = new URL(`/store/${encodeURIComponent(merchantSlug)}`, window.location.origin);
    url.searchParams.set("show", "content");
    url.searchParams.set("product", productId);
    setShareUrl(url.toString());
  }, [merchantSlug, productId]);
  const copyShareLink = () => {
    if (!shareUrl) return;
    navigator.clipboard?.writeText(shareUrl).catch(() => {});
  };
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => closeCallback.current({
      productId,
      productName: product?.name,
      defaultVariantId: product?.defaultVariantId,
      cartAdded,
    }), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240);
    return () => window.clearTimeout(timer);
  }, [cartAdded, closing, product, productId]);

  useEffect(() => {
    const root = panel.current;
    if (!root) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const chatContent = root.parentElement?.querySelector<HTMLElement>("[data-aacp-chat-content]");
    const wasInert = chatContent?.inert ?? false;
    if (chatContent) chatContent.inert = true;
    root.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) root.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("focusin", containFocus);
      if (chatContent) chatContent.inert = wasInert;
      if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus({ preventScroll: true });
      else chatContent?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    };
  }, []);

  return <div
    ref={panel}
    role="dialog"
    aria-modal="true"
    aria-labelledby="product-experience-heading"
    className={styles.panel}
    data-aacp-product-experience
    data-closing={closing || undefined}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), summary, iframe, video[controls], [tabindex="0"]') ?? [])
        .filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
  >
    <header className={styles.header}>
      <button type="button" onClick={close} aria-label="Voltar ao chat"><FiArrowLeft aria-hidden="true" /><span>Voltar</span></button>
      <h2 id="product-experience-heading" className={styles.visuallyHidden}>Detalhes do produto</h2>
      <div className={styles.headerNarration}>
        {narration ? <ProductNarration summary={narration.summary} enabled={narration.enabled} placement="header" /> : <span>Detalhes do produto</span>}
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={copyShareLink} aria-label="Copiar link do produto" disabled={!shareUrl}><FiLink aria-hidden="true" /></button>
        <button type="button" onClick={close} aria-label="Fechar produto e voltar ao chat"><FiX aria-hidden="true" /></button>
      </div>
    </header>
    <ProductContentBlock
      key={productId}
      block={{ type: "product_content", data: { productId, blocks: [] } } as ConversationBlock & { type: "product_content" }}
      merchantSlug={merchantSlug}
      immersive
      narrationEnabled={!closing}
      shareUrl={shareUrl}
      onNarrationChange={setNarration}
      onProductResolved={setProduct}
      onCartAdded={() => setCartAdded(true)}
    />
  </div>;
}
