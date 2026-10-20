const genericShoppingWords = new Set(
  "oi ola bom boa dia tarde noite eu quero queria gostaria desejo preciso estou querendo a o as os de da do para pra por favor um uma uns umas algum alguma alguns algumas algo coisa coisas produto produtos item itens comprar compra levar adquirir escolher escolha encontrar procurar buscar ajuda ajudar ajude me voce voces indicacao recomendacao indique recomende aqui loja nessa nesta".split(" "),
);

function shoppingWords(message: string): string[] {
  return message.replace(/\[(?:variantId|optionItemIds|crossSellPromoId|serviceSlotId):[^\]]*\]/gi, "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/);
}

/** Only object-free shopping requests. Catalog navigation and any concrete need,
 * product, budget, variant or deictic reference must retain their normal route. */
export function isUnspecifiedShoppingRequest(message: string): boolean {
  const words = shoppingWords(message);
  return words.some(word => /^(quero|queria|gostaria|desejo|preciso|comprar|escolher|encontrar|indique|recomende)$/.test(word))
    && words.some(word => /^(comprar|adquirir|levar|escolher|produto|produtos|item|itens|algo|coisa|indicacao|recomendacao)$/.test(word))
    && words.every(word => genericShoppingWords.has(word));
}

/** An area alone invites clarification; a known profile can already be searched.
 * Keep this narrow: a name, profile, objective, ingredient or budget exits it.
 * Other verticals can use the model's bounded ask_product_preferences tool. */
export function isBroadShoppingRequest(message: string): boolean {
  const words = shoppingWords(message);
  if (words.some(word => /^(oleosa|seca|mista|normal|sensivel|oleosidade)$/.test(word))) return false;
  const broadCareWords = new Set("minha meu minhas meus pele rosto facial corpo corporal cabelo cabelos capilar oleosa seca mista normal sensivel cuidar cuidado cuidados tratar procuro busco procurando".split(" "));
  return words.some(word => /^(quero|queria|gostaria|preciso|procuro|busco|produto|produtos|algo)$/.test(word))
    && words.some(word => /^(pele|rosto|corpo|cabelo|cabelos)$/.test(word))
    && words.every(word => genericShoppingWords.has(word) || broadCareWords.has(word));
}

export const MAX_SALES_DISCOVERY_ROUNDS = 3;

/** A bare price objection supplies no new target price. Clarify that target
 * instead of paying for repeated searches that return the same products. */
export function isBarePriceObjection(message: string): boolean {
  return /^(?:(?:esta|ta|achei|esta muito|ta muito|achei muito|muito) )?car[oa]s?$/.test(shoppingWords(message).join(" "));
}

export interface SalesDiscoveryQuestion {
  question: string;
  replies: string[];
}

/** Some clients include the current message in history; it is also sent as the
 * separate userMessage. Do not count it twice or evict an earlier preference. */
export function salesDiscoveryHistory(history: Array<{ role: "user" | "assistant"; content: string }>, userMessage: string) {
  return history.at(-1)?.role === "user" && history.at(-1)?.content === userMessage ? history.slice(0, -1) : history;
}

/** Budget consecutive clarification turns from the same history sent to the
 * model. It is not a security/commerce permit. A substantive answer ends the
 * sequence; the initial greeting does not consume a discovery round. */
export function countSalesDiscoveryRounds(history: Array<{ role: "user" | "assistant"; content: string }>): number {
  let rounds = 0;
  const firstUser = history.findIndex(message => message.role === "user");
  if (firstUser < 0) return 0;
  for (let index = history.length - 1; index > firstUser; index--) {
    const message = history[index]!;
    if (message.role !== "assistant") continue;
    // A recommendation often ends in "Quer ver os detalhes?". It closes the
    // interview rather than consuming another profile question. In particular,
    // do not let two profile questions + a priced recommendation exhaust the
    // budget when the buyer later raises a new price objection.
    if (!parseSalesDiscoveryQuestion({ question: message.content, replies: [] })
      || /R\$\s*\d|\b(?:encontrei|separei)\b|quer ver (?:os |mais )?detalhes/i.test(message.content)) break;
    if (++rounds === MAX_SALES_DISCOVERY_ROUNDS) break;
  }
  return rounds;
}

/** Navigation, product actions, checkout and support must never be replaced by
 * an optional sales interview. Object-free/broad buying is the exception. */
export function allowsSalesDiscovery(message: string, attachmentContext?: string): boolean {
  if (attachmentContext) return false;
  if (isUnspecifiedShoppingRequest(message) || isBroadShoppingRequest(message)) return true;
  const text = shoppingWords(message).join(" ");
  if (/\bcomprar\b/.test(text) && /\b(?:produtos? para|tenis de corrida|hidratante para)\b/.test(text)
    && !/\b(carrinho|checkout|pedido|este|esse|aquele|finalizar)\b/.test(text)) return true;
  return !/\b(carrinho|checkout|pedido|pagar|pagamento|frete|cep|cupom|rastrear|troca|devolucao|suporte|humano|login|entrar|detalhes|avaliacoes|comparar|semelhantes|catalogo|categorias|ofertas|promocoes)\b/.test(text)
    && !/\b(comprar|compre|adicionar|adicione|remover|retirar|limpar|finalizar|concluir)\b/.test(text)
    && !/\b(ver|mostrar|mostre|listar|lista|vendem|venda|vender|voces tem|produtos disponiveis|mais opcoes|mais produtos|mais resultados|outras opcoes)\b/.test(text);
}

export function parseSalesDiscoveryQuestion(args: Record<string, unknown>): SalesDiscoveryQuestion | null {
  if (typeof args.question !== "string") return null;
  const question = args.question.trim();
  if (!question || question.length > 500 || (question.match(/\?/g)?.length ?? 0) !== 1 || !question.endsWith("?")
    || /[<>\u0000-\u001f]|\\u[0-9a-f]{4}/i.test(question)) return null;
  const replies: string[] = [];
  if (Array.isArray(args.replies)) for (const value of args.replies) {
    if (typeof value !== "string") continue;
    const reply = value.trim();
    if (!reply || reply.length > 80 || /[<>\[\]{}\u0000-\u001f]|https?:|\\u[0-9a-f]{4}/i.test(reply)
      || !allowsSalesDiscovery(reply) || /\bcompr[ae]|continuar comprando/i.test(reply)
      || replies.some(previous => previous.toLocaleLowerCase() === reply.toLocaleLowerCase())) continue;
    replies.push(reply);
    if (replies.length === 4) break;
  }
  return { question, replies };
}
