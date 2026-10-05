"use client";

import type { BuyerLoyalty, BuyerSummary, DiscountRule, BuyerBenefits } from "@/lib/viewmodels/useBuyerHub";
import PersonalizedOffers from "../PersonalizedOffers";
import CouponCopy from "../CouponCopy";
import styles from "../LoyaltyBenefits.module.css";

export interface LoyaltyCartSnapshot {
  subtotalCents: number | null;
  itemCount?: number | null;
  nextNudge?: { kind: string; gap?: number; message: string; reachable: boolean; ruleId?: string };
  freeShipping?: boolean;
  activeRules?: Array<{ ruleId?: string; message: string }>;
}

export interface LoyaltyTabProps {
  loyalty: BuyerLoyalty | null;
  summary: BuyerSummary | null;
  discountRules: DiscountRule[] | null;
  benefits: BuyerBenefits | null;
  loading: boolean;
  benefitsError?: string | null;
  onRetryBenefits?: () => void;
  couponsError?: string | null;
  onRetryCoupons?: () => void;
  /** Only a current, tenant-scoped cart response may supply numeric progress. */
  cartSnapshot?: LoyaltyCartSnapshot;
}

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const amount = (reais: number) => currency.format(reais);
const validNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const validCount = (value: unknown): value is number => validNumber(value) && Number.isSafeInteger(value);

function minimumState(targetReais: number, snapshot?: LoyaltyCartSnapshot) {
  if (!validNumber(targetReais) || targetReais <= 0 || !validCount(snapshot?.subtotalCents)) return null;
  const targetCents = Math.round(targetReais * 100);
  return { current: snapshot.subtotalCents / 100, target: targetCents / 100, remaining: Math.max(0, targetCents - snapshot.subtotalCents) / 100 };
}

function ProgressMeter({ current, target, unit, label }: { current: number; target: number; unit: "money" | "items"; label: string }) {
  if (!validNumber(current) || !validNumber(target) || target <= 0) return null;
  const ratio = Math.min(1, current / target);
  const format = (value: number) => unit === "money" ? amount(value) : `${value} ${value === 1 ? "item" : "itens"}`;
  return <>
    <div className={styles.progress} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={target}
      aria-valuenow={Math.min(current, target)} aria-valuetext={`${format(current)} de ${format(target)}`}>
      <span style={{ transform: `scaleX(${ratio})` }} />
    </div>
    <div className={styles.progressCaption}><span>{format(current)} no carrinho</span><span>Meta: {format(target)}</span></div>
  </>;
}

function couponTitle(rule: DiscountRule): string {
  const value = Number(rule.discount_value);
  switch (rule.discount_type) {
    case "percent": return `${value}% de desconto`;
    case "fixed": return `${amount(value)} de desconto`;
    case "shipping_free": return "Frete grátis";
    case "shipping_percent": return `${value}% de desconto no frete`;
    case "shipping_fixed": return `${amount(value)} de desconto no frete`;
  }
}

function conditionText(condition: string) {
  if (condition === "sempre") return "Confira a aplicação no checkout.";
  // Older API versions exposed raw rule expressions. They are not buyer copy.
  if (/\b(?:cart_total|cart_item_count|shipping_cost|payment_method|buyer_type|coupon_applied|skus_in_cart|categories_in_cart)\b/.test(condition)) {
    return "Confira as condições desta oferta no checkout.";
  }
  return condition;
}

