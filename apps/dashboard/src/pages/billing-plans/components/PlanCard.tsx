import React from "react";

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
}: PlanCardProps) {
  const borderColor = isCurrent
    ? "var(--accent)"
    : plan.recommended
      ? "var(--accent-line)"
      : "var(--border)";

  const cardBg = plan.recommended
    ? "color-mix(in oklab, var(--accent-soft) 50%, var(--card))"
    : "var(--card)";

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
            background: "var(--accent)",
            borderRadius: "0 0 2px 2px",
          }}
        />
      )}

      {/* Plan name */}
      <div>
        <div
          style={{
            font: "600 10.5px var(--mono)",
            letterSpacing: "0.06em",
            color: "var(--faint)",
            marginBottom: 6,
          }}
        >
          {plan.recommended ? "RECOMENDADO" : plan.name.toUpperCase()}
        </div>
        <h4
          style={{
            font: "700 20px var(--serif)",
            color: "var(--ink)",
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
              <span style={{ font: "800 28px var(--mono)", color: "var(--ink)" }}>
                R${plan.price}
              </span>
              <span style={{ font: "13px var(--sans)", color: "var(--muted)" }}>
                /mês
              </span>
            </>
          ) : (
            <span style={{ font: "800 28px var(--mono)", color: "var(--ink)" }}>
              Grátis
            </span>
          )}
        </div>
        <div style={{ font: "12px var(--mono)", color: "var(--muted)", marginTop: 4 }}>
          {plan.fee} por transação
        </div>
      </div>

      {/* Limits */}
      <div
        style={{
          padding: "16px 0",
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
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
                  background: "var(--good-soft)",
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
                  stroke="var(--good)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="2 8 6 12 14 4" />
                </svg>
              </div>
              <span style={{ font: "13px var(--sans)", color: "var(--ink)" }}>
                {feature}
              </span>
            </div>
          ))}
        </div>
      )}
      {plan.features.length === 0 && <div style={{ flex: 1 }} />}

      {/* CTA */}
      <button
        type="button"
        onClick={onUpgrade}
        disabled={isCurrent || upgrading}
        style={{
          width: "100%",
          padding: "12px 16px",
          borderRadius: 8,
          border: isCurrent
            ? "1px solid var(--accent)"
            : isDowngrade
              ? "1px solid var(--border)"
              : "none",
          background: isCurrent
            ? "transparent"
            : isDowngrade
              ? "var(--card)"
              : "var(--accent)",
          color: isCurrent
            ? "var(--accent)"
            : isDowngrade
              ? "var(--muted)"
              : "oklch(16% 0.01 145)",
          font: "600 13px var(--sans)",
          cursor: isCurrent || upgrading ? "default" : "pointer",
          opacity: upgrading ? 0.6 : 1,
          transition: "all 200ms",
        }}
      >
        {isCurrent
          ? "Seu plano"
          : isDowngrade
            ? "Downgrade"
            : "Fazer upgrade"}
      </button>
    </div>
  );
}

function LimitRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ font: "13px var(--sans)", color: "var(--muted)" }}>{label}</span>
      <span style={{ font: "12px var(--mono)", color: "var(--ink)" }}>{value}</span>
    </div>
  );
}
