/** Cache-only public DTO boundary. It never returns delivery.response,
 * provider account/credentials, original authority, attempt or inbox lease. */
export type ConversationDeliveryStatus = "queued" | "accepted" | "delivered" | "read" | "failed" | "unknown";
export interface ConversationMessageDto {
  id: string; ticketId: string; senderType: "buyer" | "merchant" | "system"; content: string; createdAt: string;
  clientMessageId?: string; origin?: "text" | "button" | "voice" | "media";
  delivery?: { status: ConversationDeliveryStatus; revision: number };
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const statuses = new Set<unknown>(["queued", "accepted", "delivered", "read", "failed", "unknown"]);
export function publicConversationMessage(raw: { id: string; ticketId: string; senderType: string; content: string; createdAt: Date; metadata?: unknown }, ticketId: string): ConversationMessageDto {
  if (raw.ticketId !== ticketId || typeof raw.id !== "string" || !raw.id || !["buyer", "merchant", "system"].includes(raw.senderType)
    || typeof raw.content !== "string" || !(raw.createdAt instanceof Date) || !Number.isFinite(raw.createdAt.getTime())) throw new Error("invalid_whatsapp_message_projection");
  const dto: ConversationMessageDto = { id: raw.id, ticketId, senderType: raw.senderType as ConversationMessageDto["senderType"], content: raw.content, createdAt: raw.createdAt.toISOString() };
  const metadata = object(raw.metadata);
  if (["whatsapp_outgoing", "whatsapp_resume"].includes(String(metadata.kind))) {
    const delivery = object(metadata.delivery);
    if (metadata.schemaVersion !== 1 || !statuses.has(delivery.status) || typeof delivery.revision !== "number" || !Number.isSafeInteger(delivery.revision) || delivery.revision < 0)
      throw new Error("invalid_whatsapp_delivery_projection");
    dto.delivery = { status: delivery.status as ConversationDeliveryStatus, revision: delivery.revision };
    if (metadata.kind === "whatsapp_outgoing") {
      if (typeof metadata.clientMessageId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(metadata.clientMessageId)) throw new Error("invalid_whatsapp_message_projection");
      dto.clientMessageId = metadata.clientMessageId;
    }
  }
  if (["whatsapp_intake", "whatsapp_incoming"].includes(String(metadata.kind)) && ["text", "button", "voice", "media"].includes(String(metadata.origin)))
    dto.origin = metadata.origin as ConversationMessageDto["origin"];
  return dto;
}
