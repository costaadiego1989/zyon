import React, { useEffect, useRef, useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import { PlanCard, type PlanDef } from "../../billing-plans/components/PlanCard.js";
import { toPlanDef } from "../../billing-plans/plan-catalog.js";
import "../../billing-plans/billing-plans-page.css";

type Props = {
  merchantName: string;
  merchantEmail?: string;
  onDone: () => void | Promise<void>;
};

export function PlanSelection({ merchantName, onDone }: Props) {
  const api = useApi();
  const [plans, setPlans] = useState<PlanDef[]>([]);
  const [busy, setBusy] = useState(false);
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

  return (
    <div className="billing-plans">
      <header className="billing-plans__header">
        <p className="billing-plans__subtitle">Última etapa · {merchantName}</p>
        <h1 className="billing-plans__title">Escolha como começar</h1>
        <p className="billing-plans__subtitle">Sua conta começa no Free: 14 dias sem taxa de transação Zyon. Depois, R$ 2,99 por transação, com acesso mantido. Escolha um plano pago para ampliar os recursos.</p>
        <p className="billing-plans__subtitle">Planos pagos têm cobrança mensal. Você confirma o valor e o pagamento no Stripe. Taxas dos provedores de pagamento continuam aplicáveis.</p>
      </header>
      {error && <div role="alert" className="billing-plans__error">{error} {!plans.length && <button type="button" onClick={() => void loadPlans()}>Tentar novamente</button>}</div>}
      {notice && <p role="status">{notice} <button type="button" onClick={() => setConfirming(true)}>Atualizar status</button></p>}
      {confirming && <p role="status">Confirmando sua assinatura…</p>}
      {loading ? <p role="status">Carregando planos…</p> : (
        <div className="billing-plans__plans-grid">
          {plans.map(plan => <PlanCard key={plan.key} plan={plan} isCurrent={false} isDowngrade={false}
            upgrading={busy || confirming} onUpgrade={() => void select(plan.key)}
            actionLabel={busy ? "Aguarde…" : plan.key === "starter" ? "Continuar no Free" : `Escolher ${plan.name}`} />)}
        </div>
      )}
    </div>
  );
}
