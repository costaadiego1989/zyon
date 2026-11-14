"use client";

import { useEffect, useRef, useState } from "react";
import { FiArrowRight, FiCheck, FiChevronLeft, FiChevronRight, FiPackage, FiShoppingBag, FiTruck } from "react-icons/fi";
import RuleNotices from "./RuleNotices";
import { ProductCardShare } from "./parts/ProductCardShare";
import { useCart } from "@/lib/cart-store";
import type { ProductContentPurchaseResponse } from "@/lib/api/product-content";
import ProductContentRenderer, {
  type ProductContentSupplementalFaq,
  type ProductContentSupplementalTestimonial,
  type ProductContentSupplementalVideo,
} from "./ProductContentRenderer";
import type { ProductContentBlock } from "./ContentBlocks";
import styles from "./RichProductContent.module.css";
import ProductNarration from "./ProductNarration";
import { buildProductNarration } from "@/lib/services/product-narration";
import { useGallerySwipe } from "../useGallerySwipe";
import type { CrossSellInterstitialData } from "@/lib/viewmodels/useConversationViewModel";
import { selectCrossSellDetailCandidate, type CrossSellDetailPurchase } from "@/lib/storefront-cross-sell-detail";
import { selectCheckoutProductDetail, type CheckoutProductDetailPurchase } from "@/lib/checkout-product-detail";
import { canonicalCommercialNotice, type NormalCheckoutCrossSellQuote } from "@zyon/contracts";

type PurchaseTarget = ProductContentPurchaseResponse;
type GalleryImage = { src: string; alt: string };

function safeImage(src: string) {
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  try { return new URL(src).protocol === "https:"; } catch { return false; }
}

function getImages(purchase: PurchaseTarget | undefined, blocks: ProductContentBlock[]): GalleryImage[] {
  const catalog = purchase?.images ?? [];
  const candidates: GalleryImage[] = catalog.length ? catalog : blocks.flatMap((block): GalleryImage[] => {
    if (block.type === "carousel") return block.images;
    if (block.type === "image") return [{ src: block.src, alt: block.alt }];
    if (block.type === "banner") return [{ src: block.imageSrc, alt: block.alt }];
    return [];
  });
  return candidates.filter((image, index) => safeImage(image.src) && candidates.findIndex((other) => other.src === image.src) === index).slice(0, 8);
}

