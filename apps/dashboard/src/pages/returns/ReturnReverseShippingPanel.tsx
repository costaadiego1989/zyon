import { useState } from "react";
import type { ReverseParcel, ReverseShippingView } from "../../api/endpoints/returns.js";

type Props = { view: ReverseShippingView; busy: boolean; onClose: () => void; onRefresh: () => void;
  onPrepare: (input: { serviceId: 1 | 2; packages: Array<{ originMerchantId: string; package: ReverseParcel; email: string; phone: string }> }) => Promise<void>;
  onConfirm: () => Promise<void> };
const brl = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const statuses: Record<string, string> = { reverse_cart_unknown: "Preparação em conferência", reverse_cart_ready: "Aguardando confirmação da compra",
  reverse_purchase_unknown: "Pagamento em conferência", reverse_purchased: "Frete comprado", reverse_generation_unknown: "Código em geração", reverse_generated: "Código disponível" };

export function ReturnReverseShippingPanel({ view, busy, onClose, onRefresh, onPrepare, onConfirm }: Props) {
  const [serviceId, setServiceId] = useState<1 | 2>(1);
  const [parcels, setParcels] = useState(() => (view.candidates ?? []).map(c => ({ ...c,
    package: c.package ?? { height: 0, width: 0, length: 0, weight: 0 } })));
  const patch = (index: number, changes: Partial<typeof parcels[number]>) => setParcels(rows => rows.map((row, i) => i === index ? { ...row, ...changes } : row));
  const allGenerated = view.shipments.length > 0 && view.shipments.every(s => s.status === "reverse_generated");
  const costKnown = view.shipments.length > 0 && view.shipments.every(s => Number.isSafeInteger(s.amountCents));
  return <section aria-label="Frete de devolução" style={{ marginBlock: 20, padding: 20, border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><h2>Frete de devolução</h2>
      <button type="button" className="zyn-btn zyn-btn--ghost" disabled={busy} onClick={onClose}>Fechar</button></div>
    {view.shipments.length === 0 ? <form onSubmit={event => { event.preventDefault(); void onPrepare({ serviceId, packages: parcels.map(({ originMerchantId, package: parcel, email, phone }) => ({ originMerchantId, package: parcel, email, phone })) }); }}>
      <p>Confira a embalagem de cada devolução. O destino é a loja que enviou o produto. A consulta prepara o frete para você confirmar o custo antes da compra.</p>
      <div className="form-field"><label htmlFor="reverse-service">Serviço dos Correios</label><select id="reverse-service" value={serviceId} disabled={busy} onChange={event => setServiceId(Number(event.target.value) as 1 | 2)}><option value={1}>PAC</option><option value={2}>SEDEX</option></select></div>
      {parcels.map((parcel, index) => <fieldset key={parcel.originMerchantId} disabled={busy} style={{ marginBlock: 16 }}>
        <legend>{parcel.originName}</legend>
        <p>Uma embalagem para os itens que voltam para esta loja.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          {(["height", "width", "length", "weight"] as const).map(field => <div className="form-field" key={field}>
            <label htmlFor={`reverse-${index}-${field}`}>{({ height: "Altura (cm)", width: "Largura (cm)", length: "Comprimento (cm)", weight: "Peso (kg)" })[field]}</label>
            <input id={`reverse-${index}-${field}`} type="number" min={field === "weight" ? 0.001 : ({ height: 1, width: 8, length: 13 })[field]} max={field === "weight" ? 30 : 100} step={field === "weight" ? "any" : 1} required value={parcel.package[field] || ""}
              onChange={event => patch(index, { package: { ...parcel.package, [field]: Number(event.target.value) } })} />
          </div>)}
          <div className="form-field"><label htmlFor={`reverse-${index}-email`}>E-mail do comprador</label><input id={`reverse-${index}-email`} type="email" required value={parcel.email} onChange={event => patch(index, { email: event.target.value })} /></div>
          <div className="form-field"><label htmlFor={`reverse-${index}-phone`}>Telefone do comprador</label><input id={`reverse-${index}-phone`} type="tel" required value={parcel.phone} onChange={event => patch(index, { phone: event.target.value })} /></div>
        </div>
      </fieldset>)}
      <button type="submit" className="zyn-btn zyn-btn--primary" disabled={busy || !parcels.length}>Consultar custo</button>
    </form> : <>
      <ul>{view.shipments.map(shipment => <li key={shipment.id} style={{ marginBlock: 12 }}><strong>{shipment.originName}</strong>{" · "}
        {shipment.amountCents === null ? "Custo em conferência" : brl(shipment.amountCents)}{" · "}{statuses[shipment.status] ?? "Em conferência"}
        {shipment.postingCode && <div>Código de devolução: <strong>{shipment.postingCode}</strong></div>}
        {shipment.declarationUrl && <a href={shipment.declarationUrl} target="_blank" rel="noopener noreferrer">Baixar declaração de conteúdo — {shipment.originName}</a>}
      </li>)}</ul>
      {allGenerated ? <>
        <p>O comprador informa o código da loja correspondente em uma agência dos Correios em até 7 dias da geração. Não precisa imprimir etiqueta, mas deve levar a declaração de conteúdo impressa com o pacote.</p>
        <p>O código e as declarações disponíveis ficam registrados na conversa do comprador. A declaração deve ser impressa antes da postagem.</p>
        {view.shipments.some(s => !s.declarationUrl) && <><p>A declaração ainda está em preparação no Melhor Envio. Aguarde o documento antes de orientar a postagem.</p><button type="button" className="zyn-btn zyn-btn--ghost" disabled={busy} onClick={() => void onConfirm()}>Conferir declaração</button></>}
        <a href="https://melhorenvio.com.br/painel" target="_blank" rel="noopener noreferrer">Abrir Melhor Envio para baixar a DC-e</a>
      </> : <>
        {costKnown && <p>Frete de volta: <strong>{brl(view.amountCents)}</strong>. A compra usa a conta Melhor Envio de cada loja. Este valor é separado do estorno ao comprador.</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {costKnown && <button type="button" className="zyn-btn zyn-btn--primary" disabled={busy} onClick={() => void onConfirm()}>
            {view.shipments.some(s => s.status === "reverse_cart_ready") ? "Comprar frete e gerar códigos" : "Conferir emissão"}</button>}
          <button type="button" className="zyn-btn zyn-btn--ghost" disabled={busy} onClick={onRefresh}>Atualizar estado</button>
        </div>
      </>}
    </>}
  </section>;
}
