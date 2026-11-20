"use client";

import { useEffect, useState } from "react";
import { FiPackage } from "react-icons/fi";
import type { BuyerPurchase, PurchaseItem } from "@/lib/viewmodels/useBuyerHub";
import type { ValidBuyer } from "@/lib/buyer-auth";
import type { BuyerFiscalNavigation } from "@/lib/fiscal-navigation";
import { BuyerFiscalError, findOwnedFiscalPurchase } from "@/lib/services/buyer-fiscal.service";
import { FiscalOrderDocuments } from "./FiscalOrderDocuments";
import styles from "./OrdersTab.module.css";

export interface OrdersTabProps {
  purchases: BuyerPurchase[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  merchantId?: string;
  buyer?: ValidBuyer | null;
  fiscalNavigation?: BuyerFiscalNavigation | null;
}

const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric" });
const technicalId = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:mrc|merchant|order|purchase)[_-][a-z0-9_-]+)$/i;

function readableName(value: string | undefined, fallback: string): string {
  const name = value?.trim();
  return name && !technicalId.test(name) ? name : fallback;
}

function money(value: number, currency: string): string {
  if (!Number.isFinite(value) || value < 0 || !/^[A-Z]{3}$/.test(currency)) return "Valor indisponível";
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value); }
  catch { return "Valor indisponível"; }
}

function paymentLabel(method?: string | null): string {
  const known: Record<string, string> = {
    pix: "Pix", card: "Cartão", cartao: "Cartão", "cartão": "Cartão", credit_card: "Cartão de crédito",
    debit_card: "Cartão de débito", boleto: "Boleto", crypto: "Cripto", cripto: "Cripto",
  };
  return known[method?.trim().toLowerCase() ?? ""] ?? "Não informada";
}

function OrderItem({ item, currency }: { item: PurchaseItem; currency: string }) {
  const validQuantity = Number.isSafeInteger(item.quantity) && item.quantity > 0;
  const validPrice = Number.isFinite(item.unit_price) && item.unit_price >= 0;
  return <li className={styles.item}>
    <div className={styles.itemInfo}>
      <span className={styles.itemName}>{validQuantity && <span className={styles.quantity}>{item.quantity} × </span>}{readableName(item.name, "Item do pedido")}</span>
      <span className={styles.unitPrice}>{validQuantity ? `${money(item.unit_price, currency)} por unidade` : "Quantidade indisponível"}</span>
    </div>
    <span className={styles.itemTotal}>{validQuantity && validPrice ? money(item.unit_price * item.quantity, currency) : "Valor indisponível"}</span>
  </li>;
}

function Order({ purchase, buyer, fiscalNavigation }: {
  purchase: BuyerPurchase;
  buyer?: ValidBuyer | null;
  fiscalNavigation?: BuyerFiscalNavigation | null;
}) {
  const [fiscalOpen, setFiscalOpen] = useState(Boolean(fiscalNavigation));
  useEffect(() => {
    if (fiscalNavigation) setFiscalOpen(true);
  }, [fiscalNavigation?.intentId, fiscalNavigation?.environment, fiscalNavigation?.document]);
  const merchant = readableName(purchase.merchant_name, "Loja");
  const date = new Date(purchase.created_at);
  const validDate = Number.isFinite(date.getTime());
  const discount = purchase.discount_amount;
  const hasDiscount = typeof discount === "number" && Number.isFinite(discount) && discount > 0;
  const items = Array.isArray(purchase.items) ? purchase.items : [];
  const firstItems = items.slice(0, 3);
  const remainingItems = items.slice(3);
  return <article className={styles.order} aria-label={`Pedido de ${merchant}`}>
    <header className={styles.orderHeader}>
      <div className={styles.merchantInfo}>
        <h3>{merchant}</h3>
        {validDate ? <time dateTime={date.toISOString()}>{dateFormat.format(date)}</time> : <span className={styles.note}>Data indisponível</span>}
      </div>
      <div className={styles.total}>
        <span>Total do pedido</span>
        <strong>{money(purchase.total, purchase.currency)}</strong>
      </div>
    </header>
    {items.length > 0 ? <>
      <ul className={styles.items} aria-label="Itens do pedido">{firstItems.map((item, index) => <OrderItem key={index} item={item} currency={purchase.currency} />)}</ul>
      {remainingItems.length > 0 && <details className={styles.details}>
        <summary>Ver mais {remainingItems.length} {remainingItems.length === 1 ? "item" : "itens"}</summary>
        <ul className={styles.items} aria-label="Demais itens do pedido">{remainingItems.map((item, index) => <OrderItem key={index} item={item} currency={purchase.currency} />)}</ul>
      </details>}
    </> : <p className={styles.note}>Os itens deste pedido não estão disponíveis.</p>}
    <dl className={styles.facts}>
      {hasDiscount && <div className={styles.discount}><dt>Desconto</dt><dd>−{money(discount, purchase.currency)}</dd></div>}
      <div><dt>Forma de pagamento</dt><dd>{paymentLabel(purchase.payment_method)}</dd></div>
    </dl>
    {buyer && purchase.merchant_id && <>
      <button className={styles.button} type="button" aria-expanded={fiscalOpen} onClick={() => setFiscalOpen(open => !open)}>
        {fiscalOpen ? "Ocultar nota fiscal" : "Ver nota fiscal"}
      </button>
      {fiscalOpen && <FiscalOrderDocuments
        key={`${buyer.token}:${purchase.merchant_id}:${purchase.order_id}:${fiscalNavigation?.environment ?? "production"}:${fiscalNavigation?.intentId ?? ""}`}
        merchantId={purchase.merchant_id}
        orderId={purchase.order_id}
        buyerToken={buyer.token}
        initialEnvironment={fiscalNavigation?.environment}
        intentId={fiscalNavigation?.intentId}
        requestedDocument={fiscalNavigation?.document}
      />}
    </>}
  </article>;
}

