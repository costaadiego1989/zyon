/** Count only the products returned by this scoped read. Keep every filter and
 * caveat after the count, and never turn a result page into an inventory total. */
export function catalogResultCopy(message: string, count: number): string {
  if (!Number.isSafeInteger(count) || count < 1) return message;
  return message.replace(/(?:Encontrei|Achei|Separei|Temos|Tenho|Há)\s+(?:\d+|tr[eê]s|dez)\s+(?:produtos?|op[cç][aã]o|op[cç][oõ]es)(?:\s+dispon[ií]ve(?:l|is))?(?:\s+nesta (?:p[aá]gina|busca))?(?:\s+no cat[aá]logo da loja)?/gi,
    `Separei ${count} ${count === 1 ? "opção" : "opções"} nesta busca`);
}
