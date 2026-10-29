import { z } from "zod";

const states = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
const addressObject = z.unknown().transform((value, ctx) => {
  try {
    if (value !== null && typeof value === "object" && !Array.isArray(value)
      && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Object.values(descriptors).every(field => "value" in field))
        return Object.fromEntries(Object.entries(descriptors).filter(([, field]) => field.enumerable).map(([key, field]) => [key, field.value]));
    }
  } catch { /* Caller accessors/proxies must not expose their exception. */ }
  ctx.addIssue({ code: "custom", message: "checkout_address_invalid" });
  return z.NEVER;
});
const text = (max: number, empty = false) => z.string().refine(value => !/[\u0000-\u001f\u007f]/.test(value))
  .transform(value => value.trim()).pipe(z.string().min(empty ? 0 : 1).max(max));

/** Existing explicit checkout form normalization. Passing this schema means
 * buyer-supplied address shape only, NOT geocoding, delivery or identity proof.
 * Keep marketplace compatibility: omitted/null complement becomes empty. */
export const checkoutExplicitAddressSchema = addressObject.pipe(z.strictObject({
  zip: text(9).refine(value => /^\d{5}-?\d{3}$/.test(value) && !/^0{5}-?0{3}$/.test(value))
    .transform(value => value.replace("-", "")),
  street: text(200), number: text(32),
  complement: z.preprocess(value => value ?? "", text(160, true)),
  neighborhood: text(120), city: text(120), state: text(2).transform(value => value.toUpperCase()).refine(value => states.has(value)),
}));

/** Existing explicit-address form prerequisite, not a claim of verified email
 * or complete buyer identity. Only checks the already stored contact fields. */
export const checkoutAddressRegistrationSchema = z.object({
  fullName: z.string().trim().min(1), email: z.string().trim().min(1),
  cpf: z.string().transform(value => value.replace(/\D/g, "")).pipe(z.string().length(11)),
  phone: z.string().transform(value => value.replace(/\D/g, "")).pipe(z.string().min(1)),
}).passthrough();
