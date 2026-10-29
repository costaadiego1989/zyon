/** A direct cart quantity command can be rejected before reading or writing.
 * This recognizes only an explicit fractional target; it grants no authority,
 * rounds no value and does not treat product-name/price decimals as quantities.
 */
export function hasFractionalCartQuantity(message: string): boolean {
  let command = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const prefix = /^(?:por favor[,\s]+|(?:voce\s+)?(?:pode|poderia)\s+(?:por favor\s+)?|(?:eu\s+)?(?:quero|desejo)\s+|(?:eu\s+)?gostaria de\s+)/;
  for (let count = 0; count < 2; count++) command = command.replace(prefix, "");
  if (!/^(?:mude|mudar|altere|alterar|atualize|atualizar|aumente|aumentar|diminua|diminuir)\b/.test(command)
    || !/\bquantidade\b/.test(command) || !/\bcarrinho\b/.test(command)) return false;
  const target = command.match(/\bpara\s+(-?\d+[.,]\d+)\s*(?:unidades?|itens?|produtos?|pecas?)?[.!?]*$/);
  return !!target && !Number.isInteger(Number(target[1]!.replace(",", ".")));
}

export const FRACTIONAL_CART_QUANTITY_MESSAGE = "A quantidade precisa ser um número inteiro de unidades. Informe 1, 2 ou outra quantidade inteira para continuar.";
