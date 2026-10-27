/**
 * SUPP-H4: Extracted smart fallback logic.
 * Keyword-routed fallback when OpenAI is unavailable or returns unsafe content.
 * Moved from inline function to a separate service for testability and extensibility.
 */

const FALLBACK_RULES: Array<{ pattern: RegExp; reply: string }> = [
  {
    pattern: /(frete|entrega|prazo|rastreio|rastreamento)/,
    reply: "Para dúvidas sobre frete e prazo, consulte o rastreamento no e-mail de confirmação do pedido.",
  },
  {
    pattern: /(troca|devolu|reembolso|cancelamento|cancelar)/,
    reply: "Trocas e devoluções podem ser solicitadas em até 7 dias pelo e-mail de atendimento da loja.",
  },
  {
    pattern: /(pagamento|cartão|cartao|pix|boleto|recusado|cobrado)/,
    reply: "Para problemas com pagamento, verifique seu extrato ou entre em contato com o banco emissor.",
  },
  {
    pattern: /(produto|item|estoque|disponível|disponivel|esgotado)/,
    reply: "Para informações sobre disponibilidade de produto, acesse o site da loja.",
  },
  {
    pattern: /(cupom|desconto|promoção|promocao|oferta)/,
    reply: "Cupons são aplicados durante o checkout. Verifique se o código está correto e dentro do prazo de validade.",
  },
  {
    pattern: /(conta|senha|login|acesso|cadastro)/,
    reply: "Para problemas de acesso à conta, use a opção 'Esqueci minha senha' na página de login.",
  },
];

const DEFAULT_FALLBACK = "Entendo sua dúvida. Nossa equipe responde em até 24h — envie um e-mail para o suporte da loja.";

export function smartFallback(text: string): string {
  const t = text.toLowerCase();
  for (const rule of FALLBACK_RULES) {
    if (rule.pattern.test(t)) return rule.reply;
  }
  return DEFAULT_FALLBACK;
}
