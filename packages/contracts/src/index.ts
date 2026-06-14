import { z } from "zod";

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
  fields: ProblemDetailsFieldErrorsSchema.optional(),
  correlation_id: z.string().min(1),
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
