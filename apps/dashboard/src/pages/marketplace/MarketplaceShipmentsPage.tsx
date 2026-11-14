import React, { useCallback, useEffect, useRef, useState } from "react";
import { Truck } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { CARRIER_ORDER_UUID, type DashboardMarketplaceShipment, type MarketplaceShipmentPrivateLabel, type ShipmentRecovery, type ShipmentRecoveryState, type ShipmentState } from "../../api/endpoints/marketplace-shipments.js";
import { useApi } from "../../hooks/useApi.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { PageHeader } from "../../components/PageHeader.js";
import "./marketplace-shipments.css";

const recoveryLabels: Record<ShipmentRecoveryState, string> = {
  required: "Identificador pendente", in_flight: "Aguardando resposta", confirmed: "Identificador confirmado", not_applicable: "Recuperação indisponível",
};
const shipmentLabels: Record<ShipmentState, string> = {
  prepared: "Preparada", cart_unknown: "Criação em conferência", cart_created: "Criada no Melhor Envio", purchase_unknown: "Compra em conferência",
  purchased: "Etiqueta comprada", generate_unknown: "Emissão em conferência", generated: "Etiqueta emitida", blocked: "Remessa bloqueada",
};

export function MarketplaceShipmentsPage({ me }: { me: MerchantProfile }) {
  if (me.role !== "OWNER" && me.role !== "ADMIN") return <EmptyState icon={Truck} title="Acesso restrito" description="Somente proprietários e administradores podem consultar etiquetas e recuperar identificadores de remessas." />;
  return <ShipmentList key={`${me.id}:${me.user_id}:${me.role}`} merchantName={me.name} />;
}

