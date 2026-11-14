import React, { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { Button } from "../../components/Button.js";
import { PageHeader } from "../../components/PageHeader.js";
import { DashboardHttpError } from "../../api/http/error.js";
import type { PreparedRefund, RefundCandidate, RefundPolicy, RefundPreparationComponents } from "../../api/endpoints/marketplace-refund-preparation.js";
import "./marketplace-refund-preparation.css";

const money = (amount: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount / 100);
function parseReais(value: string): number | null {
  if (!/^(0|[1-9][0-9]*)(,[0-9]{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(",");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? amount : null;
}
const withinLimit = (value: string, max: number) => { const amount = parseReais(value); return amount !== null && amount <= max; };
const policies = { commission: "Comissão da loja anfitriã", platformFees: "Taxas da plataforma dos vendedores", hostPlatformFee: "Taxa da plataforma da loja anfitriã" };
type PolicyKey = keyof typeof policies;
const emptyPolicy = { commission: "", platformFees: "", hostPlatformFee: "" } as Record<PolicyKey, RefundPolicy | "">;

export function MarketplaceRefundPreparation({ onBack, onPrepared }: { onBack: () => void; onPrepared: (id: string) => void }) {
  const api = useApi(), alive = useRef(true), revision = useRef(0), working = useRef(false), title = useRef<HTMLHeadingElement>(null);
  const [rows, setRows] = useState<RefundCandidate[]>([]), [cursors, setCursors] = useState<Array<string | undefined>>([undefined]), [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [candidate, setCandidate] = useState<RefundCandidate | null>(null), [prepared, setPrepared] = useState<PreparedRefund | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [uncertain, setUncertain] = useState(false), [stale, setStale] = useState(false);
  const [choices, setChoices] = useState(emptyPolicy), [buyerFee, setBuyerFee] = useState(""), [shipping, setShipping] = useState<Record<string, string>>({}), [confirmed, setConfirmed] = useState(false);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  const load = useCallback(async () => {
    const version = ++revision.current; setLoading(true); setRows([]); setError(""); setNext(null);
    try { const result = await api.listMarketplaceRefundCandidates(cursor); if (alive.current && version === revision.current) { setRows(result.candidates); setNext(result.next_cursor); } }
    catch { if (alive.current && version === revision.current) setError("Não foi possível consultar as devoluções. Tente novamente."); }
    finally { if (alive.current && version === revision.current) setLoading(false); }
  }, [api, cursor]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selected) title.current?.focus(); }, [selected]);
  function useCandidate(value: RefundCandidate) {
    setCandidate(value); setPrepared(null); setChoices(emptyPolicy);
    setBuyerFee((value.buyer_service_fee_refund_cents / 100).toFixed(2).replace(".", ","));
    setShipping(Object.fromEntries(value.shipping.map(row => [row.merchant_id, (row.refund_cents / 100).toFixed(2).replace(".", ",")])));
    setConfirmed(false); setStale(false);
  }
  async function inspect(returnId: string, consultation = false) {
    if (working.current) return; working.current = true; setBusy(true); setError("");
    try {
      const result = await api.getMarketplaceRefundPreparation(returnId);
      if (!alive.current) return;
      setSelected(returnId);
      if (result.prepared_refund) { setPrepared(result.prepared_refund); setCandidate(null); setUncertain(false); }
      else if (result.candidate) {
        if (!consultation || !uncertain) { useCandidate(result.candidate); setUncertain(false); }
        else setError("A preparação ainda não foi confirmada. Aguarde e consulte novamente.");
      }
    } catch { if (alive.current) setError("Não foi possível consultar esta devolução. Atualize a lista e revise os dados."); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  const fieldsValid = !!candidate && Object.keys(policies).every(key => !!choices[key as PolicyKey] &&
    (!candidate.required_policy || choices[key as PolicyKey] === candidate.required_policy[key as PolicyKey])) &&
    withinLimit(buyerFee, candidate.buyer_service_fee_available_cents) && candidate.shipping.every(row => withinLimit(shipping[row.merchant_id] ?? "", row.available_cents));
  const total = candidate ? candidate.products_amount_cents + (withinLimit(buyerFee, candidate.buyer_service_fee_available_cents) ? parseReais(buyerFee)! : 0) +
    candidate.shipping.reduce((sum, row) => sum + (withinLimit(shipping[row.merchant_id] ?? "", row.available_cents) ? parseReais(shipping[row.merchant_id])! : 0), 0) : 0;
  async function prepare() {
    if (working.current || !candidate?.can_prepare || !fieldsValid || !confirmed || uncertain || stale) return;
    const current = candidate, components: RefundPreparationComponents = { ...choices as Record<PolicyKey, RefundPolicy>, buyerServiceFeeCents: parseReais(buyerFee)!,
      shipping: current.shipping.map(row => ({ merchantId: row.merchant_id, amountCents: parseReais(shipping[row.merchant_id])! })) };
    working.current = true; setBusy(true); setUncertain(true); setError("");
    try {
      const result = await api.prepareMarketplaceRefund(current.return_id, current.expected_preparation_hash, components);
      if (!alive.current) return;
      if (result.prepared_refund?.payment_intent_id !== current.payment_intent_id || result.prepared_refund.amount_cents !== total) throw new Error("preparation_mismatch");
      setPrepared(result.prepared_refund); setCandidate(null); setUncertain(false);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof DashboardHttpError && [400, 409].includes(error.status)) {
        setUncertain(false); setStale(true); setConfirmed(false); setError("Os dados mudaram ou os componentes não estão disponíveis. Consulte a devolução e revise o formulário novamente.");
      } else setError("Não foi possível confirmar a preparação. Consulte o estado antes de qualquer nova ação.");
    } finally { working.current = false; if (alive.current) setBusy(false); }
  }
  const canSelect = !busy && !uncertain;
  return <div className="marketplace-refund-preparation">
    <PageHeader title="Preparar devolução" description="Escolha uma devolução com inspeção aprovada e defina os componentes do estorno."
      actions={<Button variant="outline" disabled={busy} onClick={onBack}>Voltar aos estornos</Button>} />
    <p className="marketplace-help">Preparar reserva os valores e pode suspender repasses e envios associados. O dinheiro só será enviado após outra confirmação na revisão do plano.</p>
    {error && <p role="alert" className="marketplace-refunds__error">{error}</p>}
    {!selected && <>
      <Button variant="outline" disabled={loading || busy} onClick={() => void load()}>Atualizar devoluções</Button>
      {loading ? <p role="status">Consultando devoluções…</p> : rows.length === 0 ? <p>Nenhuma devolução elegível nesta página.{next ? " Continue para consultar os próximos registros." : " As devoluções com inspeção aprovada aparecerão aqui."}</p> :
        <ul className="marketplace-refund-preparation__candidates">{rows.map(row => <li key={row.return_id}><div><strong>{row.return_id}</strong><p>Produtos: {money(row.products_amount_cents)} · {row.lines.reduce((sum, line) => sum + line.quantity, 0)} unidade(s)</p>
          {!row.can_prepare && <small>Uma operação anterior precisa ser conciliada.</small>}</div><Button variant="outline" disabled={!canSelect || !row.can_prepare} onClick={() => void inspect(row.return_id)}>Definir componentes</Button></li>)}</ul>}
      <nav aria-label="Páginas de devoluções" className="marketplace-refunds__pagination"><Button variant="outline" disabled={cursors.length === 1 || busy || loading} onClick={() => setCursors(current => current.slice(0, -1))}>Anterior</Button><span>Página {cursors.length}</span>
        <Button variant="outline" disabled={!next || busy || loading} onClick={() => { if (next) setCursors(current => [...current, next]); }}>Próxima</Button></nav>
    </>}
    {selected && <section className="marketplace-refund-preparation__form" aria-labelledby="prepare-title">
      <h2 id="prepare-title" tabIndex={-1} ref={title}>{prepared ? "Plano preparado" : "Definir componentes do estorno"}</h2>
      <p>Devolução <span className="marketplace-refunds__reference">{selected}</span></p>
      {prepared ? <><p role="status">{prepared.status === "blocked" ? "Plano preparado com revisão operacional necessária. O estorno permanece bloqueado." : "Plano registrado. Revise os valores antes de qualquer envio."}</p>
        <p>Total do plano: <strong>{money(prepared.amount_cents)}</strong></p><Button onClick={() => onPrepared(prepared.refund_id)}>Abrir plano de estorno</Button></> : <>
        {candidate && <><p>Produtos aprovados: <strong>{money(candidate.products_amount_cents)}</strong></p>
          <details><summary>Conferir itens e quantidades</summary><ul>{candidate.lines.map((line, index) => <li key={line.variant_id}><strong>Item {index + 1}</strong>: {line.quantity} unidade(s), {money(line.amount_cents)}<br /><small>Referência: {line.variant_id}</small></li>)}</ul></details>
          <p className="marketplace-help">Decida como os participantes assumirão o custo. Devolver uma comissão ou taxa reduz a parcela de quem a recebeu; reter mantém esse custo no vendedor. O total ao comprador inclui produtos, frete escolhido e taxa de serviço escolhida.</p>
          {candidate.required_policy && <p>Este pagamento já teve um estorno. A política anterior deve ser mantida e confirmada em cada campo.</p>}
          <fieldset disabled={busy || uncertain || stale}><legend>Política comercial</legend>
            {(Object.keys(policies) as PolicyKey[]).map(key => <label key={key}>{policies[key]}<select aria-label={policies[key]} value={choices[key]} onChange={event => { setChoices(current => ({ ...current, [key]: event.target.value as RefundPolicy })); setConfirmed(false); }}>
              <option value="">Escolha uma opção</option><option value="refund" disabled={!!candidate.required_policy && candidate.required_policy[key] !== "refund"}>Devolver ao orçamento do estorno</option><option value="retain" disabled={!!candidate.required_policy && candidate.required_policy[key] !== "retain"}>Reter, sem crédito neste estorno</option></select></label>)}
          </fieldset>
          <fieldset disabled={busy || uncertain || stale}><legend>Valores a devolver em reais</legend><p>Digite 0 quando optar por não devolver o componente. Use vírgula para os centavos, como 1,50, sem separador de milhar.</p>
            <label>Taxa de serviço do comprador (R$)<input value={buyerFee} readOnly /><small>Calculada pelo pedido original. Devolvida integralmente no estorno total.</small></label>
            {candidate.shipping.map(row => <label key={row.merchant_id}>Frete de {row.merchant_name} (R$)<input value={shipping[row.merchant_id] ?? ""} readOnly /><small>Incluído no estorno, proporcional aos itens devolvidos desta loja.</small></label>)}
          </fieldset>
          <p>As taxas de processamento permanecem a cargo de cada vendedor, proporcionalmente às suas vendas.</p>
          <p>{fieldsValid ? <>Total proposto ao comprador: <strong>{money(total)}</strong></> : "Preencha todos os componentes para conferir o total proposto."}</p>
          {!uncertain && !stale && <label className="marketplace-refunds__accept"><input type="checkbox" checked={confirmed} disabled={!fieldsValid || busy} onChange={event => setConfirmed(event.target.checked)} />Revisei os componentes e autorizo preparar o plano, sem enviar dinheiro.</label>}
          {uncertain && <p role="status">Preparação sem confirmação. Use somente a consulta de estado.</p>}
        </>}
        <div className="marketplace-refunds__actions"><Button variant="outline" disabled={busy} onClick={() => void inspect(selected, true)}>Consultar preparação</Button>
          {!uncertain && !stale && <Button disabled={!candidate?.can_prepare || !fieldsValid || !confirmed || busy} loading={busy} onClick={() => void prepare()}>Confirmar preparação do plano</Button>}
          <Button variant="ghost" disabled={!canSelect} onClick={() => { setSelected(null); setCandidate(null); setConfirmed(false); }}>Escolher outra devolução</Button></div>
      </>}
    </section>}
  </div>;
}
