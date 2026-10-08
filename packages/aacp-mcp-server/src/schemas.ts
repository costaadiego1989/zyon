import { z } from "zod";

/**
 * Shared cart item schema for tools that accept cart payloads.
 * Mirrors the parts of @zyon/shared-types CartItem we care about.
 */
export const CartItemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  price: z.number().positive(),
  cost: z.number().nonnegative(),
  quantity: z.number().int().positive(),
  weightGrams: z.number().positive().optional(),
  weight_kg: z.number().positive().optional()
});

/**
 * Discount evaluation input. Uses merchant defaults internally; merchantId is
 * retained for multi-tenant scoping and audit trails.
 */
export const EvaluateDiscountInputSchema = z.object({
  merchantId: z.string().min(1),
  cartItems: z.array(CartItemSchema).min(1),
  requestedDiscountPercent: z.number().min(0).max(100),
  maxReaisCap: z.number().positive().optional(),
  // Optional overrides; defaults to safe baseline when absent.
  maxDiscountPercent: z.number().min(0).max(100).optional(),
  minimumMarginPercent: z.number().min(0).max(100).optional()
});

/**
 * Shipping evaluation input. Maps to ShippingEngine.evaluateShippingOffer.
 */
export const EvaluateShippingInputSchema = z.object({
  merchantId: z.string().min(1),
  destinationPostalCode: z.string().min(8).max(9),
  cartTotal: z.number().nonnegative(),
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantity: z.number().int().positive(),
        weightGrams: z.number().positive().optional()
      })
    )
    .min(1),
  shipping: z
    .object({
      customerPrice: z.number().nonnegative(),
      realCost: z.number().nonnegative().optional(),
      carrier: z.string().optional(),
      method: z.string().optional(),
      deliveryDays: z.number().int().nonnegative().optional(),
      region: z.string().optional()
    })
    .optional(),
  abandonmentScore: z.number().min(0).max(1).default(0.8),
  // Optional overrides for merchant rules (defaults to baseline).
  allowFreeShipping: z.boolean().optional(),
  allowShippingDiscount: z.boolean().optional(),
  freeShippingMinCartValue: z.number().nonnegative().optional(),
  maxShippingSubsidy: z.number().nonnegative().optional(),
  maxPartialShippingDiscount: z.number().nonnegative().optional(),
  allowStackDiscountAndFreeShipping: z.boolean().optional(),
  blockedRegions: z.array(z.string()).optional(),
  currentDiscount: z.number().nonnegative().optional()
});

/**
 * Message generation input. Wraps conversation-engine with safety check.
 */
export const GenerateMessageInputSchema = z.object({
  merchantId: z.string().min(1),
  intent: z.enum(["greeting", "objection_discount", "objection_shipping", "cart_recovery"]),
  context: z.object({
    userMessage: z.string().optional(),
    brandVoice: z
      .enum(["consultative", "aggressive", "premium", "young", "technical", "popular"])
      .default("consultative"),
    merchantName: z.string().optional(),
    cartTotal: z.number().nonnegative().optional(),
    currency: z.enum(["BRL", "USD", "EUR"]).default("BRL"),
    authorizedOffer: z
      .object({
        approved: z.boolean(),
        type: z.enum(["discount_percent", "shipping_free", "shipping_discount_fixed", "none"]),
        value: z.number().nonnegative()
      })
      .optional(),
    stage: z.enum(["data_collection", "shipping", "payment", "completed"]).optional(),
    missingFields: z.array(z.string()).optional()
  })
});

/**
 * Catalog search input. Calls AACP API.
 */
export const SearchCatalogInputSchema = z.object({
  merchantId: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).default(10)
});

/**
 * Agent card input. Optional merchantId filter.
 */
export const GetAgentCardInputSchema = z.object({
  merchantId: z.string().optional()
});
