import React from "react";
import { Check, X, Crown, Sparkles, ExternalLink } from "lucide-react";

interface PlanFeature {
  label: string;
  checkout: string | boolean;
  store: string | boolean;
  both: string | boolean;
}

interface Plan {
  key: "CHECKOUT_ONLY" | "STORE_ONLY" | "BOTH";
  name: string;
  price: string;
  period: string;
  description: string;
  popular?: boolean;
}

const PLANS: Plan[] = [
  {
    key: "CHECKOUT_ONLY",
    name: "Checkout",
    price: "R$ 299",
    period: "/mês",
    description: "Checkout conversacional para lojas existentes",
  },
  {
    key: "STORE_ONLY",
    name: "Store",
    price: "R$ 499",
    period: "/mês",
    description: "Loja completa com IA integrada",
    popular: true,
  },
  {
    key: "BOTH",
    name: "Both",
    price: "R$ 699",
    period: "/mês",
    description: "Checkout + Store: plataforma completa",
  },
];

const FEATURES: PlanFeature[] = [
  { label: "Produtos", checkout: "Externos", store: "Ilimitados", both: "Todos" },
  { label: "Conversas/mês", checkout: "500", store: "2.000", both: "5.000" },
  { label: "Membros da equipe", checkout: "1", store: "5", both: "10" },
  { label: "Domínio personalizado", checkout: false, store: true, both: true },
  { label: "Analytics", checkout: "Básico", store: "Completo", both: "Completo" },
  { label: "Voz (IA)", checkout: false, store: false, both: "Add-on" },
  { label: "Checkout conversacional", checkout: true, store: false, both: true },
  { label: "Store Builder", checkout: false, store: true, both: true },
  { label: "Negociação automática", checkout: true, store: false, both: true },
  { label: "Catálogo visual", checkout: false, store: true, both: true },
  { label: "Rastreio de pedidos", checkout: false, store: true, both: true },
  { label: "Suporte prioritário", checkout: false, store: true, both: true },
];

const PAYMENT_HISTORY = [
  { date: "2026-07-14", amount: "R$ 499,00", status: "Pago", invoice: "#INV-2026-007" },
  { date: "2026-06-14", amount: "R$ 499,00", status: "Pago", invoice: "#INV-2026-006" },
  { date: "2026-05-14", amount: "R$ 499,00", status: "Pago", invoice: "#INV-2026-005" },
  { date: "2026-04-14", amount: "R$ 499,00", status: "Pago", invoice: "#INV-2026-004" },
  { date: "2026-03-14", amount: "R$ 299,00", status: "Pago", invoice: "#INV-2026-003" },
];

function FeatureValue({ value }: { value: string | boolean }) {
  if (value === true) return <Check size={16} style={{ color: "var(--good, #22c55e)" }} />;
  if (value === false) return <X size={16} style={{ color: "var(--muted, #999)" }} />;
  return <span style={{ fontSize: 13, color: "var(--fg, #1a1a1a)" }}>{value}</span>;
}

export interface BillingPlansPageProps {
  currentPlan?: "CHECKOUT_ONLY" | "STORE_ONLY" | "BOTH" | null;
  renewalDate?: string | null;
}

