import type { CheckoutSession } from "@zyon/shared-types";

export const checkoutTones = ["consultative", "premium", "direct", "friendly", "technical"] as const;
export type CheckoutTone = typeof checkoutTones[number];
export const checkoutTone = (value: unknown): CheckoutTone => checkoutTones.includes(value as CheckoutTone) ? value as CheckoutTone : "consultative";

/** Tone changes presentation only; no invented prices, coverage or benefits. */
export function checkoutCollectionCopy(field: string | undefined, session: CheckoutSession | undefined, tone: unknown, shippingRefresh?: "expired" | "updated"): string | undefined {
  const style = checkoutTone(tone);
  const lead = { consultative: "Vamos cuidar dos dados do seu pedido.", premium: "Vamos preparar seu pedido com atenção aos detalhes.",
    direct: "Falta este dado para continuar.", friendly: "Vamos deixar tudo pronto para você!", technical: "Precisamos deste dado para processar o pedido." }[style];
  switch (field) {
    case "email": return `📧 *E-mail do pedido*\n\n${lead}\nQual é seu e-mail de contato?\n\n_Vamos usá-lo no pagamento e nas atualizações do pedido._`;
    case "nome": return `👤 *Nome do destinatário*\n\n${style === "premium" ? "Como devemos identificar o destinatário?" : style === "direct" ? "Informe seu nome completo." : style === "friendly" ? "Qual é seu nome completo para o pedido? 😊" : "Qual é seu nome completo para o pedido?"}`;
    case "CEP": return `📍 *Endereço de entrega*\n\n${style === "direct" ? "Informe o CEP com 8 dígitos." : "Qual é o CEP da entrega? Com ele, consulto o endereço e as opções de frete."}`;
    case "confirmar endereço": {
      const a = session?.customer?.address;
      const location = [a?.street, a?.neighborhood, a?.city && a?.state ? `${a.city}/${a.state}` : undefined].filter(Boolean).join(" · ");
      return `📍 *Confira o endereço*\n\n${location || "Localizei o endereço pelo CEP."}\n\nEstá correto? Responda *Sim* ou *Não*.`;
    }
    case "número": return `🏠 *Número do imóvel*\n\n${style === "direct" ? "Informe o número." : "Qual é o número do imóvel?"}\nSe houver complemento, envie junto. Exemplo: *96/204*.`;
    case "complemento (ou responda que não tem)": return "🏠 *Complemento da entrega*\n\nTem apartamento, bloco ou outra referência?\nSe não houver, responda *Não tem*.";
    case "frete":
      if (session?.shippingOptions?.length && shippingRefresh) return `🚚 *Entrega do seu pedido*\n\n${shippingRefresh === "expired"
        ? "A cotação de frete anterior expirou. Atualizei os valores e prazos. Confirme uma das opções abaixo para continuar."
        : "A cotação de frete foi atualizada. Confira os valores e prazos e confirme uma das opções abaixo para continuar."}`;
      return session?.shippingOptions?.length
      ? `🚚 *Entrega do seu pedido*\n\n${style === "premium" ? "Confira as opções disponíveis para seu endereço." : style === "friendly" ? "Encontrei estas opções para sua entrega!" : "Compare os valores e prazos disponíveis abaixo."}\nEscolha como prefere receber.`
      : "🚚 *Consulta de frete*\n\nO endereço está completo, mas a transportadora ainda não retornou uma cotação disponível.\nToque em *Calcular novamente* para consultar de novo.";
    default: return undefined;
  }
}
