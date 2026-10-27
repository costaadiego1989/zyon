import { z } from "zod";

/** Display metadata only: never authorizes a discount or changes amounts. */
export const commercialNoticeSchema = z.strictObject({
  version: z.literal(1),
  code: z.enum(["discount_limit_reached", "discount_limited", "discount_unavailable", "benefit_not_combinable", "benefit_conditions_not_met"]),
  message: z.string().min(1).max(1000).refine(value => value.trim().length > 0),
});
export const commercialNoticesSchema = z.array(commercialNoticeSchema).max(5);

const messages: Readonly<Record<z.infer<typeof commercialNoticeSchema>["code"], string>> = Object.freeze({
  discount_limit_reached: "Você já obteve o desconto máximo permitido por esta loja nos produtos deste pedido. Outros benefícios não aumentam esse desconto.",
  discount_limited: "O desconto foi ajustado às condições permitidas por esta loja.",
  discount_unavailable: "Esta loja não disponibiliza desconto para este pedido.",
  benefit_not_combinable: "Este benefício não pode ser combinado com os benefícios atuais do pedido.",
  benefit_conditions_not_met: "Este benefício não está disponível para as condições atuais do carrinho.",
});
export function canonicalCommercialNotice(code: z.infer<typeof commercialNoticeSchema>["code"]): z.infer<typeof commercialNoticeSchema> {
  return commercialNoticeSchema.parse({ version: 1, code, message: Object.hasOwn(messages, code) ? messages[code] : undefined });
}
