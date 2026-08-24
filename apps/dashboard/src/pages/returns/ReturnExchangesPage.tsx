import React, { useState } from "react";
import { RefreshCw, Package, Truck, CheckCircle, DollarSign } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { StatCard } from "../overview/components/StatCard.js";
import { DataPanel } from "../../components/DataPanel.js";
import { PageLoader } from "../../components/PageLoader.js";
import { useReturnExchangesPage } from "./useReturnExchangesPage.js";
import type { ReturnStatus } from "../../api/endpoints/returns.js";

export interface ReturnExchangesPageProps {
  apiBaseUrl: string;
  me: MerchantProfile;
}

const PAGE_SIZE = 10;

const STATUS_MAP: Record<string, { label: string; bg: string; color: string }> = {
  REQUESTED: { label: "Solicitado", bg: "var(--color-warning-bg)", color: "var(--color-warning)" },
  LABEL_GENERATED: { label: "Etiqueta gerada", bg: "var(--color-brand-subtle)", color: "var(--color-brand)" },
  SHIPPED: { label: "Em trânsito", bg: "var(--color-brand-subtle)", color: "var(--color-brand)" },
  RECEIVED: { label: "Recebido", bg: "var(--color-success-bg)", color: "var(--color-success)" },
  INSPECTED_PASS: { label: "Aprovado", bg: "var(--color-success-bg)", color: "var(--color-success)" },
  INSPECTED_FAIL: { label: "Reprovado", bg: "var(--color-error-bg)", color: "var(--color-error)" },
  REFUND_PROCESSING: { label: "Reembolsando", bg: "var(--color-warning-bg)", color: "var(--color-warning)" },
  REFUND_COMPLETED: { label: "Reembolsado", bg: "var(--color-success-bg)", color: "var(--color-success)" },
  REJECTED: { label: "Rejeitado", bg: "var(--color-error-bg)", color: "var(--color-error)" },
  CANCELLED: { label: "Cancelado", bg: "var(--surface-2)", color: "var(--color-text-faint)" },
};

const REASON_MAP: Record<string, string> = {
  DEFECTIVE: "Defeito",
  WRONG_ITEM: "Item errado",
  NOT_AS_DESCRIBED: "Diferente do anúncio",
  CHANGED_MIND: "Arrependimento",
  DAMAGED_IN_TRANSIT: "Danificado no transporte",
  OTHER: "Outro",
};

export function ReturnExchangesPage({ me }: ReturnExchangesPageProps) {
  const vm = useReturnExchangesPage(me.id);
  const [page, setPage] = useState(1);
  const slice = vm.returns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (vm.loading) {
    return (
      <div className="page-container">
        <header className="page-head">
          <div>
            <span className="eyebrow">Loja</span>
            <h1>Trocas e Devoluções</h1>
          </div>
        </header>
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Loja</span>
          <h1>Trocas e Devoluções</h1>
          <p className="page-lead">
            Gerencie solicitações de devolução e troca. Você é notificado via WhatsApp quando um comprador solicita uma devolução.
          </p>
        </div>
      </header>

      {/* Explicação */}
      <div style={{
        padding: "16px 20px",
        borderRadius: "var(--radius-md)",
        background: "var(--color-brand-subtle)",
        border: "1px solid var(--color-brand-ring)",
        font: "13px var(--font-sans)",
        color: "var(--color-brand)",
        lineHeight: 1.65,
      }}>
        <strong style={{ color: "var(--color-text)" }}>Como funciona:</strong>{" "}
        O comprador solicita a devolução → você aprova e gera a etiqueta → o produto é enviado de volta →
        você inspeciona e decide: reembolso, troca ou rejeição. Cada etapa gera uma notificação automática para ambas as partes.
      </div>

      {/* KPIs */}
      <div className="grid-4" style={{ gap: 14 }}>
        <StatCard label="Total solicitações" value={vm.stats.total} icon={<Package size={16} />} />
        <StatCard label="Em trânsito" value={vm.stats.inTransit} icon={<Truck size={16} />} accent="var(--color-brand)" />
        <StatCard label="Aguardando inspeção" value={vm.stats.awaitingInspection} icon={<CheckCircle size={16} />} accent="var(--color-warning)" />
        <StatCard label="Reembolsados" value={vm.stats.refunded} icon={<DollarSign size={16} />} accent="var(--color-success)" />
      </div>

      {/* Lista */}
      <DataPanel
        title="Solicitações"
        page={page}
        pageSize={PAGE_SIZE}
        total={vm.returns.length}
        onPageChange={setPage}
        isEmpty={vm.returns.length === 0}
        empty={{ icon: RefreshCw, title: "Nenhuma solicitação", description: "Quando um comprador solicitar uma devolução ou troca, ela aparecerá aqui." }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Pedido</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Comprador</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Motivo</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Status</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Data</th>
                <th style={{ textAlign: "right", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((r, i) => {
                const st = STATUS_MAP[r.status] ?? STATUS_MAP.REQUESTED;
                const actionButton = getAction(r.status, r.id, vm);
                return (
                  <tr key={r.id} style={{ borderBottom: i < slice.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                    <td style={{ padding: "12px 20px", font: "12px var(--font-mono)", color: "var(--color-text)" }}>{r.orderId.slice(0, 12)}</td>
                    <td style={{ padding: "12px 20px", font: "13px var(--font-sans)", color: "var(--color-text)" }}>{r.buyerName || r.buyerEmail}</td>
                    <td style={{ padding: "12px 20px", font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>{REASON_MAP[r.reason] ?? r.reason}</td>
                    <td style={{ padding: "12px 20px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: st.bg, color: st.color }}>{st.label}</span>
                    </td>
                    <td style={{ padding: "12px 20px", font: "12px var(--font-mono)", color: "var(--color-text-faint)" }}>
                      {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                    </td>
                    <td style={{ padding: "12px 20px", textAlign: "right" }}>
                      {actionButton}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DataPanel>
    </div>
  );
}

function getAction(status: ReturnStatus, returnId: string, vm: any) {
  const btnStyle: React.CSSProperties = { fontSize: 11, padding: "4px 12px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", color: "var(--color-text-muted)", cursor: "pointer" };
  const disabled = vm.acting === returnId;

  switch (status) {
    case "REQUESTED":
      return <button type="button" className="zyn-btn zyn-btn--primary" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => vm.generateLabel(returnId)} disabled={disabled}>Gerar etiqueta</button>;
    case "SHIPPED":
      return <button type="button" style={btnStyle} onClick={() => vm.markReceived(returnId)} disabled={disabled}>Marcar recebido</button>;
    case "RECEIVED":
    case "INSPECTED_PASS":
      return <button type="button" className="zyn-btn zyn-btn--primary" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => vm.processRefund(returnId)} disabled={disabled}>Reembolsar</button>;
    default:
      return <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>—</span>;
  }
}
