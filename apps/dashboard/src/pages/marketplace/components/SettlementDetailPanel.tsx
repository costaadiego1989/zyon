import React, { useCallback, useEffect, useState } from "react";
import { X, ExternalLink } from "lucide-react";
import type { SettlementDetail } from "../../api/endpoints/marketplace-v2.js";
import { SettlementTimeline } from "./SettlementTimeline.js";
import "./settlement-detail-panel.css";

interface SettlementDetailPanelProps {
  settlementId: string;
  apiBaseUrl: string;
  onClose: () => void;
}

export function SettlementDetailPanel({
  settlementId,
  apiBaseUrl,
  onClose,
}: SettlementDetailPanelProps) {
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBaseUrl}/marketplace/dashboard/settlements/${encodeURIComponent(settlementId)}`,
        { method: "GET", credentials: "include" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDetail(data);
    } catch (err: any) {
      setError(err.message ?? "Falha ao carregar detalhes");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, settlementId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  return (
    <div className="settlement-panel-backdrop" onClick={onClose}>
      <div
        className="settlement-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Detalhe do Settlement"
      >
        {/* Header */}
        <div className="settlement-panel__header">
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase" }}>
              Settlement
            </div>
            <div style={{ fontSize: 16, fontFamily: "var(--mono)", fontWeight: 600 }}>
              {settlementId.slice(0, 12)}...
            </div>
          </div>
          <button
            className="settlement-panel__close"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="settlement-panel__body">
          {loading && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
              Carregando...
            </div>
          )}

          {error && (
            <div style={{ padding: 24, textAlign: "center" }}>
              <div style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</div>
              <button
                onClick={fetchDetail}
                style={{
                  padding: "8px 16px",
                  background: "var(--accent)",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Tentar novamente
              </button>
            </div>
          )}

          {detail && !loading && (
            <>
              {/* Settlement Info */}
              <div className="settlement-panel__info">
                <div className="settlement-panel__info-row">
                  <span style={{ color: "var(--muted)" }}>Pedido</span>
                  <span style={{ fontFamily: "var(--mono)" }}>{detail.settlement.orderId}</span>
                </div>
                <div className="settlement-panel__info-row">
                  <span style={{ color: "var(--muted)" }}>Item</span>
                  <span style={{ fontFamily: "var(--mono)" }}>{detail.settlement.lineItemId}</span>
                </div>
                <div className="settlement-panel__info-row">
                  <span style={{ color: "var(--muted)" }}>Total</span>
                  <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>
                    R$ {(detail.settlement.totalAmountCents / 100).toFixed(2)}
                  </span>
                </div>
                <div className="settlement-panel__info-row">
                  <span style={{ color: "var(--muted)" }}>Comissão</span>
                  <span style={{ fontFamily: "var(--mono)" }}>
                    R$ {(detail.settlement.commissionCents / 100).toFixed(2)}
                  </span>
                </div>
                <div className="settlement-panel__info-row">
                  <span style={{ color: "var(--muted)" }}>Líquido</span>
                  <span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--success)" }}>
                    R$ {(detail.settlement.sellerNetCents / 100).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Timeline */}
              <SettlementTimeline detail={detail} />

              {/* Debt Section */}
              {detail.debt && (
                <div className="settlement-panel__debt">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--danger)" }}>
                      Débito Associado
                    </span>
                  </div>
                  <div className="settlement-panel__info-row">
                    <span style={{ color: "var(--muted)" }}>Valor</span>
                    <span style={{ fontFamily: "var(--mono)", color: "var(--danger)", fontWeight: 600 }}>
                      R$ {(detail.debt.amountCents / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="settlement-panel__info-row">
                    <span style={{ color: "var(--muted)" }}>Status</span>
                    <span style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: detail.debt.status === "outstanding" ? "var(--danger-soft)" : "var(--success-soft)",
                      color: detail.debt.status === "outstanding" ? "var(--danger)" : "var(--success)",
                      fontWeight: 600,
                    }}>
                      {detail.debt.status === "outstanding" ? "Pendente" :
                       detail.debt.status === "deducted" ? "Deduzido" : "Resolvido"}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
