import { AsyncLocalStorage } from "node:async_hooks";

/** Private actual transport descriptor for canonical service submission only.
 * It adds no bearer field to a public DTO or WhatsAppRequestScope. */
export type ServiceNoticeTransportProof = { readonly kind: "session" } | { readonly kind: "template"; readonly template: {
  readonly id: string; readonly revision: number; readonly wabaId: string; readonly language: string; readonly category: string;
  readonly body: string; readonly variableMap: Readonly<Record<string, string>>; readonly contentSid: string;
} };
const serviceTransport = new AsyncLocalStorage<Readonly<ServiceNoticeTransportProof>>();
export function currentServiceNoticeTransport(): Readonly<ServiceNoticeTransportProof> | undefined { return serviceTransport.getStore(); }
export function withServiceNoticeTransport<T>(proof: ServiceNoticeTransportProof, work: () => T): T {
  if (serviceTransport.getStore()) throw new Error("service_transport_context_replace_forbidden");
  const captured = proof.kind === "session" ? Object.freeze({ kind: "session" as const }) : Object.freeze({ kind: "template" as const,
    template: Object.freeze({ ...proof.template, variableMap: Object.freeze({ ...proof.template.variableMap }) }) });
  return serviceTransport.run(captured, work);
}

/**
 * Order notification transport. Accepted means provider acceptance with an ID;
 * delivery is established separately by the authenticated provider receipts.
 */
export const NOTIFICATION_WHATSAPP_SENDER = Symbol("NOTIFICATION_WHATSAPP_SENDER");

export interface NotificationWhatsAppInput {
    merchantId: string;
    orderId: string;
    idempotencyKey?: string;
    type: "order_confirmation" | "order_nonphysical_confirmation" | "order_shipped" | "order_delivered" | "merchant_order_paid" | "order_paid_animation" | "order_shipped_animation";
    toPhone?: string;
    variables?: Record<string, string | number | undefined>;
    freeformText?: string;
    fallbackEmail?: string;
    emailSubject?: string;
}

export type NotificationWhatsAppResult = {
  status: "accepted" | "skipped" | "failed" | "unknown";
  channel: "whatsapp_template" | "whatsapp_session" | "none";
  messageId?: string;
  reason?: string;
};

export interface ServiceNotificationInput {
  merchantId: string;
  appointmentId: string;
  eventId: string;
  deliveryId: string;
  type: "service_appointment_notice";
  part: "text" | "media";
  toPhone: string;
  freeformText: string;
  variables: Record<string, string>;
  mediaUrl?: string;
}

export interface NotificationWhatsAppSender {
  execute(input: NotificationWhatsAppInput): Promise<NotificationWhatsAppResult>;
  /** Internal canonical service submission; no order identity or financial receipt is invented. */
  executeService?(input: ServiceNotificationInput): Promise<NotificationWhatsAppResult>;
}
