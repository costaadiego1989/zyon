import React, { useCallback, useEffect, useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import { SidePanel } from "../../../components/SidePanel.js";
import { reportError } from "../../../hooks/useErrorReporter.js";
import type { SettlementDetail } from "../../../api/endpoints/marketplace-v2.js";
import { SettlementTimeline } from "./SettlementTimeline.js";
import "./settlement-detail-panel.css";

interface SettlementDetailPanelProps {
  settlementId: string;
  apiBaseUrl?: string;
  onClose: () => void;
}

export function SettlementDetailPanel({
  settlementId,
  onClose,
}: SettlementDetailPanelProps) {
  const api = useApi();
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMarketplaceSettlementDetail(settlementId);
      setDetail(data);
    } catch (err: any) {
      reportError({ source: "marketplace.SettlementDetailPanel.fetchDetail", error: err, context: { settlementId } });
      setError(err.message ?? "Falha ao carregar detalhes");
    } finally {
      setLoading(false);
    }
  }, [api, settlementId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  return (
    <SidePanel isOpen title={`Repasse ${settlementId.slice(0, 12)}…`} onClose={onClose}>
        {/* Content */}
        <div className="settlement-panel__body">
          {loading && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-muted)" }}>
              Carregando...
            </div>
          )}

          {error && (
            <div style={{ padding: 24, textAlign: "center" }}>
              <div style={{ color: "var(--color-error)", marginBottom: 12 }}>{error}</div>
              <button
                onClick={fetchDetail}
                style={{
                  padding: "8px 16px",
                  background: "var(--color-brand)",
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
                  <span style={{ color: "var(--color-text-muted)" }}>Pedido</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{detail.settlement.orderId}</span>
                </div>
                <div className="settlement-panel__info-row">
                  <span style={{ color: "var(--color-text-muted)" }}>Item</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{detail.settlement.lineItemId}</span>
                </div>
                <div className="settlement-panel__info-row">
                  <span style={{ color: "var(--color-text-muted)" }}>Total</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                    R$ {(detail.settlement.totalAmountCents / 100).toFixed(2)}
                  </span>
                </div>
                <div className="settlement-panel__info-row">
                  <span style={{ color: "var(--color-text-muted)" }}>Comissão</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    R$ {(detail.settlement.commissionCents / 100).toFixed(2)}
                  </span>
                </div>
                <div className="settlement-panel__info-row">
                  <span style={{ color: "var(--color-text-muted)" }}>Líquido</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--success)" }}>
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
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-error)" }}>
                      Débito Associado
                    </span>
                  </div>
                  <div className="settlement-panel__info-row">
                    <span style={{ color: "var(--color-text-muted)" }}>Valor</span>
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-error)", fontWeight: 600 }}>
                      R$ {(detail.debt.amountCents / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="settlement-panel__info-row">
                    <span style={{ color: "var(--color-text-muted)" }}>Status</span>
                    <span style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: detail.debt.status === "outstanding" ? "var(--color-error-bg)" : "var(--success-soft)",
                      color: detail.debt.status === "outstanding" ? "var(--color-error)" : "var(--success)",
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
    </SidePanel>
  );
}
