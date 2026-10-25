import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { evaluateShippingOffer } from "@zyon/shipping-engine";
import type { Cart, MerchantRules, ShippingQuote } from "@zyon/shared-types";
import { EvaluateShippingInputSchema } from "../schemas.js";

/**
 * Registers `aacp_evaluate_shipping` on the given McpServer.
 *
 * Wraps @zyon/shipping-engine's evaluateShippingOffer. Requires a pre-quoted
 * shipping payload (or none — in which case the engine will reject the
 * request with shipping_quote_missing). The tool returns either an approved
 * shipping offer (with subsidy details) or a blocked decision with reason.
 */
export function registerEvaluateShipping(server: McpServer): void {
  server.tool(
    "aacp_evaluate_shipping",
    "Evaluate whether shipping should be subsidized (free or discounted) based on merchant rules, cart value, abandonment score, and shipping quote. Returns approved offer or blocked decision with reason.",
    EvaluateShippingInputSchema.shape,
    async (input) => {
      const cart: Cart = {
        currency: "BRL",
        total: input.cartTotal,
        items: input.items.map((i) => ({
          sku: i.sku,
          name: i.sku,
          price: 0,
          quantity: i.quantity,
          weightGrams: i.weightGrams
        })),
        currentDiscount: input.currentDiscount
      };

      const shipping: ShippingQuote | undefined = input.shipping
        ? {
            customerPrice: input.shipping.customerPrice,
            realCost: input.shipping.realCost,
            carrier: input.shipping.carrier,
            method: input.shipping.method,
            deliveryDays: input.shipping.deliveryDays,
            region: input.shipping.region
          }
        : undefined;

      const rules: MerchantRules = {
        maxDiscountPercent: 10,
        minimumMarginPercent: 38,
        allowFreeShipping: input.allowFreeShipping ?? true,
        allowShippingDiscount: input.allowShippingDiscount ?? true,
        allowBonusItem: false,
        allowStackDiscountAndFreeShipping: input.allowStackDiscountAndFreeShipping ?? false,
        freeShippingMinCartValue: input.freeShippingMinCartValue ?? 250,
        maxShippingSubsidy: input.maxShippingSubsidy ?? 45,
        maxPartialShippingDiscount: input.maxPartialShippingDiscount ?? 20,
        offerExpirationMinutes: 15,
        blockedRegions: input.blockedRegions ?? [],
        brandVoice: "consultative",
        couponBoxEnabled: true,
        autonomousEngineEnabled: true
      };

      const evaluation = evaluateShippingOffer({
        cart,
        shipping,
        rules,
        abandonmentScore: input.abandonmentScore
      });

      const output = {
        options: [
          {
            id: "default",
            carrier: shipping?.carrier ?? "unknown",
            method: shipping?.method ?? "standard",
            costCents: Math.round((shipping?.customerPrice ?? 0) * 100),
            estimatedDays: shipping?.deliveryDays ?? 0,
            subsidized: evaluation.approved,
            subsidyType: evaluation.approved ? evaluation.type : null,
            subsidyValue: evaluation.approved ? evaluation.value : 0
          }
        ],
        approved: evaluation.approved,
        reason: evaluation.reason,
        marginAfterOfferPercent: Number((evaluation.marginAfterOffer * 100).toFixed(2))
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output) }]
      };
    }
  );
}
