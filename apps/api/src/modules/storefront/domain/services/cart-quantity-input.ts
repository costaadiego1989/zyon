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
