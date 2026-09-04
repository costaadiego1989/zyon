import React, { useEffect, useState } from "react";
import { Check, Sparkles, CreditCard, ShieldCheck } from "lucide-react";
import { Button } from "../../../components/Button.js";
import { useApi } from "../../../hooks/useApi.js";
import type { BillingPlanCard } from "../../../api/types.js";

type Props = {
  merchantName: string;
  merchantEmail?: string;
  onDone: () => void;
};

type CardForm = {
  holderName: string;
  number: string;
  expiry: string; // MM/YY
  ccv: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone: string;
};

const EMPTY_CARD: CardForm = {
  holderName: "", number: "", expiry: "", ccv: "",
  cpfCnpj: "", postalCode: "", addressNumber: "", phone: "",
};

const FEATURE_LABELS: Record<string, string> = {
  customAgentName: "Nome do agente personalizado",
  customTheme: "Tema e marca personalizados",
  voiceCheckout: "Checkout por voz",
  faceBiometry: "Biometria facial",
  cryptoPayments: "Pagamento em cripto",
  whiteLabel: "White-label",
  publicApiV1: "API pública v1",
  abTests: "Testes A/B",
  marketplace: "Marketplace",
  intentMemory: "Memória de intenção (IA)",
  revenueLift: "Revenue Lift",
  advancedRules: "Regras avançadas",
  knowledgeBase: "Base de conhecimento",
  postSale: "Pós-venda",
  customDomain: "Domínio próprio",
  crmIntegrations: "Integrações CRM",
  revenueManager: "Revenue Manager (IA autônoma)",
  m2mAgents: "Agentes M2M",
};

