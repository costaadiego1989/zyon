import { z } from "zod";
import { widgetCrossSellCheckoutQuoteSchema } from "./widget-cross-sell-checkout-quote.schemas.js";
import { storefrontOptionItemIdsSchema } from "../../../storefront/domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { checkoutExplicitAddressSchema } from "../../../checkout/domain/services/checkout-explicit-address.schema.js";

const id = widgetCrossSellCheckoutQuoteSchema.shape.merchantId;
export const widgetCrossSellCheckoutScopeSchema = z.strictObject({ merchantId: id, sessionId: id });
export const widgetCrossSellCheckoutQuoteRequestSchema = z.strictObject({ suggestionId: id, variantId: id,
  quantity: z.number().int().min(1).max(99), selectedOptionItemIds: storefrontOptionItemIdsSchema.optional() });
export const widgetCrossSellCheckoutAcceptanceSchema = z.strictObject({ expectedQuote: widgetCrossSellCheckoutQuoteSchema });
export const widgetCrossSellCheckoutAcknowledgementSchema = widgetCrossSellCheckoutScopeSchema.extend({
  version: z.literal(1), status: z.literal("accepted"), suggestionId: id,
  persistenceVersion: z.number().int().min(1).max(2_147_483_647), eventId: id,
});
export const widgetCrossSellCheckoutCustomerCommandSchema = z.strictObject({
  expectedVersion: z.number().int().min(1).max(2_147_483_646),
  customer: z.strictObject({ fullName: z.string().trim().min(1).max(200),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    cpf: z.string().trim().max(20).transform(value => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{11}$/)),
    phone: z.string().trim().max(30).transform(value => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{10,13}$/)),
  }),
});
export const widgetCrossSellCheckoutCustomerAcknowledgementSchema = widgetCrossSellCheckoutScopeSchema.extend({
  version: z.literal(1), status: z.literal("updated"), persistenceVersion: z.number().int().min(2).max(2_147_483_647),
});
export const widgetCrossSellCheckoutAddressCommandSchema = z.strictObject({
  expectedVersion: z.number().int().min(1).max(2_147_483_646), address: checkoutExplicitAddressSchema,
});
export const widgetCrossSellCheckoutEmailOtpCommandSchema = z.strictObject({
  expectedVersion: z.number().int().min(1).max(2_147_483_646), code: z.string().regex(/^\d{6}$/),
});
export const widgetCrossSellCheckoutManualShippingCommandSchema = z.strictObject({
  expectedVersion: z.number().int().min(1).max(2_147_483_646),
});
export const widgetCrossSellCheckoutManualShippingSelectionSchema = widgetCrossSellCheckoutManualShippingCommandSchema.extend({
  quoteId: z.uuidv4(), carrierKey: z.string().min(1).max(300),
});
/** Storage-private provenance, not a public Cart field or a bearer capability.
 * Never activate the writer before generic writes/read/payment parity exists. */
export const widgetCrossSellCheckoutReceiptSchema = z.strictObject({ version: z.literal(1), origin: z.literal("widget_checkout"),
  eventId: id, committedVersion: z.number().int().min(1).max(2_147_483_647), acceptedAt: z.iso.datetime({ offset: true }),
  quote: widgetCrossSellCheckoutQuoteSchema,
  revision: z.strictObject({ eventId: id, previousEventId: id, persistenceVersion: z.number().int().min(2).max(2_147_483_647),
    revisedAt: z.iso.datetime({ offset: true }), contextHash: z.string().regex(/^[a-f0-9]{64}$/),
    operation: z.enum(["customer", "address", "email_otp", "email_otp_issue", "manual_shipping_quote", "manual_shipping_select",
      "provider_shipping_begin", "provider_shipping_complete", "provider_shipping_unknown"]).optional(),
    providerRequestId: z.uuidv4().optional(),
    providerSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).optional(),
}).refine(value => value.committedVersion === value.quote.persistenceVersion + 1)
  .refine(value => !value.revision || value.revision.persistenceVersion > value.committedVersion
    && value.revision.eventId !== value.eventId && value.revision.eventId !== value.revision.previousEventId
    && (value.revision.persistenceVersion === value.committedVersion + 1
      ? value.revision.previousEventId === value.eventId : value.revision.previousEventId !== value.eventId)
    && Date.parse(value.revision.revisedAt) >= Date.parse(value.acceptedAt))
  .refine(value => {
    const provider = ["provider_shipping_begin", "provider_shipping_complete", "provider_shipping_unknown"].includes(value.revision?.operation ?? "");
    return provider ? value.revision?.providerRequestId !== undefined && value.revision.providerSnapshotHash !== undefined
      : value.revision?.providerRequestId === undefined && value.revision?.providerSnapshotHash === undefined;
  }, { message: "widget_checkout_provider_revision_request_invalid" });
export type WidgetCrossSellCheckoutScope = z.infer<typeof widgetCrossSellCheckoutScopeSchema>;
export type WidgetCrossSellCheckoutQuoteRequest = z.infer<typeof widgetCrossSellCheckoutQuoteRequestSchema>;
export type WidgetCrossSellCheckoutAcceptance = z.infer<typeof widgetCrossSellCheckoutAcceptanceSchema>;
export type WidgetCrossSellCheckoutAcknowledgement = z.infer<typeof widgetCrossSellCheckoutAcknowledgementSchema>;
export type WidgetCrossSellCheckoutCustomerCommand = z.infer<typeof widgetCrossSellCheckoutCustomerCommandSchema>;
export type WidgetCrossSellCheckoutCustomerAcknowledgement = z.infer<typeof widgetCrossSellCheckoutCustomerAcknowledgementSchema>;
export type WidgetCrossSellCheckoutAddressCommand = z.infer<typeof widgetCrossSellCheckoutAddressCommandSchema>;
export type WidgetCrossSellCheckoutEmailOtpCommand = z.infer<typeof widgetCrossSellCheckoutEmailOtpCommandSchema>;
export type WidgetCrossSellCheckoutManualShippingCommand = z.infer<typeof widgetCrossSellCheckoutManualShippingCommandSchema>;
export type WidgetCrossSellCheckoutManualShippingSelection = z.infer<typeof widgetCrossSellCheckoutManualShippingSelectionSchema>;