function ShipmentList({ merchantName }: { merchantName: string }) {
  const api = useApi();
  const [rows, setRows] = useState<DashboardMarketplaceShipment[]>([]);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string | null>(null), [uuid, setUuid] = useState("");
  const [label, setLabel] = useState<MarketplaceShipmentPrivateLabel | null>(null);
  const [uncertain, setUncertain] = useState<Set<string>>(new Set());
  const alive = useRef(true), working = useRef(false), revision = useRef(0), title = useRef<HTMLHeadingElement>(null), labelTitle = useRef<HTMLHeadingElement>(null);
  const cursor = cursors[cursors.length - 1], selectedShipment = rows.find(row => row.shipment_id === selected);
  const labelShipment = label && rows.find(row => row.shipment_id === label.shipmentId && row.origin_merchant_id === label.originMerchantId && row.carrier_order_id === label.carrierOrderId && row.can_print);
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  const load = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true); setRows([]); setSelected(null); setLabel(null); setNext(null); setError(null); setUuid(""); setNotice("");
    try {
      const result = await api.listMarketplaceShipments(cursor);
      if (!alive.current || request !== revision.current) return;
      setRows(result.shipments); setNext(result.next_cursor);
    } catch { if (alive.current && request === revision.current) setError("Não foi possível carregar as remessas. Tente novamente."); }
    finally { if (alive.current && request === revision.current) setLoading(false); }
  }, [api, cursor]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selected) title.current?.focus(); }, [selected]);
  useEffect(() => { if (label) labelTitle.current?.focus(); }, [label]);

  function apply(row: DashboardMarketplaceShipment, result: ShipmentRecovery) {
    if (result.shipment_id !== row.shipment_id || result.origin_merchant_id !== row.origin_merchant_id || result.reference !== row.reference) throw new Error("invalid_shipment_binding");
    setRows(current => current.map(item => item.shipment_id === result.shipment_id ? { ...item, ...result,
      can_print: item.can_print && result.status === "generated" && result.carrier_order_id === item.carrier_order_id,
      can_recover: result.recovery_status === "required" && (item.can_recover || item.recovery_status === "in_flight") } : item));
    if (result.recovery_status !== "required") setSelected(current => current === row.shipment_id ? null : current);
    if (["confirmed", "not_applicable"].includes(result.recovery_status)) setUncertain(current => { const copy = new Set(current); copy.delete(row.shipment_id); return copy; });
  }
  async function refresh(row: DashboardMarketplaceShipment) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null); setLabel(null);
    try {
      const result = await api.getMarketplaceShipmentRecovery(row.shipment_id);
      if (!alive.current) return;
      apply(row, result);
      setNotice(uncertain.has(row.shipment_id) && result.recovery_status === "required" ? "A solicitação ainda não foi confirmada. Aguarde e consulte novamente." : recoveryLabels[result.recovery_status]);
    } catch { if (alive.current) setError("Não foi possível consultar a remessa. Aguarde e atualize novamente."); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function submit() {
    const row = selectedShipment, carrierOrderId = uuid.trim().toLowerCase();
    if (working.current || !row?.can_recover || !CARRIER_ORDER_UUID.test(carrierOrderId) || uncertain.has(row.shipment_id)) return;
    working.current = true; setBusy(true); setError(null); setLabel(null);
    setUncertain(current => new Set(current).add(row.shipment_id));
    try {
      const result = await api.recoverMarketplaceShipment(row.shipment_id, carrierOrderId);
      if (!alive.current) return;
      apply(row, result);
      setUncertain(current => { const copy = new Set(current); copy.delete(row.shipment_id); return copy; });
      setNotice(result.recovery_status === "required" ? "O identificador ainda não foi confirmado. Confira a conta da loja de origem e o UUID informado." : recoveryLabels[result.recovery_status]);
    } catch {
      if (alive.current) { setError("Não foi possível confirmar a solicitação. Consulte o estado antes de qualquer nova ação."); setSelected(null); }
    } finally { working.current = false; if (alive.current) setBusy(false); }
  }

  async function print(row: DashboardMarketplaceShipment) {
    if (working.current || !row.can_print) return;
    const request = revision.current;
    working.current = true; setBusy(true); setError(null); setNotice(""); setSelected(null); setLabel(null);
    try {
      const result = await api.getMarketplaceShipmentPrintLink(row);
      if (!alive.current || request !== revision.current) return;
      setLabel(result);
    } catch { if (alive.current && request === revision.current) setError("Não foi possível disponibilizar a etiqueta. Atualize a lista e confira o estado da remessa antes de tentar novamente."); }
    finally { working.current = false; if (alive.current && request === revision.current) setBusy(false); }
  }

  return <div className="marketplace-shipments">
    <PageHeader title="Remessas do marketplace" description={`Remessas das compras recebidas por ${merchantName}. Consulte etiquetas emitidas e recupere remessas no Melhor Envio.`}
      actions={<Button variant="outline" disabled={loading || busy} onClick={() => void load()}>Atualizar lista</Button>} />
    <p className="marketplace-shipments__help">Use esta recuperação quando a criação da remessa ficou sem confirmação. A compra e a emissão da etiqueta são etapas separadas. Este acesso permanece disponível após mudança de plano.</p>
    <div className="marketplace-shipments__notice" role="status" aria-live="polite">{notice}</div>
    {error && <p className="marketplace-shipments__error" role="alert">{error}</p>}
    {loading ? <p role="status">Carregando remessas…</p> : rows.length === 0 && !error ? <EmptyState icon={Truck} title="Nenhuma remessa do marketplace" description="As remessas já preparadas para compras recebidas pela sua loja aparecerão aqui." /> : null}
    {!loading && rows.length > 0 && <>
      <div className="marketplace-shipments__table-wrap" role="region" aria-label="Lista de remessas" tabIndex={0}>
        <table className="marketplace-shipments__table"><thead><tr><th>Remessa</th><th>Loja de origem</th><th>Criada em</th><th>Estado</th><th>Identificador</th><th>Ações</th></tr></thead><tbody>
          {rows.map(row => <tr key={row.shipment_id}>
            <th scope="row"><span className="marketplace-shipments__id" title={row.shipment_id}>{row.shipment_id}</span>
              {row.volume_count > 1 && <small>Volume {row.volume_index + 1} de {row.volume_count}</small>}</th>
            <td data-label="Loja de origem">{row.origin_name}</td><td data-label="Criada em">{new Date(row.created_at).toLocaleDateString("pt-BR")}</td>
            <td data-label="Estado"><strong>{shipmentLabels[row.status]}</strong><small>{uncertain.has(row.shipment_id) ? "Solicitação sem confirmação" : recoveryLabels[row.recovery_status]}</small>
              {row.status === "purchase_unknown" && <small>A compra aguarda comprovação. A emissão permanece bloqueada; não compre novamente.</small>}</td>
            <td data-label="Identificador"><span className="marketplace-shipments__reference">{row.carrier_order_id ?? "Ainda não vinculado"}</span></td>
            <td><div className="marketplace-shipments__actions">
              {row.can_print && <Button variant="outline" disabled={busy} onClick={() => void print(row)}>Obter etiqueta</Button>}
              {row.can_recover && !uncertain.has(row.shipment_id) && <Button variant="outline" disabled={busy} onClick={() => { setSelected(row.shipment_id); setLabel(null); setUuid(row.carrier_order_id ?? ""); setError(null); }}>Recuperar identificador</Button>}
              <Button variant="ghost" disabled={busy} onClick={() => void refresh(row)}>Consultar estado</Button>
            </div></td>
          </tr>)}
        </tbody></table>
      </div>
      <nav className="marketplace-shipments__pagination" aria-label="Páginas de remessas"><Button variant="outline" disabled={cursors.length === 1 || busy} onClick={() => setCursors(current => current.slice(0, -1))}>Anterior</Button>
        <span>Página {cursors.length}</span><Button variant="outline" disabled={!next || busy} onClick={() => { if (next) setCursors(current => [...current, next]); }}>Próxima</Button></nav>
    </>}
    {label && labelShipment && <section className="marketplace-shipments__confirmation" aria-labelledby="shipment-label-title">
      <h2 id="shipment-label-title" ref={labelTitle} tabIndex={-1}>Etiqueta disponível</h2>
      {labelShipment.volume_count > 1 && <p><strong>Volume {labelShipment.volume_index + 1} de {labelShipment.volume_count}</strong> · Cada volume tem sua própria etiqueta.</p>}
      <p>Para abrir a etiqueta da remessa <strong>{labelShipment.shipment_id}</strong>, entre no Melhor Envio com a mesma conta de <strong>{labelShipment.origin_name}</strong> usada na emissão.</p>
      <p className="marketplace-shipments__help">O link é privado. Abrir a etiqueta não confirma postagem nem entrega.</p>
      <div className="marketplace-shipments__actions"><a className="marketplace-shipments__label-link" href={label.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Abrir etiqueta no Melhor Envio <span className="marketplace-shipments__help">(nova aba)</span></a>
        <Button variant="ghost" onClick={() => setLabel(null)}>Fechar etiqueta</Button></div>
    </section>}
    {selectedShipment && <section className="marketplace-shipments__confirmation" aria-labelledby="shipment-recovery-title">
      <h2 id="shipment-recovery-title" ref={title} tabIndex={-1}>Conferir identificador da remessa</h2>
      {selectedShipment.volume_count > 1 && <p><strong>Volume {selectedShipment.volume_index + 1} de {selectedShipment.volume_count}</strong> · Confira o pacote correspondente antes de vincular.</p>}
      <p>Na conta de <strong>{selectedShipment.origin_name}</strong> no Melhor Envio, localize a remessa correspondente à referência abaixo e copie seu UUID.</p>
      <dl><dt>Remessa</dt><dd>{selectedShipment.shipment_id}</dd><dt>Pagamento</dt><dd>{selectedShipment.payment_intent_id}</dd><dt>Referência no Melhor Envio</dt><dd>{selectedShipment.reference}</dd></dl>
      <label htmlFor="carrier-order-uuid">Identificador (UUID) do Melhor Envio</label>
      <input id="carrier-order-uuid" type="text" value={uuid} disabled={busy} maxLength={36} autoComplete="off" spellCheck={false}
        placeholder="00000000-0000-0000-0000-000000000000" aria-describedby="carrier-order-uuid-help" aria-invalid={!!uuid && !CARRIER_ORDER_UUID.test(uuid.trim())}
        onChange={event => setUuid(event.target.value)} />
      <p id="carrier-order-uuid-help" className="marketplace-shipments__help">O UUID tem 36 caracteres, incluindo os hífens. A remessa será conferida antes de vincular o identificador.</p>
      <div className="marketplace-shipments__actions"><Button variant="outline" disabled={busy} onClick={() => setSelected(null)}>Voltar sem vincular</Button>
        <Button disabled={busy || !CARRIER_ORDER_UUID.test(uuid.trim())} loading={busy} onClick={() => void submit()}>Confirmar recuperação do identificador</Button></div>
    </section>}
  </div>;
}
