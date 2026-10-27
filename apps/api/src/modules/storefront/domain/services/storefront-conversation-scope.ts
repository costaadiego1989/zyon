/** These are application-owned responses, never content supplied by a model,
 * merchant persona, experiment, history, attachment or retrieved document. */
export const STOREFRONT_OUT_OF_SCOPE_MESSAGE = "Posso ajudar com produtos, compras, pedidos e políticas desta loja. Qual dessas informações você procura?";
export const STOREFRONT_SCOPE_CLARIFICATION_MESSAGE = "Você quer ajuda com produtos, pedidos ou atendimento desta loja? Conte um pouco mais para eu ajudar.";

/** Domain is validated separately from intent. Unknown is never an approval.
 * This is a workflow policy, not semantic detection or commercial authority. */
export function isStorefrontDomainAllowed(domain: unknown): boolean {
  return domain === "STORE_COMMERCE" || domain === "STORE_SUPPORT";
}
