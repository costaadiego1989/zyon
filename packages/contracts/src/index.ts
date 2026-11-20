import { z } from "zod";
export * from "./normal-checkout-cross-sell.js";
export * from "./commercial-notice.js";

export const ProblemDetailsFieldErrorsSchema = z.record(
  z.string(),
  z.array(z.string()),
);

export const ProblemDetailsSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  code: z.string().min(1),
  detail: z.string().optional(),
  retry_after_seconds: z.number().int().positive().optional(),
  fields: z.union([ProblemDetailsFieldErrorsSchema, z.array(z.enum(["name", "taxId", "email", "phone", "address.street", "address.number", "address.complement", "address.neighborhood", "address.city", "address.state", "address.postalCode", "address.cityCode", "address.countryCode"])).max(13)]).optional(),
  pending: z.array(z.enum(["authentication", "issuer", "certificate", "permissions", "environment", "stock_policy", "email_policy", "whatsapp_policy"])).max(8).optional(),
  chat_request: z.object({
    message_id: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
    status: z.enum(["processing", "unknown", "completed", "rejected", "reconciled"]),
    next_action: z.literal("refresh_session"),
  }).optional(),
  correlation_id: z.string().min(1),
}).superRefine((value, ctx) => {
  if (Array.isArray(value.fields) && value.code !== "fiscal_customer_data_required") ctx.addIssue({ code: "custom", path: ["fields"], message: "Fiscal correction fields require their scoped error code" });
  if (value.pending && value.code !== "fiscal_connection_not_ready") ctx.addIssue({ code: "custom", path: ["pending"], message: "Readiness checks require their scoped error code" });
});

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export const IdempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const EntityTagSchema = z
  .string()
  .regex(/^(W\/)?\"[A-Za-z0-9_-]+\"$/);

export function CursorPageSchema<TItem extends z.ZodType>(
  itemSchema: TItem,
) {
  return z.object({
    data: z.array(itemSchema),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  });
}

export interface CursorPage<TItem> {
  data: TItem[];
  next_cursor: string | null;
  has_more: boolean;
}

export function cursorPage<TItem>(
  data: TItem[],
  nextCursor: string | null,
): CursorPage<TItem> {
  return {
    data,
    next_cursor: nextCursor,
    has_more: nextCursor !== null,
  };
}
