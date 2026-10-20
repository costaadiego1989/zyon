import { contextualSearchGroups } from "../../../catalog/domain/services/contextual-product-search.js";
import { productBrowsingAction, salesDiscoveryHistory } from "./sales-discovery.js";

export const normalizeSalesText = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
type History = Array<{ role: "user" | "assistant"; content: string }>;

/** Short answers also belong to the need after an unsuccessful recommendation,
 * not just while the last assistant message happens to end in a question. A new
 * explicit shopping need starts a new scope; navigation/checkout closes it. */
export function salesRecommendationContext(message: string, history: History): string {
  const text = normalizeSalesText(message);
  const prior = salesDiscoveryHistory(history, message).slice(-10);
  const newNeed = /\b(?:quero|preciso|procuro|busco|gostaria)\b/.test(text)
    && !/\b(?:mais barat\w*|outra opc\w*|outro|com perfume|sem perfume)\b/.test(text);
  const family = (value: string) => /\b(cabelo|cabelos|capilar)\b/.test(value) ? "hair"
    : /\b(pele|rosto|facial|oleosidade)\b/.test(value) ? "skin"
    : /\b(tenis|sapato|sneaker|corrida)\b/.test(value) ? "shoe"
    : /\b(camiseta|calca)\b/.test(value) ? "clothing"
    : /\b(notebook|celular)\b/.test(value) ? "electronics" : undefined;
  const priorFamily = prior.filter(item => item.role === "user").map(item => family(normalizeSalesText(item.content))).filter(Boolean).at(-1);
  const currentFamily = family(text) ?? (/\bhidrat\w*\b/.test(text) ? priorFamily === "hair" ? "hair" : "skin" : undefined);
  if (newNeed && (!currentFamily || (!!priorFamily && currentFamily !== priorFamily))) return message;
  let boundary = -1;
  for (let index = prior.length - 1; index >= 0; index--) if (prior[index]!.role === "user"
    && /\b(carrinho|checkout|finalizar|pagar|rastrear|cancelar|catalogo)\b/.test(normalizeSalesText(prior[index]!.content))) { boundary = index; break; }
  let users: History = [];
  let scopeFamily: string | undefined;
  for (const item of prior.slice(boundary + 1).filter(item => item.role === "user" && !productBrowsingAction(item.content))) {
    const nextFamily = family(normalizeSalesText(item.content));
    if (nextFamily && scopeFamily && nextFamily !== scopeFamily) users = [];
    if (nextFamily) scopeFamily = nextFamily;
    users.push(item);
  }
  // Avoid borrowing skincare preferences when a new product family is named.
  if (currentFamily && priorFamily && currentFamily !== priorFamily) return message;
  return [...users.slice(-5).map(item => item.content), message].join(". ");
}

/** A profile is enough to start a grounded catalog lookup. A care objective is
 * optional, not a required second interview after the skin-type answer. */
export function hasCareProfile(context: string): boolean {
  const text = normalizeSalesText(context);
  return /\b(pele|rosto|facial)\b/.test(text) && /\b(oleosa|seca|mista|normal|sensivel|oleosidade)\b/.test(text);
}

export function recommendationIntent(context: string) {
  const text = normalizeSalesText(context).replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ");
  const skin = /\b(pele|rosto|facial)\b/.test(text);
  const profile = skin ? [...text.matchAll(/\b(oleosa|seca|mista|normal|sensivel)\b/g)].at(-1)?.[1] : undefined;
  const anchors: string[] = [];
  if (skin) anchors.push(/\b(rosto|facial)\b/.test(text) ? "facial" : "pele");
  if (/\bhidrat(?:acao|ar|ante|antes)\b/.test(text) && !/\bnao (?:quero |preciso de )?hidrat/.test(text)) anchors.push("hidratação");
  if (/\btenis\b/.test(text)) anchors.push("tênis");
  if (/\b(corrida|correr|running)\b/.test(text)) anchors.push("corrida");
  for (const attribute of text.replace(/\b(?:sem|nao)\s+[\p{L}\p{N}-]+/gu, " ").matchAll(/\b(couro|algodao|vegano|camiseta|calca|notebook|celular)\b/g)) anchors.push(attribute[1]!);
  for (const size of text.matchAll(/\b(?:tamanho|numero|calcado)\s+(\d{1,3})\b/g)) anchors.push(size[1]!);
  const soft: Array<{ pattern: RegExp; label: string; exact: string }> = [];
  if (profile) soft.push({ pattern: /\b(oleosa|seca|mista|normal|sensivel)\b/g, label: `indicação para pele ${profile}`, exact: profile });
  if (skin && /\boleosidade\b/.test(text)) soft.push({ pattern: /\b(?:controle|controlar|oleosidade)\b/g, label: "controle da oleosidade", exact: "controle da oleosidade" });
  for (const color of text.replace(/\b(?:sem|nao)\s+[\p{L}\p{N}-]+/gu, " ").matchAll(/\b(verde|azul|preto|preta|branco|branca|vermelho|vermelha|rosa|amarelo|amarela|roxo|roxa|cinza|bege|marrom)\b/g))
    soft.push({ pattern: new RegExp(`\\b${color[1]}\\b`, "g"), label: `cor ${color[1]}`, exact: color[1]! });
  // Explicit must-haves and medical/allergy contexts are never relaxable.
  const strict = /\b(somente|apenas|obrigatori[oa]|obrigatoriamente|exclusivamente|indispensavel|alerg\w*|dermat\w*)\b/.test(text);
  const negatives = contextualSearchGroups(context).map(group => group[0]!).filter(term => /^(sem|nao) /.test(term));
  return { anchors, soft: [...new Map(soft.map(item => [item.label, item])).values()], strict, negatives, skin,
    hydrationRequired: anchors.includes("hidratação"), profile };
}

export function similarRecommendationQuery(query: string, intent: ReturnType<typeof recommendationIntent>): string | undefined {
  if (intent.strict || !intent.soft.length) return undefined;
  // Protect negative phrases before removing optional attributes ("não verde"
  // must not be transformed into a positive or disappear).
  let related = normalizeSalesText(query);
  const negatives: string[] = [];
  related = related.replace(/\b(?:sem|nao)\s+[\p{L}\p{N}-]+/gu, value => { negatives.push(value); return " "; });
  for (const item of intent.soft) related = related.replace(item.pattern, " ");
  related = `${related} ${negatives.join(" ")}`.replace(/\s+/g, " ").trim();
  const groups = contextualSearchGroups(related);
  // No wildcard, no negatives-only query and no arbitrary catalog fill.
  if (!groups.some(group => !/^(sem|nao) /.test(group[0]!)) || related === normalizeSalesText(query)) return undefined;
  return related;
}

export function similarRecommendationMessage(labels: string[]): string {
  return `Não encontrei exatamente um produto com todas essas características, mas estas opções relacionadas valem a pena conhecer. O catálogo não confirma ${labels.join(" e ")} nestas alternativas; confira as diferenças antes de escolher.`;
}
