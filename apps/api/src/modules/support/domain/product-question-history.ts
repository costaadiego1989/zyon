import { z } from "zod";

const id = z.string().trim().min(1).max(191);
export const productQuestionIntakeSchema = z.strictObject({
  productId: id, buyerId: id, sessionId: id, questionText: z.string().trim().min(1).max(4000),
});
export const productQuestionMessageMetadataSchema = productQuestionIntakeSchema.extend({
  kind: z.literal("product_question"), schemaVersion: z.literal(1), merchantId: id, ticketId: id, questionMessageId: id,
});
export type ProductQuestionMessageMetadata = z.infer<typeof productQuestionMessageMetadataSchema>;
export interface BuyerProductQuestion {
  id: string;
  ticketId: string;
  question: string;
  date: string;
  answerState: "not_linked";
}
