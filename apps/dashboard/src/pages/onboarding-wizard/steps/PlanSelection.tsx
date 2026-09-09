import React, { useEffect, useRef, useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import type { PlanDef } from "../../billing-plans/components/PlanCard.js";
import { ArrowRight, Check, CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "../../../components/Button.js";
import { toPlanDef } from "../../billing-plans/plan-catalog.js";
import "../../billing-plans/billing-plans-page.css";
import "./plan-selection.css";

type Props = {
  merchantName: string;
  merchantEmail?: string;
  onDone: () => void | Promise<void>;
};

export function PlanSelection({ merchantName, onDone }: Props) {
  const api = useApi();
  const [plans, setPlans] = useState<PlanDef[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<PlanDef["key"]>("starter");
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(new URLSearchParams(window.location.search).get("billing") === "success");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
        if (sub.status === "active" && sub.plan !== "starter") {
          await doneRef.current();
          return;
        }
      } catch {
        if (stopped) return;
      }
      if (++attempts < 15) timer = setTimeout(check, 2000);
      else {
        setConfirming(false);
        setNotice("A confirmação do pagamento ainda está pendente. Você pode atualizar o status ou entrar no Free enquanto aguardamos.");
      }
    }
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [confirming, api]);

  async function select(plan: PlanDef["key"]) {
    setBusy(true);
    setError(null);
    try {
      if (plan === "starter") {
        await api.startBillingTrial();
        await doneRef.current();
      } else {
        const sub = await api.getBillingSubscription();
        const activeSubscription = sub.has_subscription && !["cancelled", "canceled", "incomplete_expired"].includes(sub.status);
        const session = activeSubscription
          ? await api.createBillingPortalSession({})
          : await api.createBillingCheckoutSession({ plan });
        window.location.assign(session.url);
      }
    } catch {
      setError("Não foi possível concluir esta etapa. Seus dados foram salvos. Tente novamente.");
    } finally { setBusy(false); }
  }

  const selectedPlan = plans.find(plan => plan.key === selected);
  return <section className="plan-selection" aria-labelledby="plan-selection-title">
    <div className="plan-selection__brand"><img src="/logo-zyon.png" alt="Zyon" /><span><CheckCircle2 size={15} /> Conta criada</span></div>
    <header className="plan-selection__header">
      <p className="plan-selection__eyebrow">ÚLTIMA ETAPA · {merchantName}</p>
      <h1 id="plan-selection-title">Sua loja pronta para o próximo passo.</h1>
      <p>Escolha o plano que acompanha sua operação. Compare os limites, confira as taxas e comece a vender com a Zyon.</p>
    </header>
    {error && <div role="alert" className="plan-selection__message plan-selection__message--error">{error} {!plans.length && <Button variant="outline" onClick={() => void loadPlans()}>Tentar novamente</Button>}</div>}
    {notice && <div role="status" className="plan-selection__message">{notice}<Button variant="outline" onClick={() => setConfirming(true)}>Atualizar status</Button></div>}
    {confirming && <p role="status" className="plan-selection__message"><LoaderCircle size={18} /> Confirmando sua assinatura…</p>}
    {loading ? <div className="plan-selection__loading" role="status">Carregando planos…</div> : <fieldset className="plan-selection__grid" disabled={busy || confirming}>
      <legend className="sr-only">Escolha seu plano</legend>
      {plans.map(plan => <SignupPlan key={plan.key} plan={plan} selected={selected === plan.key} onSelect={() => setSelected(plan.key)} />)}
    </fieldset>}
    <p className="plan-selection__terms"><ShieldCheck size={18} /> Planos pagos têm cobrança mensal, confirmada no Stripe antes de assinar. Taxas do seu provedor de pagamento são cobradas separadamente.</p>
    <footer className="plan-selection__footer">
      <div aria-live="polite"><span>Plano selecionado</span><strong>{selectedPlan ? `${selectedPlan.name} · ${money(selectedPlan.price)}` : "Carregando…"}<small>/mês</small></strong></div>
      <Button variant="primary" disabled={loading || busy || confirming || !selectedPlan} onClick={() => void select(selected)}>
        {busy || confirming ? <><LoaderCircle size={16} /> Aguarde…</> : <>{selected === "starter" ? "Começar no Free" : `Continuar com ${selectedPlan?.name ?? "plano"}`}<ArrowRight size={16} /></>}
      </Button>
    </footer>
  </section>;
}

const PLAN_COPY = {
  starter: "Coloque sua loja no ar e faça suas primeiras vendas.",
  growth: "Amplie o atendimento e conecte sua operação.",
  scale: "Mais capacidade e controle para uma operação em expansão.",
};
function money(value: number) { return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function limit(value: number) { return value < 0 ? "Ilimitado" : value.toLocaleString("pt-BR"); }
function SignupPlan({ plan, selected, onSelect }: { plan: PlanDef; selected: boolean; onSelect: () => void }) {
  return <article className={`signup-plan${selected ? " signup-plan--selected" : ""}`}>
    <label className="signup-plan__choice">
      <div className="signup-plan__heading"><h2>{plan.name}</h2><input type="radio" name="signup-plan" value={plan.key} checked={selected} onChange={onSelect} aria-label={`Selecionar ${plan.name}`} /></div>
      <span className="signup-plan__badge" aria-hidden={!plan.recommended}>{plan.recommended ? "Recomendado" : "\u00a0"}</span>
      <p className="signup-plan__description">{PLAN_COPY[plan.key]}</p>
      <div className="signup-plan__price"><strong>{money(plan.price)}</strong><span>/mês</span></div>
      <p className="signup-plan__fee">{plan.key === "starter" ? `14 dias sem taxa Zyon. Depois, ${plan.fee} por transação.` : `${plan.fee} por transação Zyon.`}</p>
    </label>
    <dl className="signup-plan__limits">
      {[["Pedidos por mês", plan.limits.orders], ["Sessões por mês", plan.limits.sessions], ["Conversas IA por mês", plan.limits.ai], ["Conexões", plan.limits.connections]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{limit(value as number)}</dd></div>)}
    </dl>
    <ul className="signup-plan__features">{plan.features.slice(0, 4).map(feature => <li key={feature}><Check size={15} />{feature}</li>)}</ul>
    {plan.features.length > 4 ? <details className="signup-plan__details"><summary>Ver todos os {plan.features.length} recursos</summary><ul className="signup-plan__features">{plan.features.slice(4).map(feature => <li key={feature}><Check size={15} />{feature}</li>)}</ul></details> : null}
  </article>;
}
