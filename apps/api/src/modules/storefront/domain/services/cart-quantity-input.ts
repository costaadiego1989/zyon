/** Extract only a direct quantity target, never a product-name/price number.
 * This grants no authority and never rounds or substitutes a quantity.
 */
export function explicitCartQuantityTarget(message: string): number | undefined {
  let command = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const prefix = /^(?:por favor[,\s]+|(?:voce\s+)?(?:pode|poderia)\s+(?:por favor\s+)?|(?:eu\s+)?(?:quero|desejo)\s+|(?:eu\s+)?gostaria de\s+)/;
  for (let count = 0; count < 2; count++) command = command.replace(prefix, "");
  if (!/^(?:mude|mudar|altere|alterar|atualize|atualizar|aumente|aumentar|diminua|diminuir)\b/.test(command)
    || !/\bquantidade\b/.test(command) || !/\bcarrinho\b/.test(command)) return undefined;
  const target = command.match(/\bpara\s+(-?\d+(?:[.,]\d+)?)\s*(?:unidades?|itens?|produtos?|pecas?)?[.!?]*$/);
  return target ? Number(target[1]!.replace(",", ".")) : undefined;
}

export function hasFractionalCartQuantity(message: string): boolean {
  const target = explicitCartQuantityTarget(message);
  return target !== undefined && !Number.isInteger(target);
}

export const FRACTIONAL_CART_QUANTITY_MESSAGE = "A quantidade precisa ser um número inteiro de unidades. Informe 1, 2 ou outra quantidade inteira para continuar.";
export const INSUFFICIENT_CART_STOCK_MESSAGE = "O estoque disponível não permite a quantidade solicitada. Informe uma quantidade menor para esse item.";

/** Read-admission grammar only. It grants no mutation and never derives a
 * target from history, a quotation, an attachment or a product-price number. */
export function explicitCartQuantityCommand(message: string): { itemReference: string; quantity: number } | undefined {
  let command = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (/\n|["`“”]|\b(?:nao|nunca|jamais|nem|talvez|depois|antes|caso|se|exemplo|hipotetic\w*|traduza|repita|cite|copie|diga)\b/.test(command)) return undefined;
  const prefix = /^(?:por favor[,\s]+|(?:voce\s+)?(?:pode|poderia)\s+(?:por favor\s+)?|(?:eu\s+)?(?:quero|desejo)\s+|(?:eu\s+)?gostaria de\s+)/;
  for (let count = 0; count < 2; count++) command = command.replace(prefix, "");
  const match = command.match(/^(?:mude|mudar|altere|alterar|atualize|atualizar|aumente|aumentar|diminua|diminuir)\s+(?:a\s+)?quantidade\s+(?:d[oa]\s+)?(.+?)\s+(?:n[oa]|d[oa])\s+(?:(?:meu|minha|seu|sua|o|a)\s+)?carrinho\s+para\s+(-?\d+(?:[.,]\d+)?)\s*(?:unidades?|itens?|produtos?|pecas?)?[.!?]*$/);
  if (!match || !match[1]!.trim() || match[1]!.length > 300) return undefined;
  return { itemReference: match[1]!.trim(), quantity: Number(match[2]!.replace(",", ".")) };
}

export const INVALID_CART_QUANTITY_MESSAGE = "A quantidade precisa ser um número inteiro entre 0 e 99. Informe a quantidade desejada para esse item.";
export const CART_QUANTITY_INSPECTION_UNAVAILABLE = "Não consegui validar esse item e seu estoque agora. Confira o carrinho antes de tentar novamente.";
export const CART_QUANTITY_LINE_REQUIRED = "Há mais de uma linha possível para esse item. Abra o carrinho e escolha a variação ou os adicionais que deseja alterar.";
export const CART_QUANTITY_ITEM_NOT_FOUND = "Não encontrei esse item no seu carrinho. Abra o carrinho e escolha o produto que deseja alterar.";
