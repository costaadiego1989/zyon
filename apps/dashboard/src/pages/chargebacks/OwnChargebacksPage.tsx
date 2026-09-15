import React from "react";
import { AlertCircle, Clock3, RefreshCw, ShieldAlert } from "lucide-react";
import type { MerchantProfile as MerchantMeProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { useChargebacksPage, type OwnChargeback } from "./useChargebacksPage.js";

const STATUS_META: Record<OwnChargeback["disputeStatus"], { label: string; background: string; color: string }> = {
  pending: { label: "Em análise", background: "var(--color-warning-bg)", color: "var(--color-warning)" },
  disputed: { label: "Em contestação", background: "var(--color-info-bg)", color: "var(--color-info)" },
  won: { label: "Resolvido a favor", background: "var(--color-success-bg)", color: "var(--color-success)" },
  lost: { label: "Resolvido contra", background: "var(--color-error-bg)", color: "var(--color-error)" },
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function providerLabel(provider: OwnChargeback["provider"]): string {
  return provider === "mercadopago" ? "Mercado Pago" : provider === "asaas" ? "Asaas" : provider === "stripe" ? "Stripe" : provider;
}

export function OwnChargebacksPage(props: { apiBaseUrl: string; me: MerchantMeProfile | null }) {
  const { chargebacks, loading, error, refetch } = useChargebacksPage(props.apiBaseUrl);

  if (!props.me) {
    return (
      <div className="page-container">
        <header className="page-head">
          <div>
            <span className="eyebrow">Vendas</span>
            <h1>Chargebacks</h1>
          </div>
        </header>
        <EmptyState icon={ShieldAlert} title="Login necessário" description="Faça login para acompanhar as contestações dos pagamentos da sua loja." />
      </div>
    );
  }

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Vendas</span>
          <h1>Chargebacks</h1>
          <p className="page-lead">Acompanhe as contestações dos pagamentos recebidos pela sua loja.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={loading}>
          <RefreshCw size={15} aria-hidden="true" /> Atualizar
        </Button>
      </header>

      {error ? (
        <div className="panel" role="alert" style={{ padding: "16px 18px", borderColor: "var(--color-error)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <AlertCircle size={18} color="var(--color-error)" aria-hidden="true" />
            <div>
              <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>Não foi possível carregar os chargebacks</div>
              <p style={{ margin: "4px 0 0", font: "13px var(--font-sans)", color: "var(--color-text-muted)" }}>{error}</p>
            </div>
          </div>
        </div>
      ) : loading ? (
        <div className="panel" style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-muted)", font: "13px var(--font-sans)" }}>
          Carregando chargebacks...
        </div>
      ) : chargebacks.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="Nenhum chargeback registrado" description="As novas contestações enviadas pelos provedores de pagamento aparecerão aqui." />
      ) : (
        <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Provedor</th>
                  <th>Motivo</th>
                  <th>Aberto em</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {chargebacks.map((chargeback) => {
                  const status = STATUS_META[chargeback.disputeStatus];
                  return (
                    <tr key={chargeback.paymentIntentId}>
                      <td><code style={{ font: "12px var(--font-mono)" }}>{chargeback.orderId || chargeback.paymentIntentId}</code></td>
                      <td>{providerLabel(chargeback.provider)}</td>
                      <td>{chargeback.disputeReason || "Não informado pelo provedor"}</td>
                      <td><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Clock3 size={14} aria-hidden="true" /> {formatDate(chargeback.disputeOpenedAt)}</span></td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(chargeback.amountCents / 100)}</td>
                      <td><span style={{ display: "inline-flex", padding: "3px 8px", borderRadius: 999, background: status.background, color: status.color, font: "600 11px var(--font-sans)", whiteSpace: "nowrap" }}>{status.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
