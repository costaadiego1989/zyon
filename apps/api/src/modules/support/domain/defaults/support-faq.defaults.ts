import type { SupportFaqItem } from "@zyon/shared-types";

/**
 * Default FAQ items used when a merchant has not configured their own
 * support FAQ in the dashboard support hub. Consumed by the storefront
 * agent (get_faq tool) and the checkout widget_v2 support flow so both
 * surfaces answer common buyer questions even before the merchant sets
 * anything up.
 */
export const DEFAULT_SUPPORT_FAQ: SupportFaqItem[] = [
  {
    id: "default_track",
    question: "Como faço para rastrear meu pedido?",
    answer:
      "Acesse 'Meus Pedidos' ou peça ao assistente para rastrear informando o número do pedido.",
  },
  {
    id: "default_delivery",
    question: "Qual o prazo de entrega?",
    answer:
      "De 2 a 10 dias úteis, dependendo da região e da modalidade de envio escolhida no checkout.",
  },
  {
    id: "default_returns",
    question: "Como solicitar troca ou devolução?",
    answer:
      "Entre em contato em até 7 dias após o recebimento do produto. Nossa equipe orienta o processo.",
  },
  {
    id: "default_payment",
    question: "Quais as formas de pagamento?",
    answer: "Cartão de crédito, PIX e boleto bancário.",
  },
  {
    id: "default_installments",
    question: "Posso parcelar a compra?",
    answer: "Sim, em até 12x no cartão de crédito (sujeito às condições da loja).",
  },
];
