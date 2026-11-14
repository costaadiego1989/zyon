import { useState } from "react";
import type { TenantOrder } from "../../../api/types.js";
import { Button } from "../../../components/Button.js";
import { FormField, FormSelect } from "../../../components/FormField.js";
import { useApi } from "../../../hooks/useApi.js";
import { STAGE_LABELS, TYPE_LABELS, UNIT_LABELS } from "../fulfillment-board.js";

export function OrderFulfillments({ order, busy, execute }: { order: TenantOrder; busy: boolean; execute: (unitId: string, action: string, proof?: string, quantity?: number, slotId?: string) => Promise<boolean> }) {
  const api = useApi();
  const [slots, setSlots] = useState<Array<{ value: string; label: string }>>([]);
  const [slotId, setSlotId] = useState("");
  const [slotState, setSlotState] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ unitId: string; action: string } | null>(null);
  const [proof, setProof] = useState("");
  const [quantity, setQuantity] = useState("1");
  const summary = order.fulfillment;
  if (!summary?.units.length) return <section className="order-fulfillments"><h3>Atendimentos</h3><p>Este pedido antigo não tem o tipo e a modalidade preservados na compra. Revise os dados antes de atribuir um atendimento.</p></section>;
  return <section className="order-fulfillments" aria-label="Atendimentos do pedido" aria-busy={busy}>
    <div className="order-fulfillments__heading"><h3>Atendimentos</h3><span>{STAGE_LABELS[summary.stage]}</span></div>
    <p className="order-detail__hint">{summary.completedQuantity} de {summary.totalQuantity} unidades concluídas. Cada item mantém sua própria etapa.</p>
    {summary.units.map(unit => <div className="order-fulfillments__item" key={unit.id}>
      <div className="order-fulfillments__heading"><strong>{unit.name}</strong><span>{UNIT_LABELS[unit.status] ?? unit.status}</span></div>
      <p className="order-fulfillments__meta">{TYPE_LABELS[unit.productType]} · {unit.completedQuantity} de {unit.quantity} unidades{unit.strategy === "pickup" ? " · Retirada na loja" : unit.strategy === "local_delivery" ? " · Entrega própria" : ""}</p>
      {unit.schedule && <p>Horário escolhido: {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: unit.schedule.timeZone }).format(new Date(unit.schedule.startsAt))} · {unit.schedule.durationMinutes} min · {unit.schedule.timeZone}</p>}
      {unit.selectedOptions.length > 0 && <ul className="order-fulfillments__options">{unit.selectedOptions.map((option, index) => <li key={index}>{option.group_name}: {option.item_name}{option.price_modifier ? ` (${new Intl.NumberFormat("pt-BR", { style: "currency", currency: order.currency }).format(option.price_modifier)})` : ""}</li>)}</ul>}
      {unit.attention && <p className="order-fulfillments__attention" role="status">{unit.attention === "service_no_show" ? "Ausência registrada. Reagende o atendimento ou resolva a compra pelo fluxo de cancelamento e devolução." : unit.attention === "service_capacity_unavailable" ? "O horário escolhido já tem uma reserva. Reagende para um horário disponível." : "A disponibilização requer atenção. Confira os acessos e os canais de envio abaixo."}</p>}
      {unit.blockedReason && <p className="order-detail__hint">{unit.blockedReason}</p>}
      <div className="order-detail__actions">{unit.allowedActions.map(action => <Button key={action.action} variant="outline" size="sm" disabled={busy} onClick={async () => {
        if (action.requiresProof) { setSelected({ unitId: unit.id, action: action.action }); setProof(""); setQuantity(String(unit.quantity - unit.completedQuantity)); }
        else void execute(unit.id, action.action);
        if (action.action === "reschedule_service") {
          setSlots([]); setSlotId(""); setSlotState("Consultando horários disponíveis...");
          try {
            const response = await api.getServiceFulfillmentSlots(order.id, unit.id);
            const available = response.slots.filter(slot => slot.selectable).map(slot => ({ value: slot.slotId, label: new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: slot.timeZone }).format(new Date(slot.startsAt)) }));
            setSlots(available); setSlotState(available.length ? null : "Não há horários disponíveis. Atualize a agenda do produto para reagendar.");
          } catch { setSlotState("Não foi possível consultar a agenda. Abra o reagendamento novamente para tentar."); }
        }
      }}>{action.label}</Button>)}</div>
      {selected?.unitId === unit.id && <form className="order-fulfillments__proof" onSubmit={async event => { event.preventDefault(); if (proof.trim().length < 3) return; if (await execute(unit.id, selected.action, proof.trim(), ["no_show", "reschedule_service"].includes(selected.action) ? undefined : Number(quantity), selected.action === "reschedule_service" ? slotId : undefined)) setSelected(null); }}>
        {selected.action === "reschedule_service" && <><FormSelect label="Novo horário" value={slotId} onChange={setSlotId} disabled={busy || !slots.length} options={[{ value: "", label: "Selecione um horário" }, ...slots]} />{slotState && <p role="status">{slotState}</p>}</>}
        <FormField label={unit.productType === "service" ? "Registro do atendimento" : "Responsável pelo recebimento ou comprovante"} value={proof} onChange={setProof} disabled={busy} autoFocus placeholder={unit.productType === "service" ? "Ex.: atendimento realizado por Ana" : "Ex.: recebido por João, protocolo 123"} />
        {unit.quantity - unit.completedQuantity > 1 && <FormField label="Quantidade atendida" type="number" value={quantity} onChange={setQuantity} disabled={busy} />}
        <div className="order-detail__actions"><Button type="submit" disabled={busy || proof.trim().length < 3 || selected.action === "reschedule_service" && !slotId || !Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > unit.quantity - unit.completedQuantity}>Confirmar registro</Button><Button variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Voltar</Button></div>
      </form>}
    </div>)}
  </section>;
}
