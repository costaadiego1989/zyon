"use client";
import { productShareUrl } from "@/lib/storefront-navigation";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiArrowLeft, FiX } from "react-icons/fi";
import type { ConversationBlock } from "@/lib/types";
import ProductContentBlock, { type ProductNarrationDetails } from "./ProductContentBlock";
import ProductNarration from "./ProductNarration";
import { ProductCopyLink } from "./ProductCopyLink";
import styles from "./RichProductDetailsPanel.module.css";
import type { CrossSellInterstitialData } from "@/lib/viewmodels/useConversationViewModel";

/** The official rich product surface: narration, reviews and editorial details. */
export default function RichProductDetailsPanel({
  productId,
  merchantSlug,
  crossSell = null,
  onAddCrossSell,
  suspended = false,
  onClose,
  onProductResolved,
}: {
  productId: string;
  merchantSlug?: string;
  crossSell?: CrossSellInterstitialData | null;
  onAddCrossSell?: (product: CrossSellInterstitialData["products"][number]) => void;
  suspended?: boolean;
  onClose: (result: { productId: string; productName?: string; defaultVariantId?: string | null; cartAdded: boolean }) => void;
  onProductResolved?: (product: { productId: string; name: string; defaultVariantId: string | null }) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  const resolvedCallback = useRef(onProductResolved);
  resolvedCallback.current = onProductResolved;
  const [closing, setClosing] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [narration, setNarration] = useState<ProductNarrationDetails | null>(null);
  const [product, setProduct] = useState<{ name: string; defaultVariantId: string | null } | null>(null);
  const [cartAdded, setCartAdded] = useState(false);

  const handleProductResolved = useCallback((resolved: { name: string; defaultVariantId: string | null }) => {
    setProduct(resolved);
    resolvedCallback.current?.({ productId, ...resolved });
  }, [productId]);
  const close = () => setClosing(true);

  useEffect(() => {
    if (!merchantSlug || typeof window === "undefined") return;
    setShareUrl(productShareUrl(window.location.origin, merchantSlug, productId));
  }, [merchantSlug, productId]);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => closeCallback.current({
      productId,
      productName: product?.name,
      defaultVariantId: product?.defaultVariantId,
      cartAdded,
    }), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 280);
    return () => window.clearTimeout(timer);
  }, [cartAdded, closing, product, productId]);

  useEffect(() => {
    const root = panel.current;
    if (!root || suspended) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const chatContent = root.parentElement?.querySelector<HTMLElement>("[data-aacp-chat-content]");
    const wasInert = chatContent?.inert ?? false;
    if (chatContent) chatContent.inert = true;
    root.focus({ preventScroll: true });
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) root.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("focusin", containFocus);
      if (chatContent) chatContent.inert = wasInert;
      if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus({ preventScroll: true });
      else chatContent?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    };
  }, [suspended]);

  return (
    <div
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-modal={!suspended}
      aria-labelledby="rich-product-details-heading"
      className={styles.panel}
      data-aacp-rich-product-experience
      data-closing={closing || undefined}
      data-suspended={suspended || undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key !== "Tab") return;
        const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, iframe, video[controls], [tabindex="0"]') ?? [])
          .filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
    >
      <header className={styles.header}>
        <button data-neu="control" type="button" onClick={close} aria-label="Voltar ao chat"><FiArrowLeft aria-hidden="true" /><span>Voltar</span></button>
        <h2 id="rich-product-details-heading" className={styles.visuallyHidden}>Detalhes do produto</h2>
        <div className={styles.headerNarration}>
          {narration ? <ProductNarration summary={narration.summary} enabled={narration.enabled && !closing && !suspended} placement="header" /> : <span>Detalhes do produto</span>}
        </div>
        <div className={styles.actions}>
          <ProductCopyLink url={shareUrl} />
          <button data-neu="icon" type="button" onClick={close} aria-label="Fechar produto e voltar ao chat"><FiX aria-hidden="true" /></button>
        </div>
      </header>
      <ProductContentBlock
        key={productId}
        block={{ type: "product_content", data: { productId, blocks: [] } } as ConversationBlock & { type: "product_content" }}
        merchantSlug={merchantSlug}
        immersive
        narrationEnabled={!closing && !suspended}
        shareUrl={shareUrl}
        onNarrationChange={setNarration}
        onProductResolved={handleProductResolved}
        onCartAdded={() => setCartAdded(true)}
        crossSell={crossSell}
        onAddCrossSell={onAddCrossSell}
      />
    </div>
  );
}
