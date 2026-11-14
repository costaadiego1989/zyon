import React, { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import type { CancellationReason, CancellationState, MarketplacePayment } from "../../api/endpoints/marketplace-cancellation.js";
import { useApi } from "../../hooks/useApi.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { PageHeader } from "../../components/PageHeader.js";
import "./marketplace-payments.css";

const reasons: Record<CancellationReason, string> = {
  requested_by_customer: "Solicitação do comprador", abandoned: "Compra abandonada", duplicate: "Cobrança duplicada", fraudulent: "Suspeita de fraude",
};
const states: Record<CancellationState, string> = {
  not_requested: "Não solicitado", pending: "Aguardando confirmação", cancelled: "Cancelamento confirmado", blocked: "Cancelamento bloqueado",
};
const money = (payment: MarketplacePayment) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: payment.currency }).format(payment.amount_cents / 100);

export function MarketplacePaymentsPage({ me }: { me: MerchantProfile }) {
  if (me.role !== "OWNER" && me.role !== "ADMIN") return <EmptyState icon={CreditCard} title="Acesso restrito" description="Somente proprietários e administradores podem gerenciar estas cobranças." />;
  // A changed principal destroys in-flight views, selected reasons and confirmation state.
  return <PaymentList key={`${me.id}:${me.user_id}:${me.role}`} merchantName={me.name} />;
}

