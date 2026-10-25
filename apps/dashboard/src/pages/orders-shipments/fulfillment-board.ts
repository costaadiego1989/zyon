import type { OrderFulfillmentSummary } from "@zyon/shared-types";
import type { TenantOrder } from "../../api/types.js";
export type OrderView = "all" | "physical" | "service" | "digital" | "food";
export type BoardEntry = { order: TenantOrder; unit?: OrderFulfillmentSummary["units"][number] };
export const TYPE_LABELS: Record<string, string> = { physical: "Físico", service: "Serviço", digital: "Digital", food: "Alimentação" };
export const STAGE_LABELS: Record<string, string> = { awaiting_payment: "Aguardando pagamento", not_started: "A iniciar", in_progress: "Em andamento", partial: "Parcialmente concluído", completed: "Concluído", cancelled: "Cancelado", review: "Revisar cadastro" };
export const UNIT_LABELS: Record<string, string> = { pending: "A iniciar", received: "Recebido", awaiting_confirmation: "A confirmar", scheduled: "Agendado", in_service: "Em atendimento", preparing: "Em preparo", ready: "Pronto", shipped: "Enviado", out_for_delivery: "Em entrega", provisioning: "Disponibilizando", available: "Disponibilizado", delivered: "Entregue", collected: "Retirado", completed: "Concluído", no_show: "Não compareceu" };
export function boardColumns(view: OrderView) {
  const ids = view === "all" ? ["awaiting_payment", "not_started", "in_progress", "partial", "completed", "cancelled", "review"]
    : view === "service" ? ["awaiting_confirmation", "pending", "scheduled", "in_service", "completed", "no_show"]
    : view === "digital" ? ["pending", "provisioning", "available"]
    : view === "food" ? ["received", "preparing", "ready", "out_for_delivery", "shipped", "delivered", "collected"]
    : ["pending", "preparing", "ready", "shipped", "out_for_delivery", "delivered", "collected"];
  return (view === "all" ? ids : ["awaiting_payment", ...ids]).map(id => ({ id, label: UNIT_LABELS[id] ?? STAGE_LABELS[id] ?? id, color: ["completed", "available", "delivered", "collected"].includes(id) ? "var(--color-success)" : ["cancelled", "no_show", "review"].includes(id) ? "var(--color-warning)" : "var(--color-text-secondary)" }));
}
export function boardEntries(orders: TenantOrder[], view: OrderView): BoardEntry[] {
  return view === "all" ? orders.map(order => ({ order })) : orders.flatMap(order => order.fulfillment?.stage === "cancelled" ? [] : (order.fulfillment?.units ?? []).filter(unit => unit.productType === view).map(unit => ({ order, unit })));
}
export function entryColumn(entry: BoardEntry) { return entry.unit && entry.order.fulfillment?.stage === "awaiting_payment" ? "awaiting_payment" : entry.unit?.status ?? entry.order.fulfillment?.stage ?? "review"; }
export function dropAction(entry: BoardEntry, column: string) {
  const unit = entry.unit ?? (entry.order.fulfillment?.units.length === 1 ? entry.order.fulfillment.units[0] : undefined);
  if (!unit || entryColumn(entry) === column) return undefined;
  const action = unit.allowedActions.find(action => !["refresh_digital", "reschedule_service"].includes(action.action) && (entry.unit ? action.targetStatus === column : action.targetStage === column));
  return action ? { unit, action } : undefined;
}
