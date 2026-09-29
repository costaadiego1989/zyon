import React, { useCallback, useEffect, useState, useRef } from "react";
import { useApi } from "../../../hooks/useApi.js";
import { Modal } from "../../../components/Modal.js";
import { Button } from "../../../components/Button.js";
import { PageLoader } from "../../../components/PageLoader.js";
import { reportError } from "../../../hooks/useErrorReporter.js";
import type { SettlementDetail } from "../../../api/endpoints/marketplace-v2.js";
import { SettlementTimeline } from "./SettlementTimeline.js";
import "./settlement-detail-panel.css";

const formatCurrency = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

interface SettlementDetailPanelProps {
  settlementId: string;
  apiBaseUrl?: string;
  onClose: () => void;
}

export function SettlementDetailPanel({ settlementId, onClose }: SettlementDetailPanelProps) {
  const api = useApi();
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const readVersion = useRef(0);
  const fetchDetail = useCallback(async () => {
    const version = ++readVersion.current;
    setDetail(null);
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMarketplaceSettlementDetail(settlementId);
      if (version === readVersion.current) setDetail(data);
    } catch (err: any) {
      reportError({
        source: "marketplace.SettlementDetailPanel.fetchDetail",
        error: err,
        context: { settlementId },
      });
      if (version === readVersion.current)
        setError("Não foi possível consultar este repasse. Tente novamente.");
    } finally {
      if (version === readVersion.current) setLoading(false);
    }
  }, [api, settlementId]);

  useEffect(() => {
    void fetchDetail();
    return () => {
      readVersion.current++;
    };
  }, [fetchDetail]);

  return (
    <Modal
      isOpen
      title="Detalhes do repasse"
      subtitle={`Repasse ${settlementId}`}
      presentation="center"
      size="lg"
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      {/* Content */}
      <div className="settlement-panel__body">
        {loading && <PageLoader variant="section" />}
        {error && (
          <div className="marketplace-error" role="alert">
            <p>{error}</p>
            <Button variant="outline" onClick={() => void fetchDetail()}>
              Tentar novamente
            </Button>
          </div>
        )}
        {detail && !loading && !error && (
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
                  {formatCurrency(detail.settlement.totalAmountCents)}
                </span>
              </div>
              <div className="settlement-panel__info-row">
                <span style={{ color: "var(--color-text-muted)" }}>Comissão</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {formatCurrency(detail.settlement.commissionCents)}
                </span>
              </div>
              <div className="settlement-panel__info-row">
                <span style={{ color: "var(--color-text-muted)" }}>Líquido</span>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--success)" }}>
                  {formatCurrency(detail.settlement.sellerNetCents)}
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
                    Débito associado
                  </span>
                </div>
                <div className="settlement-panel__info-row">
                  <span style={{ color: "var(--color-text-muted)" }}>Valor</span>
                  <span
                    style={{ fontFamily: "var(--font-mono)", color: "var(--color-error)", fontWeight: 600 }}
                  >
                    {formatCurrency(detail.debt.amountCents)}
                  </span>
                </div>
                <div className="settlement-panel__info-row">
                  <span style={{ color: "var(--color-text-muted)" }}>Status</span>
                  <span
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background:
                        detail.debt.status === "outstanding"
                          ? "var(--color-error-bg)"
                          : "var(--success-soft)",
                      color: detail.debt.status === "outstanding" ? "var(--color-error)" : "var(--success)",
                      fontWeight: 600,
                    }}
                  >
                    {detail.debt.status === "outstanding"
                      ? "Pendente"
                      : detail.debt.status === "deducted"
                      ? "Deduzido"
                      : "Resolvido"}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
