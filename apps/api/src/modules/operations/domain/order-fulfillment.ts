import type { CartItem, CompletedOrderLineItem } from "@zyon/shared-types";
import type { FulfillmentAllowedAction, FulfillmentStrategy, OrderFulfillmentSummary, OrderFulfillmentUnit } from "@zyon/shared-types";

export interface FulfillmentState { schemaVersion: 1; units: OrderFulfillmentUnit[] }
const completed = new Set(["delivered", "collected", "completed", "available"]);
const initial = new Set(["received", "pending", "awaiting_confirmation"]);
export function fulfillmentStrategy(type: string, metadata?: unknown, scheduled = false): FulfillmentStrategy {
  const requested = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).fulfillmentStrategy : undefined;
  if (type === "digital") return "digital";
  if (type === "service") return scheduled ? "scheduled_service" : "service";
  if (requested === "pickup" || requested === "local_delivery") return requested;
  return "carrier";
}
export function snapshotOrderLines(items: CartItem[]): CompletedOrderLineItem[] {
  return items.map((item, index) => ({
    lineId: `line_${index + 1}`, snapshotVersion: 2, sku: item.sku, variantId: item.variantId ?? item.sku,
    name: item.name, unitPriceCents: Math.round(item.price * 100), quantity: item.quantity,
    ...(item.productType ? { productType: item.productType } : {}),
    fulfillmentStrategy: item.fulfillmentStrategy ?? fulfillmentStrategy(item.productType ?? "", undefined, !!item.fulfillmentSchedule),
    selectedOptions: item.selected_options ?? [],
    ...(item.fulfillmentSchedule ? { schedule: item.fulfillmentSchedule } : {}),
    ...(item.digitalDeliveryChannels ? { requiredChannels: item.digitalDeliveryChannels } : {}),
  }));
}
/** Unknown historical types remain unclassified. Never consult today's catalog. */
export function initialFulfillment(lines: CompletedOrderLineItem[] | undefined): FulfillmentState | undefined {
  if (!lines?.length || lines.some(line => line.snapshotVersion !== 2 || !line.lineId || !line.productType || !line.fulfillmentStrategy)) return undefined;
  return { schemaVersion: 1, units: lines.map(line => ({
    id: line.lineId!, lineId: line.lineId!, sku: line.sku, variantId: line.variantId ?? line.sku, name: line.name ?? line.sku,
    productType: line.productType!, strategy: line.fulfillmentStrategy!, quantity: line.quantity, completedQuantity: 0,
    status: line.productType === "service" && line.schedule ? "awaiting_confirmation" : line.productType === "food" ? "received" : "pending",
    selectedOptions: line.selectedOptions ?? [], ...(line.schedule ? { schedule: line.schedule } : {}),
    ...(line.productType === "digital" ? { requiredChannels: line.requiredChannels ?? ["email"] } : {}),
  })) };
}
export function readFulfillment(raw: unknown): FulfillmentState | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as FulfillmentState;
  if (value.schemaVersion !== 1 || !Array.isArray(value.units) || !value.units.length) return undefined;
  const ids = new Set<string>();
  for (const unit of value.units) {
    if (!unit || typeof unit.id !== "string" || ids.has(unit.id) || typeof unit.name !== "string" || typeof unit.variantId !== "string"
      || !["physical", "digital", "service", "food"].includes(unit.productType)
      || !["carrier", "pickup", "local_delivery", "digital", "scheduled_service", "service"].includes(unit.strategy)
      || !Number.isSafeInteger(unit.quantity) || unit.quantity < 1 || !Number.isSafeInteger(unit.completedQuantity)
      || unit.completedQuantity < 0 || unit.completedQuantity > unit.quantity || !Array.isArray(unit.selectedOptions)
      || typeof unit.status !== "string") return undefined;
    if (unit.productType === "digital" && unit.strategy !== "digital" || unit.productType === "service" && !["service", "scheduled_service"].includes(unit.strategy)
      || ["physical", "food"].includes(unit.productType) && !["carrier", "pickup", "local_delivery"].includes(unit.strategy)) return undefined;
    if (unit.strategy === "scheduled_service" && (!unit.schedule || !Number.isFinite(Date.parse(unit.schedule.startsAt)) || !Number.isFinite(Date.parse(unit.schedule.endsAt)))) return undefined;
    ids.add(unit.id);
  }
  return value;
}
function action(action: string, label: string, targetStatus: string, requiresProof = false): FulfillmentAllowedAction {
  return { action, label, targetStatus, requiresProof, targetStage: completed.has(targetStatus) ? "completed" : "in_progress" };
}
export function actionsForUnit(unit: OrderFulfillmentUnit): FulfillmentAllowedAction[] {
  if (unit.strategy === "digital") return [action("refresh_digital", "Verificar disponibilização", "provisioning")];
  if (completed.has(unit.status) || unit.status === "cancelled") return [];
  if (unit.strategy === "scheduled_service") {
    const reschedule = action("reschedule_service", "Reagendar atendimento", "scheduled", true);
    if (unit.status === "no_show") return [reschedule];
    if (unit.status === "awaiting_confirmation") return [action("confirm_schedule", "Confirmar agendamento", "scheduled"), reschedule];
    if (unit.status === "scheduled") return [action("start_service", "Iniciar atendimento", "in_service"), action("no_show", "Registrar ausência", "no_show", true), reschedule];
    if (unit.status === "in_service") return [action("complete_service", "Concluir atendimento", "completed", true)];
  }
  if (unit.strategy === "service") {
    if (unit.status === "pending") return [action("start_service", "Iniciar serviço", "in_service")];
    if (unit.status === "in_service") return [action("complete_service", "Concluir serviço", "completed", true)];
  }
  if (unit.strategy === "pickup" || unit.strategy === "local_delivery" || unit.strategy === "carrier") {
    if (["pending", "received"].includes(unit.status)) return [action("start_preparation", unit.productType === "food" ? "Iniciar preparo" : "Iniciar preparação", "preparing")];
    if (unit.status === "preparing") return [action("mark_ready", unit.strategy === "pickup" ? "Pronto para retirada" : "Marcar como pronto", "ready")];
    if (unit.status === "ready" && unit.strategy === "pickup") return [action("collect", "Registrar retirada", "collected", true)];
    if (unit.status === "ready" && unit.strategy === "local_delivery") return [action("dispatch_local", "Iniciar entrega", "out_for_delivery")];
    if (unit.status === "out_for_delivery" && unit.strategy === "local_delivery") return [action("deliver_local", "Registrar entrega", "delivered", true)];
  }
  return [];
}
export function summarizeFulfillment(raw: unknown, version: number, eligible: boolean, orderStatus: string, marketplace = false): OrderFulfillmentSummary {
  const state = readFulfillment(raw);
  const cancelled = ["cancelled", "refunded", "returned", "failed"].includes(orderStatus);
  const totalQuantity = state?.units.reduce((sum, unit) => sum + unit.quantity, 0) ?? 0;
  const completedQuantity = state?.units.reduce((sum, unit) => sum + unit.completedQuantity, 0) ?? 0;
  const stage = cancelled ? "cancelled" : !state ? "review" : !eligible ? "awaiting_payment" : completedQuantity === totalQuantity ? "completed"
    : completedQuantity > 0 ? "partial" : state.units.every(unit => initial.has(unit.status)) ? "not_started" : "in_progress";
  return { schemaVersion: 1, version, stage, totalQuantity, completedQuantity,
    units: (state?.units ?? []).map(unit => {
      const blockedReason = cancelled ? "Pedido cancelado ou devolvido." : !eligible ? "Aguardando confirmação do pagamento." : marketplace ? "Este pedido exige comprovação do marketplace." : undefined;
      return { ...unit, allowedActions: blockedReason ? [] : actionsForUnit(unit),
        ...(blockedReason ? { blockedReason } : unit.strategy === "carrier" && ["ready", "shipped"].includes(unit.status) ? { blockedReason: "Postagem e entrega confirmadas pela transportadora." } : {}),
      };
    }) };
}
