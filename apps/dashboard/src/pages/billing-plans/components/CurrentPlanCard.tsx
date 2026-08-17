import React from "react";

interface CurrentPlanCardProps {
  planName: string;
  monthlyPrice: number;
  transactionFee: number;
  nextBillingDate: string | null;
  daysRemaining: number | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  onManage: () => void;
  isLoading?: boolean;
}

export function CurrentPlanCard({
  planName,
  monthlyPrice,
  transactionFee,
  nextBillingDate,
  daysRemaining,
  status,
  cancelAtPeriodEnd,
  onManage,
  isLoading = false,
}: CurrentPlanCardProps) {
  const statusColor =
    status === "active"
      ? "var(--good)"
      : status === "trialing"
        ? "var(--accent)"
        : "var(--muted)";

  const statusLabel =
    status === "active"
      ? "Ativo"
      : status === "trialing"
        ? "Em teste"
        : "Inativo";

  return (
    <div
      style={{
        padding: "24px",
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--card)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div
            style={{
              font: "600 10.5px var(--mono)",
              letterSpacing: "0.06em",
              color: "var(--faint)",
              marginBottom: 4,
            }}
          >
            SEU PLANO
          </div>
          <h3 style={{ font: "700 24px var(--serif)", color: "var(--ink)", margin: 0 }}>
            {planName}
          </h3>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 20,
            background: `color-mix(in oklab, ${statusColor} 10%, transparent)`,
            border: `1px solid ${statusColor}40`,
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: statusColor,
            }}
          />
          <span style={{ font: "11px var(--mono)", color: statusColor }}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Pricing */}
      <div style={{ display: "flex", gap: 32, alignItems: "baseline" }}>
        <div>
          <div style={{ font: "11px var(--mono)", color: "var(--muted)", marginBottom: 2 }}>
            VALOR MENSAL
          </div>
          <div style={{ font: "700 20px var(--mono)", color: "var(--ink)" }}>
            R${monthlyPrice.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
          </div>
        </div>
        <div>
          <div style={{ font: "11px var(--mono)", color: "var(--muted)", marginBottom: 2 }}>
            TAXA POR TRANSAÇÃO
          </div>
          <div style={{ font: "700 20px var(--mono)", color: "var(--ink)" }}>
            {transactionFee.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%
          </div>
        </div>
      </div>

      {/* Billing info */}
      {nextBillingDate && daysRemaining !== null && (
        <div style={{ padding: "12px", borderRadius: 8, background: "var(--bg)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ font: "11px var(--mono)", color: "var(--muted)" }}>
              PRÓXIMA COBRANÇA
            </div>
            <div style={{ font: "13px var(--sans)", color: "var(--ink)", fontWeight: 500, marginTop: 2 }}>
              {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(nextBillingDate))}
              <span style={{ color: "var(--muted)", marginLeft: 8 }}>
                (em {daysRemaining} dia{daysRemaining !== 1 ? "s" : ""})
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Cancel warning */}
      {cancelAtPeriodEnd && (
        <div
          style={{
            padding: "12px",
            borderRadius: 8,
            background: "var(--warn-soft)",
            border: "1px solid var(--warn)",
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          <div style={{ width: 16, height: 16, color: "var(--warn)", flex: "none", marginTop: 1 }}>
            ⚠
          </div>
          <div style={{ fontSize: 13, color: "var(--warn)", lineHeight: 1.4 }}>
            Seu plano será cancelado ao final do período atual
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 12 }}>
        <button
          type="button"
          onClick={onManage}
          disabled={isLoading}
          style={{
            flex: 1,
            padding: "10px 16px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--card)",
            color: "var(--ink)",
            font: "500 13px var(--sans)",
            cursor: isLoading ? "default" : "pointer",
            transition: "all 200ms",
            opacity: isLoading ? 0.6 : 1,
          }}
        >
          Gerenciar assinatura
        </button>
      </div>
    </div>
  );
}
