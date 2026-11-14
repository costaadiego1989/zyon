import React, { useCallback, useEffect, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import type { MarketplaceRefund, RefundState } from "../../api/endpoints/marketplace-refunds.js";
import { useApi } from "../../hooks/useApi.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { PageHeader } from "../../components/PageHeader.js";
import { MarketplaceRefundPreparation } from "./MarketplaceRefundPreparation.js";
import "./marketplace-refunds.css";

const states: Record<RefundState, string> = { prepared: "Pronto para revisão", pending: "Aguardando confirmação", confirmed: "Estorno confirmado", blocked: "Revisão necessária" };
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const policy = (value: "refund" | "retain", cents: number) => value === "refund" ? `${money(cents)} devolvidos ao orçamento` : "Retida, sem crédito neste estorno";

export function MarketplaceRefundsPage({ me }: { me: MerchantProfile }) {
  if (me.role !== "OWNER" && me.role !== "ADMIN") return <EmptyState icon={Undo2} title="Acesso restrito" description="Somente proprietários e administradores podem gerenciar estornos." />;
  return <RefundWorkspace key={`${me.id}:${me.user_id}:${me.role}`} merchantName={me.name} />;
}

function RefundWorkspace({ merchantName }: { merchantName: string }) {
  const [preparing, setPreparing] = useState(false), [preparedId, setPreparedId] = useState<string | undefined>();
  if (preparing) return <MarketplaceRefundPreparation onBack={() => setPreparing(false)} onPrepared={id => { setPreparedId(id); setPreparing(false); }} />;
  return <RefundList key={preparedId ?? "list"} merchantName={merchantName} initialRefundId={preparedId} onPrepare={() => { setPreparedId(undefined); setPreparing(true); }} />;
}

function RefundList({ merchantName, initialRefundId, onPrepare }: { merchantName: string; initialRefundId?: string; onPrepare: () => void }) {
  const api = useApi();
  const [rows, setRows] = useState<MarketplaceRefund[]>([]), [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [next, setNext] = useState<string | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string | null>(null), [accepted, setAccepted] = useState(false), [uncertain, setUncertain] = useState<Set<string>>(new Set());
  const alive = useRef(true), working = useRef(false), revision = useRef(0), heading = useRef<HTMLHeadingElement>(null);
  const initialSelection = useRef(initialRefundId);
  const cursor = cursors[cursors.length - 1], detail = rows.find(row => row.refund_id === selected);
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  const load = useCallback(async () => {
    const request = ++revision.current; setLoading(true); setRows([]); setError(null); setSelected(null); setNext(null);
    try {
      if (initialSelection.current) {
        const id = initialSelection.current, result = await api.getMarketplaceRefund(id);
        if (!alive.current || request !== revision.current) return;
        initialSelection.current = undefined; setRows([result]); setSelected(id); return;
      }
      const result = await api.listMarketplaceRefunds(cursor);
      if (!alive.current || request !== revision.current) return;
      setRows(result.refunds); setNext(result.next_cursor);
    } catch { if (alive.current && request === revision.current) setError("Não foi possível carregar os estornos. Tente novamente."); }
    finally { if (alive.current && request === revision.current) setLoading(false); }
  }, [api, cursor]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selected) heading.current?.focus(); }, [selected]);
  function requireSame(row: MarketplaceRefund, result: MarketplaceRefund) {
    if (row.refund_id !== result.refund_id || row.payment_intent_id !== result.payment_intent_id || row.return_id !== result.return_id ||
      row.amount_cents !== result.amount_cents || JSON.stringify(row.components) !== JSON.stringify(result.components) || JSON.stringify(row.lines) !== JSON.stringify(result.lines)) throw new Error("refund_changed");
  }
  function replace(result: MarketplaceRefund) { setRows(current => current.map(row => row.refund_id === result.refund_id ? result : row)); }
  async function refresh(row: MarketplaceRefund) {
    if (working.current) return; working.current = true; setBusy(row.refund_id); setError(null);
    try {
      const result = await api.getMarketplaceRefund(row.refund_id);
      if (!alive.current) return; requireSame(row, result); replace(result);
      if (result.status !== "prepared") { setUncertain(current => { const copy = new Set(current); copy.delete(row.refund_id); return copy; }); setAccepted(false); }
      setNotice(result.status === "prepared" && uncertain.has(row.refund_id) ? "A solicitação ainda não foi confirmada. Aguarde e consulte novamente." : states[result.status]);
    } catch { if (alive.current) setError("Não foi possível consultar o estado. Aguarde e atualize novamente."); }
    finally { working.current = false; if (alive.current) setBusy(null); }
  }
  async function submit() {
    if (working.current || !detail?.can_execute || !accepted || uncertain.has(detail.refund_id)) return;
    const row = detail; working.current = true; setBusy(row.refund_id); setError(null); setUncertain(current => new Set(current).add(row.refund_id));
    try {
      const result = await api.executeMarketplaceRefund(row.refund_id, row.amount_cents);
      if (!alive.current) return; requireSame(row, result); replace(result);
      setUncertain(current => { const copy = new Set(current); copy.delete(row.refund_id); return copy; }); setNotice(states[result.status]);
    } catch { if (alive.current) setError("Não foi possível confirmar a solicitação. Consulte o estado antes de qualquer nova ação."); }
    finally { working.current = false; if (alive.current) { setBusy(null); setSelected(null); setAccepted(false); } }
  }

  return <div className="marketplace-refunds">
    <PageHeader title="Estornos do marketplace" description={`Planos de devolução preparados para ${merchantName}. Revise os valores antes de autorizar o envio.`}
      actions={<><Button variant="outline" disabled={loading || !!busy} onClick={onPrepare}>Preparar devolução</Button><Button variant="outline" disabled={loading || !!busy} onClick={() => void load()}>Atualizar lista</Button></>} />
    <p className="marketplace-refunds__help">Prepare devoluções com inspeção aprovada e componentes comerciais explícitos. A preparação e o envio do estorno são etapas separadas, disponíveis inclusive após mudança de plano.</p>
    <div className="marketplace-refunds__notice" role="status" aria-live="polite">{notice}</div>
    {error && <p role="alert" className="marketplace-refunds__error">{error}</p>}
    {loading ? <p role="status">Carregando estornos…</p> : !rows.length && !error ? <EmptyState icon={Undo2} title="Nenhum plano de estorno" description="Após a aprovação da devolução e a preparação dos valores, o plano aparecerá aqui para revisão." /> : null}
    {!loading && rows.length > 0 && <>
      <div className="marketplace-refunds__table-wrap" role="region" aria-label="Planos de estorno" tabIndex={0}>
        <table className="marketplace-refunds__table"><thead><tr><th>Devolução</th><th>Valor ao comprador</th><th>Preparado em</th><th>Estado</th><th>Ações</th></tr></thead><tbody>
          {rows.map(row => <tr key={row.refund_id}>
            <th scope="row"><span className="marketplace-refunds__id">{row.return_id}</span><small>Plano: {row.refund_id}</small></th>
            <td data-label="Valor ao comprador" className="marketplace-refunds__money">{money(row.amount_cents)}</td><td data-label="Preparado em">{new Date(row.created_at).toLocaleDateString("pt-BR")}</td>
            <td data-label="Estado"><span className="marketplace-refunds__state" data-state={row.status}>{uncertain.has(row.refund_id) ? "Solicitação sem confirmação" : states[row.status]}</span>
              {row.status === "pending" && <small>A conciliação verifica o provedor automaticamente.</small>}{row.status === "blocked" && <small>O plano precisa de revisão operacional antes de prosseguir.</small>}</td>
            <td><div className="marketplace-refunds__actions"><Button variant="outline" disabled={!!busy} onClick={() => { setSelected(row.refund_id); setAccepted(false); }}>Ver detalhes</Button>
              <Button variant="ghost" disabled={!!busy} onClick={() => void refresh(row)}>Consultar estado</Button></div></td>
          </tr>)}
        </tbody></table>
      </div>
      <nav className="marketplace-refunds__pagination" aria-label="Páginas de estornos"><Button variant="outline" disabled={cursors.length === 1 || !!busy} onClick={() => setCursors(current => current.slice(0, -1))}>Anterior</Button>
        <span>Página {cursors.length}</span><Button variant="outline" disabled={!next || !!busy} onClick={() => { if (next) setCursors(current => [...current, next]); }}>Próxima</Button></nav>
    </>}
    {detail && <section className="marketplace-refunds__detail" aria-labelledby="refund-detail-title">
      <h2 id="refund-detail-title" ref={heading} tabIndex={-1}>Revisar valores do estorno</h2>
      <p>Devolução <span className="marketplace-refunds__reference">{detail.return_id}</span><br />Pagamento <span className="marketplace-refunds__reference">{detail.payment_intent_id}</span></p>
      <dl className="marketplace-refunds__amounts"><dt>Produtos ({detail.lines.reduce((sum, line) => sum + line.quantity, 0)} unidades)</dt><dd>{money(detail.lines.reduce((sum, line) => sum + line.amount_cents, 0))}</dd>
        <dt>Frete</dt><dd>{money(detail.components.shipping_cents)}</dd><dt>Taxa de serviço do comprador</dt><dd>{money(detail.components.buyer_service_fee_cents)}</dd>
        <dt><strong>Total a devolver ao comprador</strong></dt><dd><strong>{money(detail.amount_cents)}</strong></dd></dl>
      <details><summary>Itens incluídos</summary><ul>{detail.lines.map(line => <li key={line.variant_id}><span className="marketplace-refunds__reference">{line.variant_id}</span>: {line.quantity} unidade(s), {money(line.amount_cents)}</li>)}</ul></details>
      <h3>Composição comercial aprovada</h3><p className="marketplace-refunds__help">Estas decisões distribuem o custo do estorno entre os participantes. Elas não reduzem o total informado ao comprador.</p>
      <dl className="marketplace-refunds__amounts"><dt>Comissão da loja anfitriã</dt><dd>{policy(detail.components.commission, detail.components.commission_refund_cents)}</dd>
        <dt>Taxas da plataforma dos vendedores</dt><dd>{policy(detail.components.platform_fees, detail.components.platform_fee_refund_cents)}</dd>
        <dt>Taxa da plataforma da loja anfitriã</dt><dd>{policy(detail.components.host_platform_fee, detail.components.host_platform_fee_refund_cents)}</dd></dl>
      <p className="marketplace-refunds__help">As taxas de processamento continuam a cargo de cada vendedor, proporcionalmente às suas vendas. O estorno só é concluído após confirmação independente do provedor.</p>
      {detail.can_execute && !uncertain.has(detail.refund_id) && <label className="marketplace-refunds__accept"><input type="checkbox" checked={accepted} disabled={!!busy} onChange={event => setAccepted(event.target.checked)} />Revisei os valores e autorizo devolver {money(detail.amount_cents)} ao comprador.</label>}
      <div className="marketplace-refunds__actions"><Button variant="outline" disabled={!!busy} onClick={() => setSelected(null)}>Fechar detalhes</Button>
        {detail.can_execute && !uncertain.has(detail.refund_id) && <Button variant="danger" disabled={!accepted || !!busy} loading={!!busy} onClick={() => void submit()}>Confirmar envio do estorno</Button>}</div>
    </section>}
  </div>;
}
