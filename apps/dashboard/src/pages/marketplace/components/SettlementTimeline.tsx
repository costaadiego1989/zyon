import React, { useMemo } from "react";
import { Calendar, CheckCircle2, Clock, AlertCircle, DollarSign } from "lucide-react";
import type { SettlementDetail, SettlementStatus, SettlementTimelineEntry } from "../../../api/endpoints/marketplace-v2.js";
import "./settlement-timeline.css";

interface SettlementTimelineProps {
  detail: SettlementDetail;
  isLoading?: boolean;
}

const STATUS_CONFIG: Record<SettlementStatus, { color: string; label: string; icon: React.ReactNode }> = {
  awaiting_return_window: {
    color: "var(--info)",
    label: "Aguardando Devolução",
    icon: <Clock size={16} />,
  },
  transfer_scheduled: {
    color: "var(--warning)",
    label: "Repasse Agendado",
    icon: <Calendar size={16} />,
  },
  transferred: {
    color: "var(--success)",
    label: "Repasse Executado",
    icon: <CheckCircle2 size={16} />,
  },
  finalized: {
    color: "var(--success)",
    label: "Finalizado",
    icon: <CheckCircle2 size={16} />,
  },
  return_cancelled: {
    color: "var(--color-text-muted)",
    label: "Devolvido",
    icon: <AlertCircle size={16} />,
  },
  chargeback_cancelled: {
    color: "var(--color-error)",
    label: "Chargeback Cancelado",
    icon: <AlertCircle size={16} />,
  },
  chargeback_debt: {
    color: "var(--color-error)",
    label: "Débito por Chargeback",
    icon: <AlertCircle size={16} />,
  },
};

export function SettlementTimeline({ detail, isLoading }: SettlementTimelineProps) {
  const { settlement, timeline, debt } = detail;
  const currentStatus = STATUS_CONFIG[settlement.status];

  const windowDates = useMemo(() => {
    return {
      returnWindowUntil: new Date(settlement.returnWindowUntil),
      chargebackWindowUntil: new Date(settlement.chargebackWindowUntil),
      transferScheduledAt: settlement.transferScheduledAt ? new Date(settlement.transferScheduledAt) : null,
    };
  }, [settlement]);

  const formatDate = (date: Date | string | null) => {
    if (!date) return "—";
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (isLoading) {
    return (
      <div className="settlement-timeline settlement-timeline--loading">
        <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-muted)" }}>
          Carregando timeline...
        </div>
      </div>
    );
  }

  return (
    <div className="settlement-timeline">
      {/* Current Status Badge */}
      <div className="settlement-timeline__header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: `${currentStatus.color}20`,
              color: currentStatus.color,
            }}
          >
            {currentStatus.icon}
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", textTransform: "uppercase" }}>
              Status Atual
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text)" }}>
              {currentStatus.label}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 12 }}>
          <div style={{ color: "var(--color-text-muted)" }}>Criado em</div>
          <div style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>
            {formatDate(settlement.createdAt)}
          </div>
        </div>
      </div>

      {/* Timeline Line */}
      <div className="settlement-timeline__line-container">
        <div className="settlement-timeline__line" />
        {timeline.map((entry: SettlementTimelineEntry, idx: number) => {
          const config = STATUS_CONFIG[entry.status];
          const isCurrent = entry.status === settlement.status;

          return (
            <div
              key={`${entry.status}-${idx}`}
              className={`settlement-timeline__entry ${isCurrent ? "settlement-timeline__entry--current" : ""}`}
            >
              {/* Circle */}
              <div
                className="settlement-timeline__dot"
                style={{
                  background: isCurrent ? config.color : "var(--color-border)",
                  borderColor: isCurrent ? config.color : "var(--color-border)",
                  boxShadow: isCurrent ? `0 0 0 4px ${config.color}20` : "none",
                }}
              />

              {/* Content */}
              <div className="settlement-timeline__content">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text)" }}>
                    {config.label}
                  </span>
                  {isCurrent && (
                    <span
                      style={{
                        fontSize: 11,
                        background: `${config.color}20`,
                        color: config.color,
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontWeight: 600,
                      }}
                    >
                      AGORA
                    </span>
                  )}
                </div>
                {entry.timestamp && (
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                    {formatDate(entry.timestamp)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Windows Info */}
      <div className="settlement-timeline__windows">
        <div className="settlement-timeline__window">
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase" }}>
            Janela de Devolução
          </div>
          <div style={{ fontSize: 14, fontFamily: "var(--font-mono)", fontWeight: 600 }}>
            Até {formatDate(windowDates.returnWindowUntil)}
          </div>
        </div>

        <div className="settlement-timeline__window">
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase" }}>
            Janela de Chargeback
          </div>
          <div style={{ fontSize: 14, fontFamily: "var(--font-mono)", fontWeight: 600 }}>
            Até {formatDate(windowDates.chargebackWindowUntil)}
          </div>
        </div>

        {settlement.status === "chargeback_debt" && debt && (
          <div className="settlement-timeline__window settlement-timeline__window--debt">
            <div style={{ fontSize: 11, color: "var(--color-error)", textTransform: "uppercase" }}>
              Débito Criado
            </div>
            <div style={{ fontSize: 14, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--color-error)" }}>
              R$ {(debt.amountCents / 100).toFixed(2)}
            </div>
          </div>
        )}
      </div>

      {/* Amounts */}
      <div className="settlement-timeline__amounts">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <DollarSign size={16} style={{ color: "var(--success)" }} />
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Valor Líquido do Vendedor</span>
        </div>
        <div style={{ fontSize: 20, fontFamily: "var(--font-mono)", fontWeight: 700 }}>
          R$ {(settlement.sellerNetCents / 100).toFixed(2)}
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 8 }}>
          Comissão: R$ {(settlement.commissionCents / 100).toFixed(2)}
        </div>
      </div>
    </div>
  );
}
