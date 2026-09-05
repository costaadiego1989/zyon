import React from "react";
import { Button } from "../../../components/Button.js";

export interface PlanDef {
  key: "starter" | "growth" | "scale";
  name: string;
  price: number;
  fee: string;
  limits: { orders: number; sessions: number; ai: number; connections: number };
  features: string[];
  recommended?: boolean;
}

interface PlanCardProps {
  plan: PlanDef;
  isCurrent: boolean;
  isDowngrade: boolean;
  onUpgrade: () => void;
  upgrading: boolean;
  actionLabel?: string;
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
}: PlanCardProps) {
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
                R${plan.price}
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
        <LimitRow label="Pedidos" value={formatLimit(plan.limits.orders)} />
        <LimitRow label="Sessões" value={formatLimit(plan.limits.sessions)} />
        <LimitRow label="Conversas IA" value={formatLimit(plan.limits.ai)} />
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
        disabled={isCurrent || upgrading}
      >
        {actionLabel ?? (isCurrent
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
