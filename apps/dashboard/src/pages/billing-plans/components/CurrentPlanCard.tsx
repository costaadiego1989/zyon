import React from "react";
import { Button } from "../../../components/Button.js";

interface CurrentPlanCardProps {
  planName: string;
  monthlyPrice: number;
  /** Fee do merchant por transação, fixo em centavos. */
  transactionFeeCents: number;
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
  transactionFeeCents,
  nextBillingDate,
  daysRemaining,
  status,
  cancelAtPeriodEnd,
  onManage,
  isLoading = false,
}: CurrentPlanCardProps) {
  const statusColor =
    status === "active"
      ? "var(--color-success)"
      : status === "trialing"
        ? "var(--color-brand)"
        : "var(--color-text-muted)";

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
        border: "1px solid var(--color-border)",
        background: "var(--surface-2)",
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
              font: "600 10.5px var(--font-mono)",
              letterSpacing: "0.06em",
              color: "var(--color-text-faint)",
              marginBottom: 4,
            }}
          >
            SEU PLANO
          </div>
          <h3 style={{ font: "700 24px var(--font-serif)", color: "var(--color-brand)", margin: 0 }}>
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
          <span style={{ font: "11px var(--font-mono)", color: statusColor }}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Pricing */}
      <div style={{ display: "flex", gap: 32, alignItems: "baseline" }}>
        <div>
          <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-muted)", marginBottom: 2 }}>
            VALOR MENSAL
          </div>
          <div style={{ font: "700 20px var(--font-mono)", color: "var(--color-text)" }}>
            R${monthlyPrice.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
          </div>
        </div>
        <div>
          <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-muted)", marginBottom: 2 }}>
            TAXA POR TRANSAÇÃO
          </div>
          <div style={{ font: "700 20px var(--font-mono)", color: "var(--color-text)" }}>
            R$ {(transactionFeeCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}/venda
          </div>
        </div>
      </div>

      {/* Billing info */}
      {nextBillingDate && daysRemaining !== null && (
        <div style={{ padding: "12px", borderRadius: 8, background: "var(--surface-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-muted)" }}>
              PRÓXIMA COBRANÇA
            </div>
            <div style={{ font: "13px var(--font-sans)", color: "var(--color-text)", fontWeight: 500, marginTop: 2 }}>
              {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(nextBillingDate))}
              <span style={{ color: "var(--color-text-muted)", marginLeft: 8 }}>
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
            background: "var(--color-warning-bg)",
            border: "1px solid var(--color-warning)",
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          <div style={{ width: 16, height: 16, color: "var(--color-warning)", flex: "none", marginTop: 1 }}>
            ⚠
          </div>
          <div style={{ fontSize: 13, color: "var(--color-warning)", lineHeight: 1.4 }}>
            Seu plano será cancelado ao final do período atual
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 12 }}>
        <Button
          variant="outline"
          arrow
          onClick={onManage}
          disabled={isLoading}
          fullWidth
        >
          Gerenciar assinatura
        </Button>
      </div>
    </div>
  );
}
