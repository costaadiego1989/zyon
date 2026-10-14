const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const browse = new Set(["*", "", "produto", "produtos", "ver produtos", "catalogo", "todos", "tudo", "all", "listar", "mostrar", "ver tudo"]);
const stop = new Set("eu quero queria preciso gostaria procura procurar busco buscar encontre encontrar mostrar mostre ver comprar compra produto produtos item itens algum alguma algo um uma uns umas o a os as e de da do das dos para pra por com em no na nos nas minha meu minhas meus sua seu suas seus voce voces favor ajuda ajude loja lojas que qual quais tem temos tenho me mim pelo pela porfavor".split(" "));
const aliases: Record<string, string[]> = {
  pele: ["pele", "facial", "rosto", "cutane"],
  hidratar: ["hidrat"], hidratacao: ["hidrat"], hidratante: ["hidrat"], hidratantes: ["hidrat"],
  seca: ["seca", "ressecad"], seco: ["seco", "ressecad"],
  sensivel: ["sensivel", "sensiv"],
};

/** Keep an expressed need when the model issues a generic catalog query.
 * Explicit browse actions have no userMessage and retain the entire catalog. */
export function contextualProductQuery(query?: string, userMessage?: string): string | undefined {
  if (!browse.has(normalize(query ?? ""))) return query;
  return userMessage && contextualSearchGroups(userMessage).length ? userMessage : query;
}

/** Small lexical groups, matched against published product information. Every
 * group must match; zero matches never broadens into an unrelated catalog.
 * Preserve negated phrases rather than recommending their opposite. */
export function contextualSearchGroups(query: string): string[][] {
  let text = normalize(query).replace(/[^\p{L}\p{N}\s-]/gu, " ");
  const phrases: string[][] = [];
  text = text.replace(/\b(sem|nao)\s+([\p{L}\p{N}-]+)/gu, match => {
    phrases.push([match]); return " ";
  });
  const terms = [...new Set(text.split(/\s+/).filter(term => term.length > 1 && !stop.has(term) && !browse.has(term)))];
  return [...phrases, ...terms.map(term => aliases[term] ?? [term])].slice(0, 12);
}
