import { rememberSubscriptionPlan, clearSubscriptionIntent, type SubscriptionPlan } from "../../../auth/subscription-intent.js";
import React, { useEffect, useRef, useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import type { PlanDef } from "../../billing-plans/components/PlanCard.js";
import { ArrowRight, Check, CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "../../../components/Button.js";
import { toPlanDef } from "../../billing-plans/plan-catalog.js";
import { BILLING_PLAN_PRESENTATION } from "@zyon/shared-types";
import "../../billing-plans/billing-plans-page.css";
import "./signup-plans-modern.css";

type Props = {
  merchantName: string;
  initialPlan?: SubscriptionPlan;
  onExit?: () => void | Promise<void>;
  merchantEmail?: string;
  onDone: () => void | Promise<void>;
};

export function PlanSelection({ merchantName, initialPlan, onDone, onExit }: Props) {
  const api = useApi();
  const [plans, setPlans] = useState<PlanDef[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<PlanDef["key"]>(initialPlan ?? "starter");
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(new URLSearchParams(window.location.search).get("billing") === "success");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(new URLSearchParams(window.location.search).get("billing") === "cancelled" ? "O pagamento não foi concluído. Seu acesso e o plano escolhido continuam aqui para você retomar." : null);
  const [expanded, setExpanded] = useState(!initialPlan);
  const [paymentPending] = useState(new URLSearchParams(window.location.search).get("billing") === "success");
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  async function loadPlans() {
    setLoading(true);
    setError(null);
    try { setPlans((await api.listBillingPlans()).map(toPlanDef)); }
    catch { setError("Não foi possível carregar os planos. Tente novamente."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadPlans(); }, [api]);

  useEffect(() => {
    if (!confirming) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function check() {
      try {
        const sub = await api.getBillingSubscription();
        if (stopped) return;
        if (sub.status === "active" && sub.plan !== "starter" && (!initialPlan || sub.plan === initialPlan)) {
          await doneRef.current();
          return;
        }
      } catch {
        if (stopped) return;
      }
      if (++attempts < 15) timer = setTimeout(check, 2000);
      else {
        setConfirming(false);
        setNotice("A confirmação da assinatura ainda está pendente. Atualize o status em instantes. Seu acesso está salvo.");
      }
    }
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [confirming, api, initialPlan]);

  async function select(plan: PlanDef["key"]) {
    setBusy(true);
    setError(null);
    try {
      rememberSubscriptionPlan(plan);
      if (plan === "starter") {
        await api.startBillingTrial();
        await doneRef.current();
      } else {
        const sub = await api.getBillingSubscription();
        if (sub.status === "active" && sub.plan === plan) { await doneRef.current(); return; }
        const activeSubscription = sub.has_subscription && !["cancelled", "canceled", "incomplete_expired"].includes(sub.status);
        const session = activeSubscription
          ? await api.createBillingPortalSession({})
          : await api.createBillingCheckoutSession({ plan });
        if (activeSubscription) clearSubscriptionIntent();
        window.location.assign(session.url);
      }
    } catch {
      setError("Não foi possível concluir esta etapa. Seus dados foram salvos. Tente novamente.");
    } finally { setBusy(false); }
  }

  const selectedPlan = plans.find(plan => plan.key === selected);
  return <section className="plan-selection" aria-labelledby="plan-selection-title">
    <div className="plan-selection__brand"><a href="https://www.zyon-payments.com.br/" aria-label="Zyon, voltar ao site"><img src="/logo-zyon.png" alt="Zyon" /></a><span><CheckCircle2 size={15} /> Acesso confirmado</span></div>
    <header className="plan-selection__header">
      <p className="plan-selection__eyebrow">SEU PLANO · {merchantName}</p>
      <h1 id="plan-selection-title">{initialPlan ? "Tudo pronto para continuar." : "Sua loja pronta para o próximo passo."}</h1>
      <p>{initialPlan ? "Trouxemos sua escolha do site. Confira as condições, confirme a assinatura e volte ao painel com seu acesso preservado." : "Escolha o plano que acompanha sua operação. Compare os limites e confira as taxas."}</p>
    </header>
    {error && <div role="alert" className="plan-selection__message plan-selection__message--error">{error} {!plans.length && <Button variant="outline" onClick={() => void loadPlans()}>Tentar novamente</Button>}</div>}
    {notice && <div role="status" className="plan-selection__message">{notice}{paymentPending && <Button variant="outline" disabled={confirming} onClick={() => setConfirming(true)}>Atualizar status</Button>}</div>}
    {confirming && <p role="status" className="plan-selection__message"><LoaderCircle size={18} /> Confirmando sua assinatura…</p>}
    {loading ? <div className="plan-selection__loading" role="status">Carregando planos…</div> : <fieldset className={`plan-selection__grid${expanded ? "" : " plan-selection__grid--focused"}`} disabled={busy || confirming || paymentPending}>
      <legend className="sr-only">Escolha seu plano</legend>
      {plans.filter(plan => expanded || plan.key === selected).map(plan => <SignupPlan key={plan.key} plan={plan} selected={selected === plan.key} onSelect={() => setSelected(plan.key)} />)}
    </fieldset>}
    {initialPlan && <button type="button" className="plan-selection__change" disabled={busy || confirming || paymentPending} onClick={() => setExpanded(!expanded)}>{expanded ? "Voltar ao resumo do plano" : "Comparar ou trocar plano"}</button>}
    <p className="plan-selection__terms"><ShieldCheck size={18} /><span>Planos pagos têm cobrança mensal, confirmada no Stripe antes de assinar. O comprador paga R$ 0,99 de serviço por compra. Taxas do provedor de pagamento são separadas. No Free, novos cadastros têm 14 dias sem a taxa de transação Zyon da loja.</span></p>
    <footer className="plan-selection__footer">
      <div aria-live="polite"><span>Plano selecionado</span><strong>{selectedPlan ? `${selectedPlan.name} · ${money(selectedPlan.price)}` : "Carregando…"}<small>/mês</small></strong></div>
      <Button variant="primary" disabled={loading || busy || confirming || paymentPending || !selectedPlan} onClick={() => void select(selected)}>
        {busy || confirming ? <><LoaderCircle size={16} /> Aguarde…</> : <>{selected === "starter" ? "Começar no Free" : `Confirmar ${selectedPlan?.name ?? "plano"} no Stripe`}<ArrowRight size={16} /></>}
      </Button>
    </footer>
    {onExit && <button className="plan-selection__change" type="button" disabled={busy || confirming} onClick={() => void onExit()}>Ir para meu painel</button>}
  </section>;
}

function money(value: number) { return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function SignupPlan({ plan, selected, onSelect }: { plan: PlanDef; selected: boolean; onSelect: () => void }) {
  const copy = BILLING_PLAN_PRESENTATION[plan.key];
  const highlights = plan.highlights ?? [];
  const visible = [...highlights.slice(0,4), ...plan.features.slice(0,3)];
  const additional = [...highlights.slice(4), ...plan.features.slice(3)];
  return <article className={`signup-plan${plan.recommended ? " signup-plan--featured" : ""}${selected ? " signup-plan--selected" : ""}`}>
    <div className="signup-plan__label">{copy.eyebrow}<span>{copy.badge}</span></div>
    <label className="signup-plan__choice" htmlFor={`signup-plan-${plan.key}`}>
      <div className="signup-plan__heading"><h2>{plan.name}</h2><input id={`signup-plan-${plan.key}`} type="radio" name="signup-plan" value={plan.key} checked={selected} onChange={onSelect} aria-label={`Selecionar ${plan.name}`} /></div>
      <p className="signup-plan__description">{copy.description}</p>
      <div className="signup-plan__price"><strong>{money(plan.price)}</strong><span>/mês</span></div>
      <p className="signup-plan__fee">{plan.key === "starter" ? `Após os 14 dias iniciais: ${plan.fee} por transação.` : `${plan.fee} por transação. Assinatura mensal.`}</p>
    </label>
    <p className="signup-plan__includes">{copy.includes}</p>
    <ul className="signup-plan__features">{visible.map(feature => <li key={feature}><Check size={15} />{feature}</li>)}</ul>
    {additional.length > 0 && <details className="signup-plan__details"><summary>Todos os recursos e limites <span aria-hidden="true">+</span></summary><ul className="signup-plan__features">{additional.map(feature => <li key={feature}><Check size={15} />{feature}</li>)}</ul></details>}
    <button type="button" className="signup-plan__select" onClick={onSelect}>{selected ? <><CheckCircle2 size={16} /> Plano selecionado</> : <>Escolher {plan.name}<ArrowRight size={16} /></>}</button>
  </article>;
}
