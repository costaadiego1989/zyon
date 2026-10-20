const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const browse = new Set(["*", "", "produto", "produtos", "ver produtos", "continuar comprando", "catalogo", "todos", "tudo", "all", "listar", "mostrar", "ver tudo"]);
// Unknown profile data and absence of a preference are not negative product
// attributes. This shared parser also runs in the real tool handler, after the
// sales policy, so filtering them only in that policy is insufficient.
const conversationalNegations = new Set(["nao sei", "nao tenho", "nao importa", "sem preferencia", "sem preferencias", "sem restricao", "sem restricoes"]);
const stop = new Set("eu quero queria preciso gostaria procura procurar busco buscar encontre encontrar mostrar mostre ver comprar compra produto produtos item itens algum alguma algo um uma uns umas o a os as e de da do das dos para pra por com em no na nos nas minha meu minhas meus sua seu suas seus voce voces favor ajuda ajude loja lojas que qual quais tem temos tenho me mim pelo pela porfavor".split(" "));
for (const word of "vende vendem vender venda disponivel disponiveis disponibilidade estoque catalogo catalogos opcao opcoes mostra conhecer saber ai aqui nessa nesta nesse neste oferece oferecem".split(" ")) stop.add(word);
const aliases: Record<string, string[]> = {
  pele: ["pele", "facial", "rosto", "cutane"],
  hidratar: ["hidrat"], hidratacao: ["hidrat"], hidratante: ["hidrat"], hidratantes: ["hidrat"],
  seca: ["seca", "ressecad"], seco: ["seco", "ressecad"],
  sensivel: ["sensivel", "sensiv"],
  cremes: ["creme"], seruns: ["serum"], protetores: ["protetor"],
};

/** Catalog navigation language is not a product attribute. Keep actual needs,
 * product names and negative constraints out of this generic browse path. */
export function isCatalogBrowseQuery(query: string): boolean {
  const text = normalize(query).replace(/[^\p{L}\p{N}\s*-]/gu, " ").replace(/\s+/g, " ").trim();
  return browse.has(text) || /\b(produtos?|catalogos?|vende|vendem|vender|opcoes|oferece|oferecem)\b/.test(text)
    && contextualSearchGroups(text).length === 0;
}

/** Keep an expressed need when the model issues a generic catalog query.
 * Explicit browse actions have no userMessage and retain the entire catalog. */
export function contextualProductQuery(query?: string, userMessage?: string): string | undefined {
  const requested = query != null && isCatalogBrowseQuery(query) ? "*" : query;
  if (!browse.has(normalize(requested ?? ""))) {
    const constraints = userMessage ? contextualSearchGroups(userMessage)
      .map(group => group[0]).filter(term => /^(sem|nao) /.test(term) && !normalize(query ?? "").includes(term)) : [];
    return constraints.length ? `${requested} ${constraints.join(" ")}` : requested;
  }
  return userMessage && contextualSearchGroups(userMessage).length ? userMessage : requested;
}

/** Small lexical groups, matched against published product information. Every
 * group must match; zero matches never broadens into an unrelated catalog.
 * Preserve negated phrases rather than recommending their opposite. */
export function contextualSearchGroups(query: string): string[][] {
  if (browse.has(normalize(query))) return [];
  let text = normalize(query).replace(/[^\p{L}\p{N}\s-]/gu, " ");
  const phrases: string[][] = [];
  text = text.replace(/\b(sem|nao)\s+([\p{L}\p{N}-]+)/gu, match => {
    if (!conversationalNegations.has(match.replace(/\s+/g, " "))) phrases.push([match]);
    return " ";
  });
  const terms = [...new Set(text.split(/\s+/).filter(term => term.length > 1 && !stop.has(term) && !browse.has(term)))];
  return [...phrases, ...terms.map(term => aliases[term] ?? [term])].slice(0, 12);
}
