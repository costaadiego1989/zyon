import { z } from "zod";

const ref = z.string().min(1).max(191).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
const cents = z.number().int().min(0).max(2_147_483_647);
export const shippingReferenceHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const shippingReferenceCepSchema = z.string().regex(/^\d{5}-?\d{3}$/).refine(value => !/^0{5}-?0{3}$/.test(value))
  .transform(value => value.replace("-", ""));
export const storefrontShippingReferenceScopeSchema = z.strictObject({ merchantId: ref, cartId: ref, conversationId: ref, buyerId: ref.optional() });
export const storefrontShippingReferenceRequestSchema = z.strictObject({ zipCode: shippingReferenceCepSchema, productId: ref.optional() });
export const shippingReferenceReasonSchema = z.enum(["shipping_reference_unavailable", "cart_required", "cart_empty", "cart_checkout_bound",
  "cart_review_required", "product_selection_required", "address_required", "address_ambiguous", "dimensions_required", "origin_required",
  "carrier_unavailable", "coverage_unavailable", "origin_address_configuration_required", "source_changed", "invalid_destination"]);
export type ShippingReferenceReason = z.infer<typeof shippingReferenceReasonSchema>;
const option = z.strictObject({ carrier: z.string().min(1).max(300), name: z.string().min(1).max(300), price: cents,
  days: z.number().int().min(0).max(3650), zipCode: z.string().regex(/^\d{8}$/),
  estimatedValue: z.number().int().positive().optional(), estimatedUnit: z.enum(["minutes", "days"]).optional() });
export const storefrontShippingReferenceResultSchema = z.strictObject({ referenceOnly: z.literal(true), options: z.array(option).max(100),
  reason: shippingReferenceReasonSchema.optional(), message: z.string().min(1).max(500).optional(),
  reference: z.strictObject({ id: z.uuid(), expiresAt: z.iso.datetime({ offset: true }), basisHash: shippingReferenceHashSchema,
    configurationHash: shippingReferenceHashSchema, destinationZip: z.string().regex(/^\d{8}$/),
    addressSource: z.enum(["saved_buyer_address", "requested_cep"]) }).optional(),
}).superRefine((result, ctx) => {
  if (result.options.length ? !result.reference || result.reason !== undefined : !result.reason || result.reference !== undefined)
    ctx.addIssue({ code: "custom", message: "shipping_reference_result_invalid" });
});
export type StorefrontShippingReferenceResult = z.infer<typeof storefrontShippingReferenceResultSchema>;
export type StorefrontShippingReferenceScope = z.infer<typeof storefrontShippingReferenceScopeSchema>;
export type StorefrontShippingReferenceRequest = z.infer<typeof storefrontShippingReferenceRequestSchema>;
export const storefrontShippingReferenceAuthoritySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ready"), basisHash: shippingReferenceHashSchema, configurationHash: shippingReferenceHashSchema,
    cartTotalCents: cents, originZip: z.string().max(8), destinationZip: z.string().regex(/^\d{8}$/),
    destinationNeighborhood: z.string().min(1).max(120).optional(), destinationCity: z.string().min(1).max(191).optional(),
    destinationState: z.string().length(2).optional(), addressSource: z.enum(["saved_buyer_address", "requested_cep"]),
    mode: z.enum(["flat", "neighborhood", "radius", "carrier"]),
    carrierEnabled: z.boolean().optional(),
    packages: z.array(z.strictObject({ weightKg: z.number().finite().positive(), heightCm: z.number().finite().positive(),
      widthCm: z.number().finite().positive(), lengthCm: z.number().finite().positive(), quantity: z.number().int().min(1).max(99) })).min(1).max(200).optional(),
    items: z.array(z.strictObject({ sku: ref, quantity: z.number().int().min(1).max(99) })).min(1).max(200) }),
  z.strictObject({ kind: z.literal("unavailable"), reason: shippingReferenceReasonSchema }),
]);

export function shippingReferenceUnavailable(reason: ShippingReferenceReason): StorefrontShippingReferenceResult {
  const address = reason === "address_required" || reason === "address_ambiguous";
  return { referenceOnly: true, options: [], reason, message: address
    ? "Confirme seu endereço no formulário da compra para consultar a entrega desse bairro."
    : reason === "origin_address_configuration_required" ? "A loja precisa configurar o endereço da origem da entrega antes de confirmar a cobertura por bairro."
    : reason === "product_selection_required" ? "Escolha a variação e os adicionais no detalhe do produto antes de consultar o frete."
    : "Não consegui confirmar uma cotação atual para este carrinho. Confira o endereço e a entrega na compra." };
}