export default function RichProductContentRenderer({ blocks, faqs, testimonials, videos, purchase, merchantSlug, productId, embedded = false, immersive = false, narrationEnabled = true, shareUrl, showNarration = true, onCartAdded, crossSell, onAddCrossSell, onOpenCrossSell, financialPurchase, checkoutPurchase }: {
  blocks: ProductContentBlock[];
  faqs: ProductContentSupplementalFaq[];
  testimonials: ProductContentSupplementalTestimonial[];
  videos: ProductContentSupplementalVideo[];
  purchase?: PurchaseTarget;
  merchantSlug?: string;
  productId?: string;
  /** Product content is normally a response inside the chat, not a parallel PDP. */
  embedded?: boolean;
  immersive?: boolean;
  narrationEnabled?: boolean;
  shareUrl?: string;
  showNarration?: boolean;
  onCartAdded?: () => void;
  crossSell?: CrossSellInterstitialData | null;
  onAddCrossSell?: (product: CrossSellInterstitialData["products"][number]) => void;
  onOpenCrossSell?: (product: CrossSellInterstitialData["products"][number]) => void;
  financialPurchase?: CrossSellDetailPurchase;
  checkoutPurchase?: CheckoutProductDetailPurchase;
}) {
  const { cart } = useCart();
  const [selectedVariantId, setSelectedVariantId] = useState(checkoutPurchase?.request.initialVariantId ?? financialPurchase?.context.initialVariantId ?? purchase?.defaultVariantId ?? purchase?.variants[0]?.id ?? "");
  const [selectedOptionIds, setSelectedOptionIds] = useState<Set<string>>(() => new Set(financialPurchase?.context.source.selectedOptionItemIds ?? []));
  const [optionError, setOptionError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "added" | "review">("idle");
  const pending = useRef<{ variantId: string; previousQuantity: number } | null>(null);
  const [financialPhase, setFinancialPhase] = useState<"idle" | "pending" | "accepted" | "failed">("idle");
  const [financialError, setFinancialError] = useState<string | null>(null);
  const [, refreshQuote] = useState(0);
  const [preparedSelection, setPreparedSelection] = useState<string | null>(null);
  const selectionGeneration = useRef(0), financialRef = useRef(financialPurchase), mounted = useRef(true);
  financialRef.current = financialPurchase;
  const checkoutRef = useRef(checkoutPurchase); checkoutRef.current = checkoutPurchase;
  const [checkoutQuote, setCheckoutQuote] = useState<{ key: string; quote: NormalCheckoutCrossSellQuote | null } | null>(null);
  const generationAtRender = selectionGeneration.current;
  const selectionKey = JSON.stringify([selectedVariantId, [...selectedOptionIds].sort()]);
  const preparedKey = JSON.stringify([financialPurchase?.scopeKey, selectionKey]);
  const choice = financialPurchase && purchase ? selectCrossSellDetailCandidate(financialPurchase.context, purchase, selectedVariantId, [...selectedOptionIds]) : null;
  const financialOffer = choice?.kind === "selected" ? financialPurchase?.present([choice.product])[0] : undefined;
  const financialReady = !!financialOffer?.expectedQuote && financialOffer.acceptanceStatus === "ready" && financialPurchase?.isCurrent() === true;
  const checkoutKey = JSON.stringify([checkoutPurchase?.request.key, selectionKey]);
  const checkoutChoice = checkoutPurchase && purchase ? selectCheckoutProductDetail(checkoutPurchase.request, purchase, selectedVariantId, [...selectedOptionIds]) : null;
  const checkoutReady = checkoutQuote?.key === checkoutKey && checkoutQuote.quote !== null && checkoutPurchase?.request.isCurrent() === true;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!financialPurchase || choice?.kind !== "selected" || financialPhase !== "idle" || !financialPurchase.isCurrent()) return;
    let active = true; const generation = selectionGeneration.current;
    void financialPurchase.prepare([choice.product]).catch(() => {}).finally(() => { if (active && mounted.current && generation === selectionGeneration.current) { setPreparedSelection(preparedKey); refreshQuote(value => value + 1); } });
    return () => { active = false; };
    // Selection identity and cart scope, not callback identity, own this read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [financialPurchase?.context.key, financialPurchase?.scopeKey, selectionKey, purchase]);
  useEffect(() => {
    if (!checkoutPurchase || checkoutChoice?.kind !== "selected" || financialPhase !== "idle" || !checkoutPurchase.request.isCurrent()) return;
    const generation = selectionGeneration.current, request = checkoutPurchase.request; let active = true;
    void request.prepare(checkoutChoice.selection).then(quote => {
      if (active && mounted.current && generation === selectionGeneration.current && checkoutRef.current?.request === request && request.isCurrent())
        setCheckoutQuote({ key: checkoutKey, quote });
    }).catch(() => { if (active && mounted.current && generation === selectionGeneration.current) setCheckoutQuote({ key: checkoutKey, quote: null }); });
    return () => { active = false; };
    // Canonical scope/selection, not callback identity, owns this read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutPurchase?.request.key, selectionKey, purchase]);
  const selectedVariant = purchase?.variants.find((variant) => variant.id === selectedVariantId) ?? null;
  const images = getImages(purchase, blocks);
  const optionExtraReais = purchase?.optionGroups.flatMap((group) => group.items)
    .filter((item) => selectedOptionIds.has(item.id))
    .reduce((total, item) => total + item.priceModifierInCents / 100, 0) ?? 0;
  const price = selectedVariant?.priceReais ?? purchase?.priceReais;
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: selectedVariant?.currency ?? purchase?.currency ?? "BRL" });
  const checkoutTarget = checkoutQuote?.key === checkoutKey ? checkoutQuote.quote?.pricing.targets[0] : undefined;
  const displayedUnitPrice = checkoutPurchase
    ? checkoutReady && checkoutTarget ? currency.format(checkoutTarget.maximumUnitPriceCents / 100)
      : checkoutChoice?.kind === "incomplete" ? "Escolha as opções" : checkoutChoice?.kind === "unavailable" || checkoutQuote?.key === checkoutKey || !checkoutPurchase.request.isCurrent() ? "Oferta indisponível" : "Conferindo oferta…"
    : financialPurchase
    ? financialOffer?.priceFormatted ?? (choice?.kind === "incomplete" ? "Escolha as opções" : choice?.kind === "unavailable" || preparedSelection === preparedKey || !financialPurchase.isCurrent() ? "Oferta indisponível" : "Conferindo oferta…")
    : typeof price === "number" ? currency.format(price + optionExtraReais) : "Preço indisponível";
  const ratings = testimonials.map((item) => item.rating).filter((value): value is number => typeof value === "number" && value >= 1 && value <= 5);
  const rating = ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : null;

  // Confirm only after the server-backed cart actually grows.
  useEffect(() => {
    const request = pending.current;
    if (!request || financialPurchase || checkoutPurchase) return;
    const quantity = cart.items.filter((item) => item.variantId === request.variantId).reduce((sum, item) => sum + item.quantity, 0);
    if (quantity > request.previousQuantity) {
      pending.current = null;
      setStatus("added");
      onCartAdded?.();
    }
  }, [cart.items, onCartAdded]);

  useEffect(() => {
    if (status !== "pending" || financialPurchase || checkoutPurchase) return;
    const timer = window.setTimeout(() => setStatus("review"), 25000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const toggleOption = (group: PurchaseTarget["optionGroups"][number], itemId: string) => {
    if ((financialPurchase || checkoutPurchase) && financialPhase !== "idle") return;
    selectionGeneration.current++;
    setSelectedOptionIds((previous) => {
      const next = new Set(previous);
      if (group.selectionType === "single") {
        group.items.forEach((item) => next.delete(item.id));
        next.add(itemId);
      } else if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
    setOptionError(null);
    setStatus("idle");
  };

  const addToCart = () => {
    if (checkoutPurchase) {
      if (!checkoutReady || !checkoutQuote?.quote || financialPhase !== "idle" || generationAtRender !== selectionGeneration.current) return;
      const generation = selectionGeneration.current, request = checkoutPurchase.request, quote = checkoutQuote.quote;
      const guard = () => mounted.current && selectionGeneration.current === generation && checkoutRef.current?.request === request && request.isCurrent();
      setFinancialPhase("pending");
      void request.accept(quote, guard).then(result => {
        if (!guard()) return;
        if (result.ok) { setFinancialPhase("accepted"); setStatus("added"); onCartAdded?.(); }
        else { setFinancialPhase("failed"); setFinancialError(result.error || "Não foi possível confirmar esta oferta. Confira o carrinho antes de continuar."); }
      }).catch(() => { if (guard()) { setFinancialPhase("failed"); setFinancialError("Não foi possível confirmar esta oferta. Confira o carrinho antes de continuar."); } });
      return;
    }
    if (financialPurchase) {
      if (!financialReady || !financialOffer || financialPhase !== "idle" || generationAtRender !== selectionGeneration.current) return;
      const generation = selectionGeneration.current, context = financialPurchase.context;
      const guard = () => mounted.current && selectionGeneration.current === generation && financialRef.current?.context === context && financialRef.current.isCurrent();
      setFinancialPhase("pending");
      void financialPurchase.accept(financialOffer, guard).then(accepted => {
        if (!guard()) return;
        if (accepted) { setFinancialPhase("accepted"); setStatus("added"); onCartAdded?.(); }
        else { setFinancialPhase("failed"); setFinancialError("Não foi possível confirmar esta oferta. Confira o carrinho antes de continuar."); }
      }).catch(() => { if (guard()) { setFinancialPhase("failed"); setFinancialError("Não foi possível confirmar esta oferta. Confira o carrinho antes de continuar."); } });
      return;
    }
    if (!purchase || !selectedVariant?.available || (pending.current && status !== "review")) return;
    // An unknown submission can be retried. We never show a success state
    // before the cart returned by the server has actually changed.
    if (status === "review") pending.current = null;
    const missingRequired = purchase.optionGroups.find((group) => group.required && !group.items.some((item) => selectedOptionIds.has(item.id)));
    if (missingRequired) {
      setOptionError("Escolha " + missingRequired.name.toLowerCase() + " para continuar.");
      document.getElementById("aacp-rich-product-options")?.querySelector("input")?.focus();
      return;
    }
    pending.current = {
      variantId: selectedVariant.id,
      previousQuantity: cart.items.filter((item) => item.variantId === selectedVariant.id).reduce((sum, item) => sum + item.quantity, 0),
    };
    setStatus("pending");
    window.dispatchEvent(new CustomEvent("aacp:add-rich-product-to-cart", {
      detail: { variantId: selectedVariant.id, optionItemIds: [...selectedOptionIds] },
    }));
  };

  const openCart = () => checkoutPurchase ? checkoutPurchase.close() : window.dispatchEvent(new Event("aacp:open-rich-product-cart"));
  const onCtaClick = (href: string) => {
    if (href === "#checkout") {
      document.getElementById("aacp-rich-product-title")?.scrollIntoView({ block: "center" });
      addToCart();
      return;
    }
    window.location.assign(href);
  };
  const inProgress = financialPurchase || checkoutPurchase ? financialPhase === "pending" : status === "pending";
  const selectionLocked = financialPurchase || checkoutPurchase ? financialPhase !== "idle" : inProgress;
  const purchaseActions = <>
    <button data-neu="primary" type="button" data-aacp-rich-product-add-to-cart className={styles.buyButton} onClick={addToCart} disabled={!selectedVariant?.available || inProgress || !!financialPurchase && (!financialReady || financialPhase !== "idle") || !!checkoutPurchase && (!checkoutReady || financialPhase !== "idle")} aria-busy={inProgress}>
      {status === "added" ? <FiCheck aria-hidden="true" /> : <FiShoppingBag aria-hidden="true" />}
      {financialPurchase || checkoutPurchase ? financialPhase === "pending" ? "Adicionando…" : financialPhase === "accepted" ? "Adicionado" : "Adicionar ao carrinho"
        : status === "pending" ? "Adicionando…" : status === "review" ? "Tentar novamente" : status === "added" ? "Adicionar mais um" : selectedVariant?.available ? "Adicionar ao carrinho" : "Produto indisponível"}
      <FiArrowRight aria-hidden="true" />
    </button>
    <div className={styles.feedback} aria-live="polite" aria-atomic="true">
      {checkoutReady && checkoutQuote?.quote?.pricing.notice && financialPhase === "idle"
        ? <span role="status">{canonicalCommercialNotice(checkoutQuote.quote.pricing.notice).message}</span> : null}
      {status === "added" ? <><FiCheck aria-hidden="true" /><span>Produto adicionado.</span><button data-neu="text" type="button" onClick={openCart}>Ver carrinho <FiArrowRight aria-hidden="true" /></button></> : null}
      {status === "review" || financialPhase === "failed" ? <span role="alert">{financialPurchase || checkoutPurchase ? financialError : "A confirmação está demorando."} <button data-neu="text" type="button" onClick={openCart}>Confira o carrinho</button>{financialPurchase || checkoutPurchase ? null : " antes de tentar novamente."}</span> : null}
    </div>
  </>;

  return (
    <div
      className={`${styles.product}${embedded ? ` ${styles.embedded}` : ""}${immersive ? ` ${styles.immersive}` : ""}`}
      data-aacp-rich-product-renderer
      data-aacp-rich-product-embedded={embedded || undefined}
    >
      {immersive && purchase && showNarration ? <ProductNarration summary={buildProductNarration(purchase)} enabled={narrationEnabled} /> : null}
      <div className={immersive ? styles.scrollBody : undefined} data-aacp-product-scroll={immersive || undefined}>
      {purchase ? (
        <section className={styles.hero} data-aacp-rich-product-purchase aria-labelledby="aacp-rich-product-title">
          <ProductGallery images={images} productName={purchase.productName} />
          <div className={styles.summary}>
            {shareUrl && purchase ? <div className={styles.shareRow}><span>Compartilhe</span><ProductCardShare productName={purchase.productName} shareUrl={shareUrl} /></div> : null}
            {rating ? <a className={styles.rating} href="#product-content-reviews-heading"><span aria-hidden="true">★</span><strong>{rating}</strong><span>{testimonials.length} avaliações</span><FiArrowRight aria-hidden="true" /></a> : null}
            <h1 id="aacp-rich-product-title">{purchase.productName}</h1>
            {purchase.description ? <p className={styles.description}>{purchase.description}</p> : null}
            <div className={styles.priceRow}>
              <strong data-aacp-rich-product-price className={styles.price}>{displayedUnitPrice}</strong>
              <span className={styles.stock}>{selectedVariant?.available ? <><FiCheck aria-hidden="true" /> Disponível</> : "Indisponível no momento"}</span>
            </div>
            {purchase.variants.length > 1 || purchase.variants.some((variant) => Object.keys(variant.attributes).length > 0) ? (
              <fieldset className={styles.variants} disabled={selectionLocked}>
                <legend>Escolha sua versão</legend>
                <div className={styles.variantList}>
                  {purchase.variants.map((variant, index) => {
                    const label = Object.values(variant.attributes).join(" / ") || (purchase.variants.length > 1 ? "Opção " + (index + 1) : "Padrão");
                    return <label key={variant.id} className={styles.variant} data-unavailable={!variant.available}>
                      <input type="radio" name="rich-product-variant" value={variant.id} checked={variant.id === selectedVariantId} onChange={() => {
                        selectionGeneration.current++; setSelectedVariantId(variant.id);
                        setStatus("idle");
                        if (immersive && typeof productId === "string") {
                          window.dispatchEvent(new CustomEvent("aacp:rich-product-variant-selected", { detail: { productId, variantId: variant.id } }));
                        }
                      }} disabled={!variant.available} />
                      <span>{label}{!variant.available ? <small>Esgotado</small> : null}</span>
                    </label>;
                  })}
                </div>
              </fieldset>
            ) : null}
            {purchase.optionGroups.length ? <FoodOptions groups={purchase.optionGroups} selected={selectedOptionIds} error={optionError} disabled={selectionLocked} onToggle={toggleOption} /> : null}
            {selectedVariant?.available && selectedVariant.lowStock ? <p data-aacp-rich-product-nudge className={styles.nudge}><FiPackage aria-hidden="true" /><span>Últimas unidades desta versão disponíveis.</span></p> : null}
            <RuleNotices notices={purchase.ruleNotices} />
            {!immersive ? purchaseActions : null}
            {crossSell?.products.length ? <ProductCrossSell data={crossSell} onAdd={onAddCrossSell} onOpen={onOpenCrossSell} /> : null}
            <div className={styles.delivery}><FiTruck aria-hidden="true" /><div><strong>Entrega calculada para você</strong><p>Consulte o frete e o prazo com seu CEP no checkout.</p></div></div>
          </div>
        </section>
      ) : null}
      <div id="rich-product-details" className={styles.editorial}>
        <ProductContentRenderer blocks={blocks} faqs={faqs} testimonials={testimonials} videos={videos} onCtaClick={onCtaClick} merchantSlug={merchantSlug} productId={productId} productName={purchase?.productName} />
      </div>
      {purchase ? <div className={styles.closing}><div><span>Pronto para escolher?</span><strong>{purchase.productName}</strong></div><a href="#aacp-rich-product-title">Ver opções <FiArrowRight aria-hidden="true" /></a></div> : null}
      </div>
      {immersive && purchase ? <footer className={styles.purchaseDock} data-aacp-product-purchase-dock>
        <div className={styles.dockPrice}><span>{Object.values(selectedVariant?.attributes ?? {}).join(" / ") || "Sua escolha"}</span><strong data-aacp-product-total>{displayedUnitPrice}</strong></div>
        <div className={styles.dockActions}>{purchaseActions}</div>
      </footer> : null}
    </div>
  );
}

function ProductCrossSell({ data, onAdd, onOpen }: {
  data: CrossSellInterstitialData;
  onAdd?: (product: CrossSellInterstitialData["products"][number]) => void;
  onOpen?: (product: CrossSellInterstitialData["products"][number]) => void;
}) {
  return <section className={styles.crossSell} data-aacp-product-cross-sell aria-labelledby="aacp-product-cross-sell-heading">
    <div className={styles.crossSellHeading}>
      <div>
        <p>Complete sua rotina</p>
        <h2 id="aacp-product-cross-sell-heading">Você também pode gostar</h2>
      </div>
      <span>{data.trigger}</span>
    </div>
    <div className={styles.crossSellList}>
      {data.products.map((product) => <article key={product.id} className={styles.crossSellCard}>
        <div className={styles.crossSellImage} role={product.promoId && onOpen ? "button" : undefined} tabIndex={product.promoId && onOpen ? 0 : undefined}
          onClick={() => product.promoId && onOpen?.(product)} onKeyDown={event => { if (product.promoId && onOpen && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(product); } }}>
          {product.image && safeImage(product.image)
            ? <img src={product.image} alt={product.name} loading="lazy" />
            : <FiPackage aria-hidden="true" />}
        </div>
        <div className={styles.crossSellInfo}>
          <strong>{product.name}</strong>
          <span>{product.priceFormatted}</span>
          {product.discountPercent && product.discountPercent > 0 ? <small>Oferta de {Math.round(product.discountPercent)}%</small> : null}
        </div>
        <button data-neu="control" type="button" onClick={() => product.readOnlyCandidate ? onOpen?.(product) : onAdd?.(product)} disabled={!product.inStock || !!product.couponCode
          || (product.readOnlyCandidate ? !onOpen : !!product.promoId && !product.expectedQuote || product.acceptanceStatus !== undefined && product.acceptanceStatus !== "ready")}
          aria-busy={product.acceptanceStatus === "pending"}>
          {product.acceptanceStatus === "pending" ? "Adicionando…" : product.acceptanceStatus === "accepted" ? "Adicionado"
            : product.readOnlyCandidate ? "Ver detalhes" : product.inStock ? "Adicionar" : "Indisponível"}
        </button>
        {product.acceptanceError ? <span role="alert">{product.acceptanceError}</span> : null}
      </article>)}
    </div>
  </section>;
}

function ProductGallery({ images, productName }: { images: GalleryImage[]; productName: string }) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const current = images[index] ?? images[0];
  const move = (direction: number) => setIndex((value) => (value + direction + images.length) % images.length);
  const swipe = useGallerySwipe(images.length > 1, move);
  return <div className={styles.gallery} role="group" aria-label={"Imagens de " + productName}>
    <div className={styles.mainImage} {...swipe} style={{ touchAction: images.length > 1 ? "pan-y pinch-zoom" : "auto" }}>
      {current && !failed.has(current.src) ? <img key={current.src} src={current.src} alt={current.alt || productName} fetchPriority="high" draggable={false} onError={() => setFailed((previous) => new Set(previous).add(current.src))} /> : <div className={styles.imageFallback}><FiPackage aria-hidden="true" /><span>Imagem indisponível</span></div>}
      {images.length > 1 ? <div className={styles.galleryControls}><span aria-live="polite">{String(index + 1).padStart(2, "0")} / {String(images.length).padStart(2, "0")}</span><button data-neu="text" type="button" onClick={() => move(-1)} aria-label="Foto anterior"><FiChevronLeft /></button><button data-neu="text" type="button" onClick={() => move(1)} aria-label="Próxima foto"><FiChevronRight /></button></div> : null}
    </div>
    {images.length > 1 ? <div className={styles.thumbnails} aria-label="Escolher foto">{images.map((image, i) => <button data-neu="media" key={image.src} type="button" aria-label={"Ver foto " + (i + 1) + ": " + image.alt} aria-pressed={i === index} onClick={() => setIndex(i)}><img src={image.src} alt="" loading="lazy" /></button>)}</div> : null}
  </div>;
}

function FoodOptions({ groups, selected, error, disabled, onToggle }: {
  groups: PurchaseTarget["optionGroups"]; selected: Set<string>; error: string | null; disabled: boolean;
  onToggle: (group: PurchaseTarget["optionGroups"][number], itemId: string) => void;
}) {
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  return <div id="aacp-rich-product-options" data-aacp-rich-product-options className={styles.foodOptions}>
    <h2>Monte do seu jeito</h2>
    {groups.map((group) => <fieldset key={group.id} disabled={disabled}><legend>{group.name}<small>{group.required ? "Obrigatório" : "Opcional"}</small></legend>{group.items.map((item) => <label key={item.id} className={styles.foodChoice}><input type={group.selectionType === "single" ? "radio" : "checkbox"} name={"food-" + group.id} checked={selected.has(item.id)} onChange={() => onToggle(group, item.id)} /><span>{item.name}</span>{item.priceModifierInCents !== 0 ? <strong>{item.priceModifierInCents > 0 ? "+ " : ""}{currency.format(item.priceModifierInCents / 100)}</strong> : null}</label>)}</fieldset>)}
    {error ? <p role="alert" className={styles.optionError}>{error}</p> : null}
  </div>;
}