export function OrdersTab({ purchases, hasMore, loadingMore, onLoadMore, loading = false, error = null, onRetry, merchantId, buyer, fiscalNavigation }: OrdersTabProps) {
  const [target, setTarget] = useState<{ key: string; purchase: BuyerPurchase | null; error?: string } | null>(null);
  const [lookupRevision, setLookupRevision] = useState(0);
  const targetKey = `${buyer?.token}:${merchantId}:${fiscalNavigation?.orderId}`;
  useEffect(() => {
    if (!buyer || !merchantId || !fiscalNavigation) { setTarget(null); return; }
    const controller = new AbortController();
    setTarget(null);
    void findOwnedFiscalPurchase(merchantId, fiscalNavigation.orderId, controller.signal)
      .then(purchase => { if (!controller.signal.aborted) setTarget({ key: targetKey, purchase }); })
      .catch(cause => {
        if (!controller.signal.aborted) setTarget({ key: targetKey, purchase: null, error: cause instanceof BuyerFiscalError ? cause.message : "Não foi possível localizar o pedido. Tente novamente." });
      });
    return () => controller.abort();
  }, [targetKey, lookupRevision]);
  const ownedTarget = target?.key === targetKey ? target : null;
  const shown = ownedTarget?.purchase && !purchases.some(purchase => purchase.id === ownedTarget.purchase!.id)
    ? [ownedTarget.purchase, ...purchases] : purchases;
  const resolvingTarget = Boolean(fiscalNavigation && buyer && merchantId && !ownedTarget);
  const initialLoading = loading && shown.length === 0;
  return <section className={styles.root} aria-label="Lista de pedidos" aria-busy={initialLoading || loadingMore}>
    <header className={styles.header}><h2>Seus pedidos</h2><p className={styles.note}>Consulte os itens e os valores das suas compras.</p></header>
    {resolvingTarget && <p className={styles.note} role="status">Localizando seu pedido…</p>}
    {fiscalNavigation && buyer && ownedTarget && !ownedTarget.purchase && <div className={styles.error} role="alert">
      <p className={styles.note}>{ownedTarget.error ?? "Pedido não encontrado nesta conta."}</p>
      <button className={styles.button} type="button" onClick={() => setLookupRevision(revision => revision + 1)}>Tentar novamente</button>
    </div>}
    {initialLoading ? <div className={styles.loading} role="status" aria-label="Carregando seus pedidos">
      <p className={styles.note}>Carregando seus pedidos…</p>
      <div className={styles.skeleton} aria-hidden="true" /><div className={styles.skeleton} aria-hidden="true" /><div className={styles.skeleton} aria-hidden="true" />
    </div> : <>
      {shown.length > 0 && <div className={styles.orders}>{shown.map((purchase) => <Order
        key={`${buyer?.token ?? ""}:${purchase.id}`}
        purchase={purchase}
        buyer={buyer}
        fiscalNavigation={purchase.order_id === fiscalNavigation?.orderId && purchase.merchant_id === merchantId ? fiscalNavigation : null}
      />)}</div>}
      {error ? <div className={styles.error} role="alert">
        <h3>{purchases.length > 0 ? "Não foi possível carregar mais pedidos." : "Não foi possível carregar seus pedidos."}</h3>
        <p className={styles.note}>{purchases.length > 0 ? "Os pedidos já carregados continuam disponíveis." : "Tente novamente para consultar suas compras."}</p>
        {onRetry && <button className={styles.button} type="button" disabled={loadingMore} onClick={onRetry}>{loadingMore ? "Carregando…" : "Tentar novamente"}</button>}
      </div> : purchases.length === 0 ? <div className={styles.empty} role="status">
        <FiPackage size={24} aria-hidden="true" /><h3>Nenhum pedido por aqui</h3>
        <p className={styles.note}>Quando houver compras vinculadas à sua conta, você poderá consultar os detalhes aqui.</p>
      </div> : hasMore && <div className={styles.pagination}>
        <button className={styles.button} type="button" disabled={loadingMore} onClick={onLoadMore} aria-label="Carregar mais pedidos">{loadingMore ? "Carregando…" : "Carregar mais pedidos"}</button>
        <span className={styles.liveStatus} role="status">{loadingMore ? "Carregando mais pedidos…" : ""}</span>
      </div>}
    </>}
  </section>;
}

export default OrdersTab;
