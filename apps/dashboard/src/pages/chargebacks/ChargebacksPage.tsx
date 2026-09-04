import React, { useMemo, useState, useEffect } from "react";
import { AlertCircle, MessageCircle, Clock } from "lucide-react";
import { Button } from "../../components/Button.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { showToast } from "../../components/Toast.js";
import type { MerchantProfile as MerchantMeProfile } from "../../api-client.js";
import { createDashboardApi } from "../../api-client.js";
import { ChargebackDisputeChat } from "./ChargebackDisputeChat.js";
import { useChargebacksPage } from "./useChargebacksPage.js";

interface Chargeback {
  id: string;
  orderId: string;
  amount: number;
  reason: string;
  status: "opened" | "disputed" | "resolved" | "lost";
  createdAt: string;
  updatedAt: string;
}

export function ChargebacksPage(props: { apiBaseUrl: string; me: MerchantMeProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [selectedChargebackId, setSelectedChargebackId] = useState<string | null>(null);
  const { chargebacks, loading, error, refetch } = useChargebacksPage(props.apiBaseUrl, props.me?.id);

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <header className="page-head">
          <div>
            <h1>Disputed Chargebacks</h1>
            <p className="page-lead">Login required to view chargebacks</p>
          </div>
        </header>
      </div>
    );
  }

  const statusColor = (status: Chargeback["status"]) => {
    switch (status) {
      case "opened":
        return "var(--color-warning)";
      case "disputed":
        return "var(--color-info)";
      case "resolved":
        return "var(--color-success)";
      case "lost":
        return "var(--color-error)";
      default:
        return "var(--color-text-muted)";
    }
  };

  const statusLabel = (status: Chargeback["status"]) => {
    switch (status) {
      case "opened":
        return "Aberto";
      case "disputed":
        return "Contestado";
      case "resolved":
        return "Resolvido";
      case "lost":
        return "Perdido";
      default:
        return status;
    }
  };

  return (
    <div className="dashboard-content">
      {/* ── Page Head ── */}
      <header className="page-head">
        <div>
          <span className="eyebrow">Conta</span>
          <h1>Chargebacks</h1>
          <p className="page-lead">Disputas de cartão abertas pelo comprador no banco. Você é notificado via WhatsApp quando uma nova disputa é aberta.</p>
        </div>
      </header>

      {error && (
        <div
          style={{
            padding: "var(--space-4)",
            marginBottom: "var(--space-5)",
            backgroundColor: "rgba(220, 38, 38, 0.1)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-error)",
          }}
        >
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-start" }}>
            <AlertCircle size={20} style={{ color: "var(--color-error)", marginTop: 2 }} />
            <div>
              <p style={{ color: "var(--color-error)", fontWeight: 500 }}>Error loading chargebacks</p>
              <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: 4 }}>{error}</p>
            </div>
          </div>
        </div>
      )}

      {selectedChargebackId ? (
        <ChargebackDisputeChat
          apiBaseUrl={props.apiBaseUrl}
          chargebackId={selectedChargebackId}
          onBack={() => setSelectedChargebackId(null)}
          onRefresh={refetch}
        />
      ) : (
        <>
          {loading ? (
            <div style={{ textAlign: "center", padding: "var(--space-6)" }}>
              <p style={{ color: "var(--color-text-muted)" }}>Loading chargebacks...</p>
            </div>
          ) : chargebacks.length === 0 ? (
            <div style={{ textAlign: "center", padding: "var(--space-8)" }}>
              <AlertCircle size={32} style={{ color: "var(--color-success)", margin: "0 auto", marginBottom: "var(--space-3)" }} />
              <h3>No chargebacks</h3>
              <p style={{ color: "var(--color-text-muted)", marginTop: "var(--space-2)" }}>All your chargebacks are resolved.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "var(--space-3)" }}>
              {chargebacks.map((chargeback) => (
                <div
                  key={chargeback.id}
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    padding: "var(--space-4)",
                    backgroundColor: "var(--color-bg-secondary)",
                    cursor: "pointer",
                    transition: "all 200ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-brand)";
                    e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-border)";
                    e.currentTarget.style.backgroundColor = "var(--color-bg-secondary)";
                  }}
                  onClick={() => setSelectedChargebackId(chargeback.id)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-3)" }}>
                    <div>
                      <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 4 }}>Order {chargeback.orderId}</p>
                      <p style={{ fontWeight: 600, fontSize: 16 }}>R$ {(chargeback.amount / 100).toFixed(2)}</p>
                    </div>
                    <span
                      style={{
                        padding: "4px 10px",
                        backgroundColor: statusColor(chargeback.status),
                        color: "white",
                        borderRadius: "var(--radius-sm)",
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      {statusLabel(chargeback.status)}
                    </span>
                  </div>

                  <div style={{ marginBottom: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                    <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 4 }}>Reason</p>
                    <p style={{ fontSize: 14, color: "var(--color-text)" }}>{chargeback.reason}</p>
                  </div>

                  <div style={{ display: "flex", gap: "var(--space-4)", fontSize: 12, color: "var(--color-text-muted)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <Clock size={14} />
                      <span>Opened {new Date(chargeback.createdAt).toLocaleDateString()}</span>
                    </div>
                    {chargeback.status === "disputed" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--color-info)" }}>
                        <MessageCircle size={14} />
                        <span>Dispute in progress</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
