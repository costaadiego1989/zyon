import type { ShoppingSearchPlan } from "../contracts/shopping-search-plan.schemas.js";
import { contextualSearchGroups } from "../../../catalog/domain/services/contextual-product-search.js";

export const normalizeShoppingFact = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phrase = (value: string) => new RegExp(`(?:^|\\s)${escape(value)}(?=\\s|$)`, "u");

/** A proposal can remove only the declared optional name from the original
 * lexical query. It cannot replace the purpose, add a wildcard, erase an
 * exclusion, or weaken a mandatory attribute. Commercial fields stay intact. */
export function shoppingRecoveryQueries(plan: ShoppingSearchPlan, userMessage = ""): { exact: string; family: string } | undefined {
  if (!plan.recovery) return undefined;
  const source = normalizeShoppingFact(userMessage), original = normalizeShoppingFact(plan.query);
  const strictClauses = [...source.matchAll(/\b(?:somente|apenas|exclusivamente|obrigatoriamente|obrigatorio|obrigatoria|indispensavel)\b([^.!?;]*)/g)]
    .filter(m => !/\bnao(?:\s+(?:e|eh|sera|precisa|ser|deve)){0,4}\s*$/.test(source.slice(0, m.index)))
    .map(m => m[1]!);
  const mandatory = (value: string) => strictClauses.some(clause => phrase(value).test(clause.trim()))
    || new RegExp(`(?:^|\\s)${escape(value)}\\s+(?:(?:e|eh|sera|deve|ser|tem|que|um|uma|requisito|condicao|precisa|modelo|marca)\\s+){0,5}(?:obrigatori[oa]|obrigatoriamente|indispensavel|innegociavel|necessari[oa]|essencial|fundamental)(?=\\s|$)`, "u").test(source)
    || new RegExp(`(?:^|\\s)${escape(value)}\\s+nao\\s+(?:e\\s+)?opcional(?=\\s|$)`, "u").test(source);
  // An extractor mistake cannot turn an explicitly mandatory preference into
  // a relaxable attribute. Current user text can restrict, never grant writes.
  if (plan.attributes.some(a => a.priority === "preferred" && a.operator === "equals"
    && mandatory(normalizeShoppingFact(a.value)))) return undefined;
  let remaining = original;
  const appended: string[] = [];
  const terms = plan.recovery.optionalQueryTerms.map(normalizeShoppingFact);
  if (new Set(terms).size !== terms.length) return undefined;
  for (const term of terms) {
    if (!term || /\b(?:sem|nao|compativel|compatibilidade)\b/.test(term)) return undefined;
    if (!phrase(term).test(remaining)) {
      // Some extractors already put the family in query and keep the optional
      // exact name separately. This is safe only when it is literally present
      // in the current request: narrow the exact read, then retain the original
      // family query. Never infer a missing name from unrelated history.
      if (normalizeShoppingFact(plan.recovery.familyQuery) !== original || !phrase(term).test(source)) return undefined;
      appended.push(term); remaining = `${remaining} ${term}`;
    }
    // A required value remains required even when repeated in the name/query.
    if (plan.attributes.some(a => (a.priority === "required" || a.operator === "not_equals")
      && (phrase(term).test(normalizeShoppingFact(a.value)) || phrase(normalizeShoppingFact(a.value)).test(term)))) return undefined;
    const requiredName = strictClauses.some(clause => /^(?:(?:o|a|os|as|da|do)\s+)?(?:modelo|marca)\b/.test(clause.trim()));
    if (requiredName || mandatory(term)) return undefined;
    // Compatibility is a requirement, not a removable model preference. Keep
    // every term after its marker in either the query or the current request.
    for (const text of [original, source]) {
      const compatibility = /\b(?:compativel|compatibilidade|funciona com|funciona no)\b(.*)/.exec(text)?.[1];
      if (compatibility && phrase(term).test(compatibility.trim())) return undefined;
    }
    // Never turn "sem X" / "não X" into a positive or unspecified query.
    if (new RegExp(`\\b(?:sem|nao)\\s+${escape(term)}\\b`, "u").test(`${remaining} ${source}`)) return undefined;
    remaining = remaining.replace(phrase(term), " ").replace(/\s+/g, " ").trim();
  }
  const family = normalizeShoppingFact(plan.recovery.familyQuery);
  const positive = (query: string) => contextualSearchGroups(query).filter(group => !/^(?:sem|nao) /.test(group[0]!));
  const exact = appended.length ? `${original} ${appended.join(" ")}` : original;
  const originalGroups = positive(exact), familyGroups = positive(family);
  if (family !== remaining || !familyGroups.length) return undefined;
  // A separate name adds evidence only for a family with at least two public
  // lexical groups. A single proper name is ambiguous in this initial scope;
  // it must not become the purpose of an unrelated product after broadening.
  if (appended.length && familyGroups.length < 2) return undefined;
  // Literal removal alone does not prove optionality: a model could mark the
  // whole product family optional and keep only a model name ("Kit Organizador
  // Viajante" -> "Viajante"). Preserve the leading product core, including two
  // groups when the original contains three or more. Unproved reductions stay
  // exact-only instead of filling the carousel with unrelated catalog items.
  if (family !== exact && (familyGroups.length < Math.min(2, Math.max(1, originalGroups.length - 1))
    || familyGroups.some((group, index) => JSON.stringify(group) !== JSON.stringify(originalGroups[index])))) return undefined;
  const generic = new Set(["kit", "kits", "conjunto", "conjuntos", "acessorio", "acessorios", "pacote", "pacotes", "modelo", "modelos", "linha", "linhas"]);
  if (familyGroups.every(group => group.every(term => generic.has(term)))) return undefined;
  if (!terms.length && !plan.attributes.some(a => a.priority === "preferred" && a.operator === "equals")) return undefined;
  return { exact: appended.length ? `${plan.query} ${appended.join(" ")}` : plan.query, family: plan.recovery.familyQuery };
}

export function shoppingFamilyMatches(query: string, facts: string): boolean {
  const text = normalizeShoppingFact(facts), groups = contextualSearchGroups(query);
  return groups.length > 0 && groups.every(group => group.some(term =>
    new RegExp(`(?:^|[\\s-])${escape(normalizeShoppingFact(term))}(?=[\\s-]|$)`, "u").test(text)));
}

/** The same variant must prove every mandatory attribute, including negatives.
 * Missing data never proves an exclusion or a requested property. */
export function shoppingAttributesMatch(plan: ShoppingSearchPlan, attributes: Record<string, string> | undefined, exact: boolean): boolean {
  return plan.attributes.filter(a => exact || a.priority === "required" || a.operator === "not_equals").every(a => {
    const value = Object.entries(attributes ?? {}).find(([key]) => normalizeShoppingFact(key) === normalizeShoppingFact(a.name))?.[1];
    if (value === undefined) return false;
    return a.operator === "equals" ? normalizeShoppingFact(value) === normalizeShoppingFact(a.value)
      : normalizeShoppingFact(value) !== normalizeShoppingFact(a.value);
  });
}
