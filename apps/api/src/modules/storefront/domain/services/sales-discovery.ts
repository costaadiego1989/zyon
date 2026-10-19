const genericShoppingWords = new Set(
  "oi ola bom boa dia tarde noite eu quero queria gostaria desejo preciso estou querendo a o as os de da do para pra por favor um uma uns umas algum alguma alguns algumas algo coisa coisas produto produtos item itens comprar compra levar adquirir escolher escolha encontrar procurar buscar ajuda ajudar ajude me voce voces indicacao recomendacao indique recomende aqui loja nessa nesta".split(" "),
);

/** Only object-free shopping requests. Catalog navigation and any concrete need,
 * product, budget, variant or deictic reference must retain their normal route. */
export function isUnspecifiedShoppingRequest(message: string): boolean {
  const words = message.replace(/\[(?:variantId|optionItemIds|crossSellPromoId|serviceSlotId):[^\]]*\]/gi, "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/);
  return words.some(word => /^(quero|queria|gostaria|desejo|preciso|comprar|escolher|encontrar|indique|recomende)$/.test(word))
    && words.some(word => /^(comprar|adquirir|levar|escolher|produto|produtos|item|itens|algo|coisa|indicacao|recomendacao)$/.test(word))
    && words.every(word => genericShoppingWords.has(word));
}
