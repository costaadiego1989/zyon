import React, { useEffect, useState } from "react";
import { RefreshCw, Package, Truck, CheckCircle, DollarSign } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { StatCard } from "../overview/components/StatCard.js";
import { DataPanel } from "../../components/DataPanel.js";
import { PageLoader } from "../../components/PageLoader.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { Modal } from "../../components/Modal.js";
import { useReturnExchangesPage } from "./useReturnExchangesPage.js";
import { ReturnReverseShippingPanel } from "./ReturnReverseShippingPanel.js";
import type { ReturnStatus, ReturnItemCondition } from "../../api/endpoints/returns.js";

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
  const [labelTarget, setLabelTarget] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState({ carrier: "Correios", trackingNumber: "", labelUrl: "" });
  const [inspectionTarget, setInspectionTarget] = useState<string | null>(null);
  const [condition, setCondition] = useState<ReturnItemCondition | "">("");
  useEffect(() => { setLabelTarget(null); setInspectionTarget(null); }, [me.id]);
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
            Confira as solicitações dos compradores e aprove o estorno após analisar o pedido.
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
        O chamado registra a solicitação. Ao aprovar o estorno, você confirma o valor com o frete devido ao comprador.
        O reembolso fica em processamento até a confirmação do provedor de pagamento.
      </div>

      {/* KPIs */}
      {vm.reverseShipping && <ReturnReverseShippingPanel key={`${me.id}:${vm.reverseShipping.returnId}:${vm.reverseShipping.shipments.length}`}
        view={vm.reverseShipping} busy={Boolean(vm.acting)} onClose={vm.closeReverseShipping}
        onRefresh={() => void vm.openReverseShipping(vm.reverseShipping!.returnId)} onPrepare={vm.prepareReverseShipping} onConfirm={vm.confirmReverseShipping} />}
      <Modal isOpen={Boolean(inspectionTarget)} title="Analisar produto devolvido" size="sm" presentation="center"
        onClose={() => { if (!vm.acting) setInspectionTarget(null); }}>
        <form onSubmit={event => { event.preventDefault(); if (inspectionTarget && condition) void vm.inspectReturn(inspectionTarget, condition).then(saved => { if (saved) setInspectionTarget(null); }); }}>
          <div className="form-field"><label htmlFor="return-inspection-condition">Condição do produto</label><select id="return-inspection-condition" required value={condition} onChange={event => setCondition(event.target.value as ReturnItemCondition)}>
            <option value="">Selecione após conferir o produto</option><option value="NEW">Novo</option><option value="GOOD">Em boas condições</option><option value="DAMAGED">Danificado</option><option value="UNUSABLE">Inutilizável</option>
          </select></div>
          <p>A condição inutilizável registra a devolução como reprovada. As demais permitem preparar o estorno; o envio do dinheiro exige confirmação separada.</p>
          <button type="submit" className="zyn-btn zyn-btn--primary" disabled={Boolean(vm.acting) || !condition}>Registrar análise</button>
        </form>
      </Modal>
      <Modal isOpen={Boolean(labelTarget)} title="Informar etiqueta de devolução" size="sm" presentation="center"
        onClose={() => { if (!vm.acting) setLabelTarget(null); }}>
        <p>Emita a logística reversa no Melhor Envio ou na transportadora e informe a etiqueta ou o código de postagem recebido.</p>
        <form onSubmit={event => { event.preventDefault(); if (labelTarget) void vm.generateLabel(labelTarget, labelInput).then(saved => { if (saved) setLabelTarget(null); }); }}>
          <label className="form-field">Transportadora<input required maxLength={80} value={labelInput.carrier} onChange={event => setLabelInput({ ...labelInput, carrier: event.target.value })} /></label>
          <label className="form-field">Código de postagem ou rastreio<input required pattern="[A-Za-z0-9_-]{4,100}" value={labelInput.trackingNumber} onChange={event => setLabelInput({ ...labelInput, trackingNumber: event.target.value })} /></label>
          <label className="form-field">Link da etiqueta (opcional)<input type="url" placeholder="https://" value={labelInput.labelUrl} onChange={event => setLabelInput({ ...labelInput, labelUrl: event.target.value })} /></label>
          <button type="submit" className="zyn-btn zyn-btn--primary" disabled={Boolean(vm.acting)}>Registrar etiqueta</button>
        </form>
      </Modal>
      <ConfirmDialog open={Boolean(vm.refundConfirmation)} title="Aprovar estorno ao comprador?"
        description={vm.refundConfirmation ? `Valor a devolver: ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(vm.refundConfirmation.amountCents / 100)}. O total inclui o frete devido pelos itens devolvidos. Ao confirmar, o estorno será enviado ao provedor do pagamento original.` : ""}
        confirmLabel="Aprovar e estornar" variant="default" busy={Boolean(vm.acting)} onCancel={vm.dismissRefundConfirmation} onConfirm={vm.confirmRefund} />
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
                const actionButton = getAction(r, vm, id => { setLabelInput({ carrier: "Correios", trackingNumber: "", labelUrl: "" }); setLabelTarget(id); },
                  id => { setCondition(""); setInspectionTarget(id); });
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

function getAction(ret: { id: string; status: ReturnStatus; refund?: { status: string } }, vm: ReturnType<typeof useReturnExchangesPage>, informLabel: (id: string) => void, inspect: (id: string) => void) {
  const status = ret.status;
  const returnId = ret.id;
  const btnStyle: React.CSSProperties = { fontSize: 11, padding: "4px 12px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", color: "var(--color-text-muted)", cursor: "pointer" };
  const disabled = vm.acting === returnId;

  switch (status) {
    case "REQUESTED":
      return (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <button type="button" className="zyn-btn zyn-btn--primary" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => vm.acceptReturn(returnId)} disabled={disabled}>Aprovar estorno</button>
          <button type="button" style={btnStyle} onClick={() => void vm.openReverseShipping(returnId)} disabled={disabled}>Preparar devolução</button>
          <button type="button" style={btnStyle} onClick={() => informLabel(returnId)} disabled={disabled}>Informar etiqueta</button>
        </span>
      );
    case "LABEL_GENERATED":
    case "SHIPPED":
      return <span style={{ display: "inline-flex", gap: 6 }}><button type="button" style={btnStyle} onClick={() => void vm.openReverseShipping(returnId)} disabled={disabled}>Consultar códigos</button>
        <button type="button" style={btnStyle} onClick={() => vm.markReceived(returnId)} disabled={disabled}>Marcar recebido</button></span>;
    case "RECEIVED":
      return <button type="button" style={btnStyle} onClick={() => inspect(returnId)} disabled={disabled}>Analisar devolução</button>;
    case "INSPECTED_PASS":
      return <button type="button" className="zyn-btn zyn-btn--primary" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => vm.processRefund(returnId)} disabled={disabled}>Reembolsar</button>;
    case "REFUND_PROCESSING":
      if (ret.refund?.status === "PENDING") {
        return <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>Em processamento</span>;
      }
      if (ret.refund?.status === "FAILED") {
        return <button type="button" style={btnStyle} onClick={() => vm.processRefund(returnId)} disabled={disabled}>Reconciliar novamente</button>;
      }
      return <button type="button" className="zyn-btn zyn-btn--primary" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => vm.processRefund(returnId)} disabled={disabled}>Emitir reembolso</button>;
    default:
      return <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>—</span>;
  }
}
