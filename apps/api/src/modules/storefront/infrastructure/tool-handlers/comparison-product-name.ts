import type { ProductRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";

type PublicName = { id: string; name: string };
export interface ComparisonNameResolution {
  requestedName: string;
  status: "resolved" | "ambiguous" | "not_found" | "limited";
  candidates: PublicName[];
  candidateCount?: number;
}

const PAGE_SIZE = 100, MAX_PAGES = 3;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** A partial scan never proves uniqueness or absence. Name resolution is only
 * comparison evidence: it grants no cart or purchase authority. */
export async function resolveComparisonNames(repository: Pick<ProductRepositoryPort, "listPublicNames">,
  merchantId: string, requestedNames: string[]): Promise<ComparisonNameResolution[]> {
  const limited = () => requestedNames.map(requestedName => ({ requestedName, status: "limited" as const, candidates: [] }));
  if (!repository.listPublicNames) return limited();
  const names: PublicName[] = [], ids = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined, complete = false;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await repository.listPublicNames({ merchantId, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result.items) || result.items.length > PAGE_SIZE) return limited();
      for (const item of result.items) {
        if (!item || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim() || ids.has(item.id)) return limited();
        ids.add(item.id); names.push({ id: item.id, name: item.name });
      }
      if (result.nextCursor === undefined) { complete = true; break; }
      if (!result.items.length || result.nextCursor !== result.items.at(-1)!.id || cursors.has(result.nextCursor)) return limited();
      cursors.add(result.nextCursor); cursor = result.nextCursor;
    }
  } catch { return limited(); }
  if (!complete) return limited();
  return requestedNames.map<ComparisonNameResolution>(requestedName => {
    const wanted = normalize(requestedName);
    const exact = names.filter(item => normalize(item.name) === wanted);
    const candidates = !wanted ? [] : exact.length ? exact : names.filter(item => (` ${normalize(item.name)} `).includes(` ${wanted} `));
    return { requestedName, status: candidates.length === 1 ? "resolved" : candidates.length > 1 ? "ambiguous" : "not_found",
      candidates: candidates.slice(0, 5), candidateCount: candidates.length };
  });
}