function PaymentList({ merchantName }: { merchantName: string }) {
  const api = useApi();
  const [rows, setRows] = useState<MarketplacePayment[]>([]);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState<CancellationReason | "">("");
  const [uncertain, setUncertain] = useState<Set<string>>(new Set());
  const alive = useRef(true), working = useRef(false), revision = useRef(0);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  const load = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true); setRows([]); setError(null); setSelected(null); setNext(null);
    try {
      const result = await api.listMarketplacePayments(cursor);
      if (!alive.current || revision.current !== request) return;
      setRows(result.payments); setNext(result.next_cursor);
    } catch {
      if (alive.current && revision.current === request) setError("Não foi possível carregar as cobranças. Tente novamente.");
    } finally { if (alive.current && revision.current === request) setLoading(false); }
  }, [api, cursor]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selected) confirmation.current?.focus(); }, [selected]);
  const selectedPayment = rows.find(row => row.payment_intent_id === selected);

  async function refresh(row: MarketplacePayment) {
    if (working.current) return;
    working.current = true; setBusy(row.payment_intent_id); setError(null);
    try {
      const result = await api.getMarketplaceCancellation(row.payment_intent_id);
      if (!alive.current) return;
      if (result.payment_intent_id !== row.payment_intent_id || !Object.hasOwn(states, result.status)) throw new Error("invalid_state");
      setRows(current => current.map(item => item.payment_intent_id === result.payment_intent_id ? { ...item, status: result.status, can_request: item.can_request && result.status === "not_requested" } : item));
      if (result.status !== "not_requested") setSelected(current => current === row.payment_intent_id ? null : current);
      // An ambiguous submission cannot be retried just because an early GET saw no journal.
      if (result.status !== "not_requested") setUncertain(current => { const copy = new Set(current); copy.delete(row.payment_intent_id); return copy; });
      setNotice(result.status === "not_requested" && uncertain.has(row.payment_intent_id) ? "A solicitação ainda não foi confirmada. Aguarde e consulte novamente." : states[result.status]);
    } catch { if (alive.current) setError("Não foi possível consultar o estado. Aguarde e atualize novamente."); }
    finally { working.current = false; if (alive.current) setBusy(null); }
  }
  async function submit() {
    if (working.current || !selectedPayment?.can_request || !reason || uncertain.has(selectedPayment.payment_intent_id)) return;
    const payment = selectedPayment, chosenReason = reason;
    working.current = true; setBusy(payment.payment_intent_id); setError(null);
    // Mark uncertain before issuing the request. Navigation or timeout never schedules a retry.
    setUncertain(current => new Set(current).add(payment.payment_intent_id));
    try {
      const result = await api.cancelMarketplacePayment(payment.payment_intent_id, chosenReason);
      if (!alive.current) return;
      if (result.payment_intent_id !== payment.payment_intent_id || !["pending", "cancelled", "blocked"].includes(result.status)) throw new Error("invalid_cancellation_response");
      setRows(current => current.map(row => row.payment_intent_id === result.payment_intent_id ? { ...row, status: result.status, reason: chosenReason, can_request: false } : row));
      setUncertain(current => { const copy = new Set(current); copy.delete(payment.payment_intent_id); return copy; });
      setNotice(states[result.status]);
    } catch {
      if (alive.current) setError("Não foi possível confirmar a solicitação. Consulte o estado antes de qualquer nova ação.");
    } finally { working.current = false; if (alive.current) { setBusy(null); setSelected(null); setReason(""); } }
  }

  return <div className="marketplace-payments">
    <PageHeader title="Cobranças do marketplace" description={`Cobranças recebidas por ${merchantName}. Consulte e solicite o cancelamento antes da confirmação do pagamento.`}
      actions={<Button variant="outline" disabled={loading || !!busy} onClick={() => void load()}>Atualizar lista</Button>} />
    <p className="marketplace-payments__help">O cancelamento só é concluído após confirmação do provedor. Pagamentos já recebidos precisam seguir o fluxo de devolução. Este acesso permanece disponível após mudança de plano.</p>
    <div className="marketplace-payments__notice" role="status" aria-live="polite">{notice}</div>
    {error && <p className="marketplace-payments__error" role="alert">{error}</p>}
    {loading ? <p role="status">Carregando cobranças…</p> : rows.length === 0 && !error ? <EmptyState icon={CreditCard} title="Nenhuma cobrança do marketplace" description="As cobranças recebidas pela sua loja aparecerão aqui. Nenhum cancelamento foi solicitado." /> : null}
    {!loading && rows.length > 0 && <>
      <div className="marketplace-payments__table-wrap" role="region" aria-label="Lista de cobranças" tabIndex={0}>
        <table className="marketplace-payments__table"><thead><tr><th>Cobrança</th><th>Valor</th><th>Criada em</th><th>Cancelamento</th><th>Motivo</th><th>Ações</th></tr></thead><tbody>
          {rows.map(row => <tr key={row.payment_intent_id}>
            <th scope="row"><span className="marketplace-payments__id" title={row.payment_intent_id}>{row.payment_intent_id}</span></th>
            <td data-label="Valor" className="marketplace-payments__money">{money(row)}</td><td data-label="Criada em">{new Date(row.created_at).toLocaleDateString("pt-BR")}</td>
            <td data-label="Cancelamento"><span className="marketplace-payments__state" data-state={uncertain.has(row.payment_intent_id) ? "pending" : row.status}>{uncertain.has(row.payment_intent_id) ? "Solicitação sem confirmação" : states[row.status]}</span>
              {row.status === "blocked" && <small>Revise o pagamento antes de prosseguir.</small>}
              {row.status === "not_requested" && !row.can_request && <small>Cancelamento indisponível para esta cobrança.</small>}</td>
            <td data-label="Motivo">{row.reason ? reasons[row.reason] : "Não informado"}</td>
            <td><div className="marketplace-payments__actions">
              {row.can_request && !uncertain.has(row.payment_intent_id) && <Button variant="outline" disabled={!!busy} onClick={() => { setSelected(row.payment_intent_id); setReason(""); setError(null); }}>Revisar cancelamento</Button>}
              <Button variant="ghost" disabled={!!busy} onClick={() => void refresh(row)}>Consultar estado</Button>
            </div></td>
          </tr>)}
        </tbody></table>
      </div>
      <nav className="marketplace-payments__pagination" aria-label="Páginas de cobranças">
        <Button variant="outline" disabled={cursors.length === 1 || !!busy} onClick={() => setCursors(current => current.slice(0, -1))}>Anterior</Button>
        <span>Página {cursors.length}</span><Button variant="outline" disabled={!next || !!busy} onClick={() => { if (next) setCursors(current => [...current, next]); }}>Próxima</Button>
      </nav>
    </>}
    {selectedPayment && <section className="marketplace-payments__confirmation" aria-labelledby="cancel-confirm-title">
      <h2 id="cancel-confirm-title" ref={confirmation} tabIndex={-1}>Revisar cancelamento</h2>
      <p>Solicitar o cancelamento de <strong>{money(selectedPayment)}</strong> na cobrança <span className="marketplace-payments__reference">{selectedPayment.payment_intent_id}</span>?</p>
      <p>Após o envio, aguarde a confirmação. O estoque será liberado somente quando o provedor confirmar que o pagamento não foi recebido.</p>
      <label htmlFor="cancellation-reason">Motivo do cancelamento</label>
      <select id="cancellation-reason" value={reason} disabled={!!busy} onChange={event => setReason(event.target.value as CancellationReason | "")}>
        <option value="">Selecione um motivo</option>{Object.entries(reasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <div className="marketplace-payments__actions"><Button variant="outline" disabled={!!busy} onClick={() => setSelected(null)}>Voltar sem cancelar</Button>
        <Button variant="danger" disabled={!reason || !!busy} loading={!!busy} onClick={() => void submit()}>Confirmar solicitação de cancelamento</Button></div>
    </section>}
  </div>;
}
