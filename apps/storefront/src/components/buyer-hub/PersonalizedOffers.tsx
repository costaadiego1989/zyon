"use client";

import { useEffect, useState } from "react";
import type { BuyerPersonalizedOffer } from "@/lib/viewmodels/useBuyerHub/types";
import { currentPersonalizedOffers } from "@/lib/personalized-offers";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const percent = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
const titles = { percentage: "Desconto nos produtos", fixed: "Desconto fixo", shipping: "Desconto no frete", progressive: "Desconto atual nos produtos" };

export default function PersonalizedOffers({ offers, sessionId }: { offers?: BuyerPersonalizedOffer[]; sessionId?: string }) {
  const [now, setNow] = useState(Date.now);
  const current = currentPersonalizedOffers(offers, Math.max(now, Date.now()), sessionId);
  useEffect(() => {
    const expiry = Math.min(...current.map((offer) => Date.parse(offer.expiresAt)));
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2_147_483_647, Math.max(1, expiry - Date.now() + 1)));
    return () => clearTimeout(timer);
  }, [offers, now, sessionId]);
  if (!current.length) return null;
  const heading = current.length === 1 ? "Oferta para este pedido" : "Ofertas para seus pedidos";

  return <section aria-label={heading} style={{ minWidth: 0 }}>
    <h3 style={{ margin: "0 0 6px", fontSize: "15px", fontWeight: 600, color: "var(--aacp-fg)" }}>{heading}</h3>
    <p style={{ margin: "0 0 12px", fontSize: "12px", lineHeight: 1.5, color: "var(--aacp-muted)" }}>
      Cada desconto vale somente na compra em que foi aplicado. Confira o total no checkout antes de pagar.
    </p>
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {current.map((offer) => <li key={offer.id} style={{ padding: "14px 0", borderTop: "1px solid var(--aacp-line)", overflowWrap: "anywhere" }}>
        <h4 style={{ margin: "0 0 6px", fontSize: "13px", fontWeight: 600, color: "var(--aacp-fg)" }}>{titles[offer.kind]}</h4>
        <p style={{ margin: "0 0 6px", fontSize: "15px", fontWeight: 600, color: "var(--aacp-accent-text, var(--aacp-fg))", fontVariantNumeric: "tabular-nums" }}>
          {money(offer.amountCents)} aplicados nesta compra
        </p>
        <p style={{ margin: "0 0 6px", fontSize: "12px", lineHeight: 1.5, color: "var(--aacp-muted)" }}>
          {offer.kind === "percentage" || offer.kind === "progressive"
            ? `${percent(offer.discountPercent)}% nos produtos, limitado a ${money(offer.maxDiscountCents)}.`
            : `Limite de ${money(offer.maxDiscountCents)}, sem ultrapassar ${percent(offer.discountPercent)}% do valor dos produtos.`}
          {offer.kind === "shipping" ? " O abatimento não ultrapassa o frete cobrado." : ""}
        </p>
        {offer.deliveryMode === "coupon_code" && <p style={{ margin: "0 0 6px", fontSize: "12px", lineHeight: 1.5, color: "var(--aacp-fg)" }}>
          Cupom aplicado automaticamente: <strong style={{ fontVariantNumeric: "tabular-nums" }}>{offer.couponCode}</strong>
          <span style={{ display: "block", color: "var(--aacp-muted)" }}>Válido somente para você nesta compra.</span>
        </p>}
        <p style={{ margin: "0 0 6px", fontSize: "12px", lineHeight: 1.5, color: "var(--aacp-muted)" }}>{offer.condition}</p>
        <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.5, color: "var(--aacp-muted)" }}>
          Válido até <time dateTime={offer.expiresAt}>{new Date(offer.expiresAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</time>.
        </p>
      </li>)}
    </ul>
  </section>;
}
