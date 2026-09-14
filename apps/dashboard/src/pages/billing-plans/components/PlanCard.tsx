import type { BillingCycle, BillingOffer } from "@zyon/shared-types";
import { billingMoney, selectedBillingOffer } from "../plan-catalog.js";
import React from "react";
import { Button } from "../../../components/Button.js";

export interface PlanDef {
  key: "starter" | "growth" | "scale";
  name: string;
  price: number;
  billingOptions?: BillingOffer[];
  annualCheckoutAvailable?: boolean;
  fee: string;
  limits: { orders: number; connections: number };
  features: string[];
  recommended?: boolean;
  highlights?: string[];
  trialDays?: number;
}

interface PlanCardProps {
  plan: PlanDef;
  isCurrent: boolean;
  isDowngrade: boolean;
  onUpgrade: () => void;
  upgrading: boolean;
  actionLabel?: string;
  insufficientCapacity?: boolean;
  billingCycle?: BillingCycle;
}

function formatLimit(value: number): string {
  if (value < 0) return "Ilimitado";
  return value.toLocaleString("pt-BR");
}

export function PlanCard({
  plan,
  isCurrent,
  isDowngrade,
  onUpgrade,
  upgrading,
  actionLabel,
  insufficientCapacity = false,
  billingCycle = "monthly",
}: PlanCardProps) {
  const offer = selectedBillingOffer(plan, billingCycle);
  const borderColor = isCurrent
    ? "var(--color-brand)"
    : plan.recommended
      ? "var(--color-brand-ring)"
      : "var(--color-border)";

  const cardBg = plan.recommended
    ? "color-mix(in oklab, var(--color-brand-subtle) 50%, var(--surface-2))"
    : "var(--surface-2)";

  return (
    <div
      style={{
        flex: 1,
        minWidth: 240,
        padding: "24px",
        borderRadius: 14,
        border: `1px solid ${borderColor}`,
        background: cardBg,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        position: "relative",
        boxShadow: plan.recommended
          ? "0 4px 24px oklch(74% 0.19 149 / 0.08)"
          : undefined,
      }}
    >
      {/* Recommended badge */}
      {plan.recommended && !isCurrent && (
        <div
          style={{
            position: "absolute",
            top: -1,
            left: 20,
            right: 20,
            height: 2,
            background: "var(--color-brand)",
            borderRadius: "0 0 2px 2px",
          }}
        />
      )}

      {/* Plan name */}
      <div>
        <div
          style={{
            font: "600 10.5px var(--font-mono)",
            letterSpacing: "0.06em",
            color: "var(--color-text-faint)",
            marginBottom: 6,
          }}
        >
          {plan.recommended ? "RECOMENDADO" : plan.name.toUpperCase()}
        </div>
        <h4
          style={{
            font: "700 20px var(--font-serif)",
            color: "var(--color-text)",
            margin: 0,
          }}
        >
          {plan.name}
        </h4>
      </div>

      {/* Price */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          {plan.price > 0 ? (
            <>
              <span style={{ font: "800 28px var(--font-mono)", color: "var(--color-text)" }}>
                {offer ? billingMoney(offer.equivalentMonthlyCents) : "Indisponível"}
              </span>
              <span style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)" }}>
                /mês
              </span>
            </>
          ) : (
            <span style={{ font: "800 28px var(--font-mono)", color: "var(--color-text)" }}>
              Grátis
            </span>
          )}
        </div>
        <div style={{ font: "12px var(--font-mono)", color: "var(--color-text-muted)", marginTop: 4 }}>
          {plan.key === "starter" ? `14 dias sem taxa Zyon. Depois, ${plan.fee} por transação.` : `${plan.fee} por transação`}
        </div>
      </div>

      {plan.key !== "starter" && billingCycle === "annual" && <p style={{ fontSize: 13, margin: 0 }}>{offer ? <>Pagamento anual de <strong>{billingMoney(offer.amountCents)}</strong>. Economia de {billingMoney(offer.savingsCents)} ({offer.discountPercent}%).</> : "O plano anual ainda não está disponível para contratação."}</p>}

      {/* Limits */}
      <div
        style={{
          padding: "16px 0",
          borderTop: "1px solid var(--color-border)",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <p style={{ margin: 0, fontSize: 13 }}>O limite considera compras com pagamento confirmado.</p>
        <LimitRow label="Compras por mês" value={formatLimit(plan.limits.orders)} />
        <LimitRow label="Conexões" value={formatLimit(plan.limits.connections)} />
      </div>

      {/* Features */}
      {plan.features.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
          {plan.features.map((feature) => (
            <div
              key={feature}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  background: "var(--color-success-bg)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "none",
                }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="var(--color-success)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="2 8 6 12 14 4" />
                </svg>
              </div>
              <span style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>
                {feature}
              </span>
            </div>
          ))}
        </div>
      )}
      {plan.features.length === 0 && <div style={{ flex: 1 }} />}

      {/* CTA */}
      <Button
        variant={isCurrent ? "outline" : isDowngrade ? "outline" : "primary"}
        arrow={!isCurrent && !upgrading}
        fullWidth
        onClick={onUpgrade}
        disabled={isCurrent || upgrading || insufficientCapacity || !offer}
      >
        {insufficientCapacity ? "Capacidade insuficiente neste mês" : actionLabel ?? (isCurrent
          ? "Seu plano"
          : isDowngrade
            ? "Downgrade"
            : "Fazer upgrade")}
      </Button>
    </div>
  );
}

function LimitRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)" }}>{label}</span>
      <span style={{ font: "12px var(--font-mono)", color: "var(--color-text)" }}>{value}</span>
    </div>
  );
}
