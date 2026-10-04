import React, { useState } from "react";
import { RefreshCw, Package, Truck, CheckCircle, DollarSign } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { StatCard } from "../overview/components/StatCard.js";
import { DataPanel } from "../../components/DataPanel.js";
import { PageLoader } from "../../components/PageLoader.js";
import { SetupGuide } from "../../components/SetupGuide.js";
import { useReturnExchangesPage } from "./useReturnExchangesPage.js";
import { Button } from "../../components/Button.js";

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
  EXCHANGE_COMPLETED: { label: "Troca concluída", bg: "var(--color-success-bg)", color: "var(--color-success)" },
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
            Acompanhe cada solicitação na conversa com o cliente, com pedido, itens, fotos e decisões no mesmo lugar.
          </p>
        </div>
      </header>

      <SetupGuide title="Como acompanhar trocas e devoluções" steps={[
        { title: "Confira a solicitação", description: "Abra o pedido de devolução e avalie o motivo informado pelo comprador." },
        { title: "Organize o retorno", description: "Após aprovar, confira a etiqueta e acompanhe o envio do produto de volta à loja." },
        { title: "Inspecione e registre a decisão", description: "Ao receber o produto, registre o resultado da inspeção e acompanhe a troca, o reembolso ou a rejeição conforme as opções disponíveis." },
      ]} />

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
                const actionButton = <Button variant="outline" size="sm" disabled={vm.acting === r.id} onClick={() => void vm.openConversation(r.id)}>Abrir conversa</Button>;
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

