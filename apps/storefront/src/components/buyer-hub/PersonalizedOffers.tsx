"use client";

import { useEffect, useState } from "react";
import type { BuyerPersonalizedOffer } from "@/lib/viewmodels/useBuyerHub/types";
import { currentPersonalizedOffers } from "@/lib/personalized-offers";
import CouponCopy from "./CouponCopy";
import styles from "./LoyaltyBenefits.module.css";

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

  return <section aria-label={heading} className={styles.section}>
    <h3>{heading}</h3>
    <p className={styles.note}>
      Válidas somente na compra indicada. Confira o total no checkout antes de pagar.
    </p>
    <ul className={styles.list}>
      {current.map((offer) => <li key={offer.id} className={styles.row}>
        <h4 className={styles.title}>{titles[offer.kind]}</h4>
        <p className={styles.amount}>
          {money(offer.amountCents)} aplicados nesta compra
        </p>
        <p className={styles.description}>
          {offer.kind === "percentage" || offer.kind === "progressive"
            ? `${percent(offer.discountPercent)}% nos produtos, limitado a ${money(offer.maxDiscountCents)}.`
            : `Limite de ${money(offer.maxDiscountCents)}, sem ultrapassar ${percent(offer.discountPercent)}% do valor dos produtos.`}
          {offer.kind === "shipping" ? " O abatimento não ultrapassa o frete cobrado." : ""}
        </p>
        {offer.deliveryMode === "coupon_code" && <>
          <CouponCopy code={offer.couponCode!} applied />
        </>}
        <details className={styles.disclosure}>
          <summary>Condições e validade</summary>
          <dl className={styles.terms}><dt>Condição de uso</dt><dd>{offer.condition}</dd></dl>
          {offer.deliveryMode === "coupon_code" && <p className={styles.note}>Válido somente para você nesta compra. Não é necessário aplicar novamente.</p>}
          <p className={styles.expiry}>
            Válido até <time dateTime={offer.expiresAt}>{new Date(offer.expiresAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</time>.
          </p>
        </details>
      </li>)}
    </ul>
  </section>;
}
