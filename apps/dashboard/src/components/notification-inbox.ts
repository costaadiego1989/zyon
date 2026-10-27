export const NOTIFICATION_TYPES = ["ai_strategy_suggestion", "ai_rule_suggestion", "inventory_alert", "plan_expiry", "handoff", "message", "return_requested", "chargeback_opened", "hold_released", "refund_processed", "order_paid"] as const;
export interface NotificationItem {
  id: string;
  type: typeof NOTIFICATION_TYPES[number];
  title: string;
  body?: string;
  createdAt: string;
  hypothesisId?: string;
  ticketId?: string;
  inventoryAlertId?: string;
  inventoryItemId?: string;
  sku?: string;
}
function textField(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
export function mapInboxNotification(value: unknown): NotificationItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!textField(item.id) || !textField(item.title)) return null;
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata as Record<string, unknown> : {};
  return {
    id: item.id as string,
    type: NOTIFICATION_TYPES.includes(item.type as NotificationItem["type"]) ? item.type as NotificationItem["type"] : "message",
    title: item.title as string,
    body: textField(item.body),
    createdAt: textField(item.createdAt) ?? "",
    hypothesisId: textField(metadata.hypothesisId),
    inventoryAlertId: textField(metadata.inventoryAlertId),
    inventoryItemId: textField(metadata.itemId),
    sku: textField(metadata.sku),
  };
}
export function notificationDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Data indisponível";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
