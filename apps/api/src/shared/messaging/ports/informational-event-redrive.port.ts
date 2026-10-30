import { z } from "zod";

const identifier = z.string().trim().min(1).max(191).refine(value => !value.includes("\0"));
export const informationalEventRedriveInputSchema = z.strictObject({
  merchantId: identifier,
  eventId: identifier,
  expectedEventType: z.enum(["shipping.quote.created", "shipment.created"]),
  actorId: identifier,
  purpose: z.string().trim().min(10).max(500),
});
export type InformationalEventRedriveInput = z.infer<typeof informationalEventRedriveInputSchema>;
export type InformationalEventRedriveResult = {
  eventId: string;
  outcome: "requeued" | "already_requested" | "already_delivered";
  auditId?: string;
};
export const INFORMATIONAL_EVENT_REDRIVE = Symbol("INFORMATIONAL_EVENT_REDRIVE");
export const INFORMATIONAL_EVENT_AUDIT_HANDLERS = {
  "shipping.quote.created": "shipping.quote-created.audit.v1",
  "shipment.created": "fulfillment.shipment-created.audit.v1",
} as const;

/** Internal operations only. Never grants replay of financial/stock events. */
export interface InformationalEventRedrivePort {
  redrive(input: InformationalEventRedriveInput, registeredHandlerIds: readonly string[]): Promise<InformationalEventRedriveResult>;
}
