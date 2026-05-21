import { z } from "zod";
import type { Cart, CustomerHints, ShippingQuote } from "@aacp/shared-types";
import type { WidgetConfig } from "./widget-types.js";

const cartItemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  price: z.number().finite().nonnegative(),
  cost: z.number().finite().nonnegative().optional(),
  quantity: z.number().int().positive(),
  weightGrams: z.number().finite().nonnegative().optional(),
  imageUrl: z.string().min(1).optional(),
  productUrl: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  variant: z.string().min(1).optional()
});

const cartSchema = z.object({
  currency: z.enum(["BRL", "USD", "EUR"]),
  source: z.enum(["storefront", "checkout", "platform_api", "manual"]).optional(),
  commerceCartRef: z.string().min(1).optional(),
  total: z.number().finite().nonnegative(),
  currentDiscount: z.number().finite().nonnegative().optional(),
  items: z.array(cartItemSchema).default([])
});

const customerHintsSchema: z.ZodType<CustomerHints> = z.object({
    externalCustomerId: z.string().min(1).optional(),
    asaasCustomerId: z.string().min(1).optional(),
    email: z.string().email().optional(),
    email_verified: z.boolean().optional(),
    otp_code: z.string().min(1).optional(),
    phone: z.string().min(5).optional(),
    isReturning: z.boolean().optional(),
    fullName: z.string().min(1).optional(),
    cpf: z.string().min(5).optional(),
    address: z
      .object({
        zip: z.string().min(3).optional(),
        street: z.string().min(1).optional(),
        number: z.string().min(1).optional(),
        complement: z.string().min(1).optional(),
        neighborhood: z.string().min(1).optional(),
        city: z.string().min(1).optional(),
        state: z.string().min(1).optional()
      })
      .optional()
  })
  .strict();

const shippingSchema: z.ZodType<ShippingQuote> = z.object({
    customerPrice: z.number().finite().nonnegative(),
    realCost: z.number().finite().nonnegative().optional(),
    carrier: z.string().min(1).optional(),
    method: z.string().min(1).optional(),
    deliveryDays: z.number().int().nonnegative().optional(),
    destinationZip: z.string().min(3).optional(),
    region: z.string().min(1).optional()
  })
  .strict();

const agentConfigSchema = z.object({
  name: z.string().optional(),
  greeting: z.string().optional(),
  tone: z.string().optional(),
  language: z.string().optional()
});

const copyConfigSchema = z.object({
  headline: z.string().optional(),
  subheadline: z.string().optional(),
  trust_badges: z.array(z.string()).optional(),
  quick_replies: z.array(z.string()).optional()
});

const widgetConfigSchema = z.object({
  mode: z.enum(["legacy", "embed"]),
  embedSessionToken: z.string().min(1).optional(),
  merchantId: z.string().min(1),
  apiBaseUrl: z.string().min(1),
  productApiBaseUrl: z.string().min(1).optional(),
  productSelection: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantity: z.number().int().positive()
      })
    )
    .optional(),
  cart: cartSchema,
  customer: customerHintsSchema.optional(),
  shipping: shippingSchema.optional(),
  uiPresentation: z.enum(["floating", "conversational"]),
  emptyCartRedirectUrl: z.string().or(z.string().url()).optional(),
  agent: agentConfigSchema.optional(),
  copy: copyConfigSchema.optional()
});

export const authCredentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8)
});

export const authRegisterSchema = authCredentialsSchema.extend({
  merchantName: z.string().trim().min(2)
});

export const authResponseSchema = z.object({
  merchant_id: z.string().min(1),
  user_id: z.string().min(1),
  email: z.string().email(),
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive()
});

// Buyer auth returns camelCase { globalUserId, accessToken, tokenType, expiresIn }
export const buyerAuthResponseSchema = z.object({
  globalUserId: z.string().min(1),
  email: z.string().email(),
  accessToken: z.string().min(1),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int().positive()
});

export type BuyerAuthApiResponse = z.infer<typeof buyerAuthResponseSchema>;

// Supports both merchant sessions (merchant_id + user_id) and buyer sessions (global_user_id)
export const globalAuthSessionSchema = z.object({
  merchant_id: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
  global_user_id: z.string().min(1).optional(),
  email: z.string().email(),
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
  merchant_name: z.string().min(1).optional(),
  provider: z.enum(["password", "phone"]).default("password")
});

export type GlobalAuthSession = z.infer<typeof globalAuthSessionSchema>;

const defaultCart: Cart = {
  currency: "BRL",
  source: "storefront",
  total: 0,
  items: []
};

export const DEFAULT_WIDGET_API_BASE_URL = "http://localhost:3009";

export function parseWidgetConfig(input: {
  merchantId: string;
  embedSessionToken?: string;
  apiBaseUrl?: string;
  productApiBaseUrl?: string;
  productSelection?: WidgetConfig["productSelection"];
  cart?: Cart;
  customer?: CustomerHints;
  shipping?: ShippingQuote;
  uiPresentation?: "floating" | "conversational";
  emptyCartRedirectUrl?: string;
  agent?: WidgetConfig["agent"];
  copy?: WidgetConfig["copy"];
}): WidgetConfig {
  const parsed = widgetConfigSchema.safeParse({
    mode: input.embedSessionToken ? "embed" : "legacy",
    embedSessionToken: input.embedSessionToken,
    merchantId: input.merchantId || "mrc_demo",
    apiBaseUrl: input.apiBaseUrl || DEFAULT_WIDGET_API_BASE_URL,
    productApiBaseUrl: input.productApiBaseUrl,
    productSelection: input.productSelection,
    cart: input.cart ?? defaultCart,
    customer: input.customer,
    shipping: input.shipping,
    uiPresentation: input.uiPresentation ?? "floating",
    emptyCartRedirectUrl: input.emptyCartRedirectUrl,
    agent: input.agent,
    copy: input.copy
  });

  if (parsed.success) return parsed.data;

  return {
    mode: input.embedSessionToken ? "embed" : "legacy",
    merchantId: input.merchantId || "mrc_demo",
    ...(input.embedSessionToken ? { embedSessionToken: input.embedSessionToken } : {}),
    apiBaseUrl: input.apiBaseUrl || DEFAULT_WIDGET_API_BASE_URL,
    productApiBaseUrl: input.productApiBaseUrl,
    productSelection: input.productSelection,
    cart: input.cart ?? defaultCart,
    customer: input.customer,
    shipping: input.shipping,
    uiPresentation: input.uiPresentation ?? "floating",
    emptyCartRedirectUrl: input.emptyCartRedirectUrl
  };
}