export function BillingPlansPage({ currentPlan, renewalDate }: BillingPlansPageProps) {
  const whatsappUrl = "https://wa.me/5511999999999?text=Quero+fazer+upgrade+do+meu+plano";

  return (
    <div style={{ padding: "32px 0", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "var(--fg, #1a1a1a)" }}>
          Planos e Preços
        </h1>
        <p style={{ margin: "8px 0 0", color: "var(--muted, #666)", fontSize: 14 }}>
          Escolha o plano ideal para o seu negócio
        </p>
      </div>

      {/* Current Plan Card */}
      {currentPlan && (
        <div
          style={{
            padding: "20px 24px",
            borderRadius: 10,
            border: "1px solid var(--border, #e5e5e5)",
            background: "var(--bg-elevated, #fff)",
            marginBottom: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Crown size={16} style={{ color: "var(--accent, #2563eb)" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted, #666)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Plano Atual
              </span>
            </div>
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--fg, #1a1a1a)" }}>
              {PLANS.find((p) => p.key === currentPlan)?.name ?? currentPlan}
            </span>
          </div>
          {renewalDate && (
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: 12, color: "var(--muted, #666)" }}>Próxima renovação</span>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg, #1a1a1a)" }}>
                {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(renewalDate))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Plans Comparison Table */}
      <div
        style={{
          borderRadius: 10,
          border: "1px solid var(--border, #e5e5e5)",
          overflow: "hidden",
          marginBottom: 40,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "var(--bg-elevated, #fafafa)" }}>
              <th style={{ textAlign: "left", padding: "16px 20px", fontWeight: 600, color: "var(--muted, #666)", width: "30%" }}>
                Recurso
              </th>
              {PLANS.map((plan) => (
                <th
                  key={plan.key}
                  style={{
                    textAlign: "center",
                    padding: "16px 12px",
                    fontWeight: 600,
                    position: "relative",
                    borderLeft: "1px solid var(--border, #e5e5e5)",
                  }}
                >
                  {plan.popular && (
                    <span
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 8,
                        fontSize: 10,
                        fontWeight: 700,
                        background: "var(--accent, #2563eb)",
                        color: "#fff",
                        padding: "2px 6px",
                        borderRadius: 4,
                        textTransform: "uppercase",
                      }}
                    >
                      Popular
                    </span>
                  )}
                  <div style={{ color: "var(--fg, #1a1a1a)", fontSize: 16 }}>{plan.name}</div>
                  <div style={{ marginTop: 4 }}>
                    <span style={{ fontSize: 24, fontWeight: 800, color: "var(--fg, #1a1a1a)" }}>
                      {plan.price}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--muted, #666)" }}>{plan.period}</span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, color: "var(--muted, #888)" }}>
                    {plan.description}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((feature, idx) => (
              <tr
                key={feature.label}
                style={{
                  borderTop: "1px solid var(--border, #e5e5e5)",
                  background: idx % 2 === 0 ? "transparent" : "var(--bg-elevated, #fafafa)",
                }}
              >
                <td style={{ padding: "12px 20px", fontWeight: 500, color: "var(--fg, #1a1a1a)" }}>
                  {feature.label}
                </td>
                <td style={{ padding: "12px", textAlign: "center", borderLeft: "1px solid var(--border, #e5e5e5)" }}>
                  <FeatureValue value={feature.checkout} />
                </td>
                <td style={{ padding: "12px", textAlign: "center", borderLeft: "1px solid var(--border, #e5e5e5)" }}>
                  <FeatureValue value={feature.store} />
                </td>
                <td style={{ padding: "12px", textAlign: "center", borderLeft: "1px solid var(--border, #e5e5e5)" }}>
                  <FeatureValue value={feature.both} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Upgrade CTA */}
      <div
        style={{
          textAlign: "center",
          padding: "32px 24px",
          borderRadius: 10,
          border: "1px solid var(--border, #e5e5e5)",
          background: "var(--bg-elevated, #fff)",
          marginBottom: 40,
        }}
      >
        <Sparkles size={24} style={{ color: "var(--accent, #2563eb)", marginBottom: 12 }} />
        <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700, color: "var(--fg, #1a1a1a)" }}>
          Pronto para crescer?
        </h2>
        <p style={{ margin: "0 0 20px", color: "var(--muted, #666)", fontSize: 14 }}>
          Fale com nosso time para fazer upgrade do seu plano
        </p>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 28px",
            background: "var(--accent, #2563eb)",
            color: "#fff",
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 14,
            textDecoration: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          Fazer Upgrade
          <ExternalLink size={14} />
        </a>
      </div>

      {/* Payment History */}
      <div>
        <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, color: "var(--fg, #1a1a1a)" }}>
          Histórico de Pagamentos
        </h2>
        <div
          style={{
            borderRadius: 10,
            border: "1px solid var(--border, #e5e5e5)",
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "var(--bg-elevated, #fafafa)" }}>
                <th style={{ textAlign: "left", padding: "12px 20px", fontWeight: 600, color: "var(--muted, #666)" }}>
                  Data
                </th>
                <th style={{ textAlign: "left", padding: "12px 20px", fontWeight: 600, color: "var(--muted, #666)" }}>
                  Valor
                </th>
                <th style={{ textAlign: "left", padding: "12px 20px", fontWeight: 600, color: "var(--muted, #666)" }}>
                  Status
                </th>
                <th style={{ textAlign: "left", padding: "12px 20px", fontWeight: 600, color: "var(--muted, #666)" }}>
                  Fatura
                </th>
              </tr>
            </thead>
            <tbody>
              {PAYMENT_HISTORY.map((row) => (
                <tr key={row.invoice} style={{ borderTop: "1px solid var(--border, #e5e5e5)" }}>
                  <td style={{ padding: "12px 20px", color: "var(--fg, #1a1a1a)" }}>
                    {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(row.date))}
                  </td>
                  <td style={{ padding: "12px 20px", fontWeight: 600, color: "var(--fg, #1a1a1a)" }}>
                    {row.amount}
                  </td>
                  <td style={{ padding: "12px 20px" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                        background: "var(--good-soft, #dcfce7)",
                        color: "var(--good, #22c55e)",
                        border: "1px solid var(--good, #22c55e)",
                      }}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td style={{ padding: "12px 20px" }}>
                    <button
                      style={{
                        border: "none",
                        background: "none",
                        color: "var(--accent, #2563eb)",
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: "pointer",
                        textDecoration: "underline",
                        padding: 0,
                      }}
                      onClick={() => {
                        /* TODO: open invoice PDF */
                      }}
                    >
                      {row.invoice}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