export function PlanSelection({ merchantName, merchantEmail, onDone }: Props) {
  const api = useApi();
  const [plans, setPlans] = useState<BillingPlanCard[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payingPlan, setPayingPlan] = useState<"growth" | "scale" | null>(null);
  const [card, setCard] = useState<CardForm>(EMPTY_CARD);

  useEffect(() => {
    let alive = true;
    api.listBillingPlans()
      .then((p) => { if (alive) setPlans(p); })
      .catch(() => { if (alive) setPlans(FALLBACK_PLANS); });
    return () => { alive = false; };
  }, [api]);

  const startTrial = async () => {
    setBusy(true); setError(null);
    try {
      await api.startBillingTrial();
      onDone();
    } catch {
      setError("Não foi possível iniciar o teste grátis. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  const submitPaid = async (planKey: "growth" | "scale") => {
    setBusy(true); setError(null);
    const [mm, yy] = card.expiry.split("/").map((s) => s.trim());
    try {
      await api.subscribeToPlan({
        planKey,
        card: {
          holderName: card.holderName,
          number: card.number.replace(/\s/g, ""),
          expiryMonth: mm ?? "",
          expiryYear: yy && yy.length === 2 ? `20${yy}` : (yy ?? ""),
          ccv: card.ccv,
        },
        holderInfo: {
          name: card.holderName || merchantName,
          email: merchantEmail ?? "",
          cpfCnpj: card.cpfCnpj,
          postalCode: card.postalCode,
          addressNumber: card.addressNumber,
          phone: card.phone,
        },
      });
      onDone();
    } catch {
      setError("Não foi possível processar a assinatura. Verifique os dados do cartão.");
    } finally {
      setBusy(false);
    }
  };

  if (!plans) {
    return (
      <div className="onb-loading" role="status" aria-live="polite">
        <span className="onb-loading-dot" aria-hidden="true" />
        Carregando planos...
      </div>
    );
  }

  return (
    <div className="plan-selection">
      <header className="plan-selection__header">
        <h1 className="plan-selection__title">Escolha seu plano, {merchantName}</h1>
        <p className="plan-selection__lead">
          Comece grátis por 14 dias ou assine agora. Você pode mudar de plano quando quiser.
        </p>
      </header>

      {error && <div className="onb-message" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="plan-grid">
        {plans.map((plan) => {
          const isStarter = plan.key === "starter";
          const isPaying = payingPlan === plan.key;
          return (
            <div
              key={plan.key}
              className={`plan-card${plan.recommended ? " plan-card--recommended" : ""}`}
            >
              {plan.recommended && (
                <span className="plan-card__ribbon"><Sparkles size={12} /> Recomendado</span>
              )}
              <div className="plan-card__head">
                <h3 className="plan-card__name">{plan.name}</h3>
                {plan.badge && <span className="plan-card__badge">{plan.badge}</span>}
              </div>
              <div className="plan-card__price">
                {plan.priceBrl === 0 ? (
                  <span className="plan-card__price-free">Grátis</span>
                ) : (
                  <>
                    <span className="plan-card__price-value">R$ {plan.priceBrl}</span>
                    <span className="plan-card__price-cycle">/mês</span>
                  </>
                )}
              </div>
              <ul className="plan-card__features">
                {plan.features.slice(0, 8).map((fk) => (
                  <li key={fk}><Check size={14} /> {FEATURE_LABELS[fk] ?? fk}</li>
                ))}
              </ul>

              {isStarter ? (
                <Button variant="primary" arrow disabled={busy} onClick={() => void startTrial()} style={{ width: "100%" }}>
                  {plan.ctaLabel}
                </Button>
              ) : isPaying ? (
                <div className="plan-card__form">
                  <div className="plan-card__form-title"><CreditCard size={14} /> Dados do cartão</div>
                  <input className="plan-input" placeholder="Nome no cartão" value={card.holderName} onChange={(e) => setCard({ ...card, holderName: e.target.value })} />
                  <input className="plan-input" placeholder="Número do cartão" value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} inputMode="numeric" />
                  <div className="plan-input-row">
                    <input className="plan-input" placeholder="MM/AA" value={card.expiry} onChange={(e) => setCard({ ...card, expiry: e.target.value })} />
                    <input className="plan-input" placeholder="CVV" value={card.ccv} onChange={(e) => setCard({ ...card, ccv: e.target.value })} inputMode="numeric" />
                  </div>
                  <input className="plan-input" placeholder="CPF/CNPJ do titular" value={card.cpfCnpj} onChange={(e) => setCard({ ...card, cpfCnpj: e.target.value })} inputMode="numeric" />
                  <div className="plan-input-row">
                    <input className="plan-input" placeholder="CEP" value={card.postalCode} onChange={(e) => setCard({ ...card, postalCode: e.target.value })} inputMode="numeric" />
                    <input className="plan-input" placeholder="Nº" value={card.addressNumber} onChange={(e) => setCard({ ...card, addressNumber: e.target.value })} />
                  </div>
                  <input className="plan-input" placeholder="Telefone" value={card.phone} onChange={(e) => setCard({ ...card, phone: e.target.value })} inputMode="tel" />
                  <div className="plan-card__form-actions">
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setPayingPlan(null); setCard(EMPTY_CARD); }}>Cancelar</Button>
                    <Button variant="primary" size="sm" disabled={busy} onClick={() => void submitPaid(plan.key as "growth" | "scale")}>
                      {busy ? "Processando..." : `Assinar R$ ${plan.priceBrl}/mês`}
                    </Button>
                  </div>
                  <p className="plan-card__secure"><ShieldCheck size={12} /> Pagamento seguro via Asaas</p>
                </div>
              ) : (
                <Button variant={plan.recommended ? "primary" : "outline"} disabled={busy} onClick={() => setPayingPlan(plan.key as "growth" | "scale")} style={{ width: "100%" }}>
                  {plan.ctaLabel}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Fallback if the plans endpoint is unavailable — keeps onboarding unblocked.
const FALLBACK_PLANS: BillingPlanCard[] = [
  { key: "starter", name: "Starter", priceBrl: 0, trialDays: 14, badge: "14 dias grátis", recommended: false, ctaLabel: "Começar grátis", features: ["customAgentName", "customTheme"] },
  { key: "growth", name: "Growth", priceBrl: 249, trialDays: 0, badge: null, recommended: true, ctaLabel: "Assinar", features: ["voiceCheckout", "cryptoPayments", "whiteLabel", "publicApiV1", "advancedRules", "knowledgeBase", "postSale", "crmIntegrations"] },
  { key: "scale", name: "Scale", priceBrl: 599, trialDays: 0, badge: null, recommended: false, ctaLabel: "Assinar", features: ["abTests", "marketplace", "intentMemory", "revenueManager", "m2mAgents", "revenueLift", "customDomain"] },
];