export default function LoyaltyTab({ loyalty, summary, discountRules, benefits, loading, benefitsError, onRetryBenefits, couponsError, onRetryCoupons, cartSnapshot }: LoyaltyTabProps) {
  if (loading) return <div className={styles.loading} role="status" aria-busy="true" aria-label="Carregando seus benefícios">
    <span className={styles.note}>Atualizando seus benefícios…</span>
    {[0, 1, 2].map((item) => <div key={item} className={styles.skeleton} aria-hidden="true" />)}
  </div>;

  const coupons = (discountRules ?? []).filter((rule) => rule.code?.trim() &&
    ["percent", "fixed", "shipping_free", "shipping_percent", "shipping_fixed"].includes(rule.discount_type) &&
    validNumber(Number(rule.discount_value)) &&
    (rule.max_usages == null || rule.usages_count < rule.max_usages));
  const next = cartSnapshot?.nextNudge;
  const nudge = next && typeof next.message === "string" && next.message.trim() ? next : undefined;
  const subtotal = validCount(cartSnapshot?.subtotalCents) ? cartSnapshot.subtotalCents / 100 : null;
  const itemCount = validCount(cartSnapshot?.itemCount) ? cartSnapshot.itemCount : null;
  const nudgeProgress = nudge?.reachable && validNumber(nudge.gap) && nudge.gap > 0
    ? nudge.kind === "cart_total" && subtotal !== null
      ? { current: subtotal, target: subtotal + nudge.gap, unit: "money" as const }
      : nudge.kind === "cart_item_count" && itemCount !== null && validCount(nudge.gap)
        ? { current: itemCount, target: itemCount + nudge.gap, unit: "items" as const } : null
    : null;
  const shippingThresholds = (benefits?.progress ?? []).filter((item) => validNumber(item.target) && item.target > 0);
  const earned = (benefits?.earned ?? []).filter((item) => item.description?.trim() && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()));
  const active = cartSnapshot?.activeRules?.filter((rule) => typeof rule.message === "string" && rule.message.trim()) ?? [];
  const ordersCount = validCount(summary?.orders_count) ? summary.orders_count : validCount(loyalty?.total_orders) ? loyalty.total_orders : 0;
  const totalSpent = validNumber(summary?.total_spent) ? summary.total_spent : validNumber(loyalty?.total_spent_cents) ? loyalty.total_spent_cents / 100 : 0;

  return <div className={styles.root}>
    <header className={styles.intro}>
      <h2>Seus benefícios</h2>
      <p>Confira os descontos desta compra e as condições para aproveitar outras ofertas.</p>
    </header>

    <PersonalizedOffers offers={benefits?.offers} />

    {benefitsError && <div className={styles.error} role="status">
      <p className={styles.note}>{benefitsError}</p>
      {onRetryBenefits && <button type="button" className={styles.action} data-neu="control" onClick={onRetryBenefits}>Atualizar benefícios</button>}
    </div>}

    {(cartSnapshot?.freeShipping || active.length > 0) && <section className={styles.section} aria-label="Aplicado ao seu carrinho">
      <h3>Aplicado ao seu carrinho</h3>
      <ul className={styles.list}>
        {cartSnapshot?.freeShipping && <li className={styles.row}><h4 className={styles.title}>Frete grátis</h4><p className={styles.note}>Confira o endereço, a opção de entrega e o total antes de pagar.</p></li>}
        {active.filter((rule) => !cartSnapshot?.freeShipping || rule.message !== "Frete grátis aplicado").map((rule, index) => <li key={rule.ruleId ?? index} className={styles.row}><p className={styles.title}>{rule.message}</p></li>)}
      </ul>
    </section>}

    {(nudge || (!cartSnapshot?.freeShipping && shippingThresholds.length > 0)) && <section className={styles.section} aria-label="Como aproveitar mais benefícios">
      <h3>Como aproveitar mais benefícios</h3>
      {nudge ? <div className={styles.requirement}>
        <p className={styles.title}>{nudge.message}</p>
        {nudgeProgress && <ProgressMeter {...nudgeProgress} label="Progresso da condição do carrinho" />}
        <p className={styles.note} style={{ marginTop: 10 }}>O benefício será confirmado no checkout, conforme as condições do pedido.</p>
      </div> : shippingThresholds.map((progress, index) => {
        const state = minimumState(progress.target, cartSnapshot);
        return <div className={styles.requirement} key={`${progress.target}-${index}`}>
          <h4 className={styles.title}>Frete grátis</h4>
          <p className={styles.note}>Pedidos a partir de {amount(progress.target)}, sujeitos às condições de entrega.</p>
          {state && <>
            <p className={styles.met}>{state.remaining > 0 ? `Faltam ${amount(state.remaining)} para atingir o valor mínimo.` : "Valor mínimo atingido. Confirme o frete no checkout."}</p>
            <ProgressMeter current={state.current} target={state.target} unit="money" label="Valor mínimo para frete grátis" />
          </>}
        </div>;
      })}
    </section>}

    <section className={styles.section} aria-label="Cupons da loja">
      <h3>Cupons da loja</h3>
      {couponsError ? <div className={styles.error} role="status">
        <p className={styles.note}>Não foi possível carregar os cupons.</p>
        {onRetryCoupons && <button type="button" className={styles.action} data-neu="control" onClick={onRetryCoupons}>Tentar novamente</button>}
      </div> : coupons.length ? <ul className={styles.list} aria-label="Cupons de desconto disponíveis">{coupons.map((rule) => {
        const minimum = validNumber(rule.min_cart_total) && rule.min_cart_total > 0 ? rule.min_cart_total : null;
        const state = minimum !== null ? minimumState(minimum, cartSnapshot) : null;
        return <li className={styles.row} key={rule.id}>
          <h4 className={styles.title}>{couponTitle(rule)}</h4>
          {minimum !== null && <p className={styles.note}>Pedido mínimo de {amount(minimum)} em produtos.</p>}
          {state && <>
            <p className={styles.met}>{state.remaining > 0 ? `Faltam ${amount(state.remaining)} para o valor mínimo deste cupom.` : "Valor mínimo atingido. Valide o cupom no checkout."}</p>
            {state.remaining > 0 && <ProgressMeter current={state.current} target={state.target} unit="money" label={`Valor mínimo do cupom ${rule.code}`} />}
          </>}
          <CouponCopy code={rule.code} />
          <p className={styles.note} style={{ marginTop: 8 }}>Use o código no checkout. A aplicação depende das condições do pedido.</p>
        </li>;
      })}</ul> : <div className={styles.empty}><p>Nenhum cupom de uso geral disponível no momento.</p></div>}
    </section>

    {(benefits?.available?.length ?? 0) > 0 && <section className={styles.section} aria-label="Outras condições da loja">
      <h3>Outras condições da loja</h3>
      <ul className={styles.list} aria-label="Descontos disponíveis para você">{benefits!.available.map((benefit, index) => <li className={styles.row} key={benefit.ruleId || index}>
        <h4 className={styles.title}>{benefit.description}</h4>
        {validNumber(benefit.maxReais) && <p className={styles.note}>Desconto limitado a {amount(benefit.maxReais)}.</p>}
        <dl className={styles.terms}><dt>Condição de uso</dt><dd>{conditionText(benefit.condition)}</dd></dl>
      </li>)}</ul>
    </section>}

    {earned.length > 0 && <section className={styles.section} aria-label="Benefícios conquistados">
      <h3>Benefícios conquistados</h3>
      <ul className={styles.list} aria-label="Benefícios conquistados">{earned.map((benefit, index) => <li className={styles.row} key={`${benefit.description}-${index}`}>
        <h4 className={styles.title}>{benefit.description}</h4>
        <p className={styles.note}>Confira as condições de uso no checkout.</p>
        {benefit.expiresAt && <span className={styles.expiry}>Válido até <time dateTime={benefit.expiresAt}>{new Date(benefit.expiresAt).toLocaleDateString("pt-BR")}</time>.</span>}
      </li>)}</ul>
    </section>}

    <div role="group" aria-label="Indicadores de fidelidade">
      <details className={styles.history}>
        <summary>Seu histórico de compras</summary>
        {loyalty || summary ? <>
          <dl className={styles.ledger}>
            <div><dt>Pedidos realizados</dt><dd>{ordersCount}</dd></div>
            <div><dt>Total em compras</dt><dd>{amount(totalSpent)}</dd></div>
          </dl>
          {ordersCount === 0 && <p className={styles.note}>Você ainda não tem compras registradas.</p>}
        </> : <p className={styles.note}>Seu histórico de compras não está disponível no momento.</p>}
      </details>
    </div>
  </div>;
}
