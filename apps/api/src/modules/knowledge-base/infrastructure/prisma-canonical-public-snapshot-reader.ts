import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import type { PublicBusinessSourceProjection, PublicBusinessSourceType } from "../../../modules/graph-rag/domain/public-business-source.js";
import { readCanonicalPublicBusinessSourcesWithin } from "../../../modules/graph-rag/infrastructure/prisma-public-business.sources.js";
import { publicBusinessTextChunks } from "../../../modules/graph-rag/application/public-business-projection.service.js";
import { parsePublicSupportFaqItems } from "../../../modules/support/public-support-knowledge.module.js";
import { PUBLIC_POLICY_LABELS } from "../../../modules/knowledge-base/domain/public-knowledge-content.js";

// Internal evidence tags ONLY. These are not stored KnowledgeChunk namespaces.
export const CANONICAL_READ_ORIGIN = "canonical_sql" as const;
export const CANONICAL_READ_NAMESPACE = "canonical-public" as const;
const FAMILIES = ["company", "business_hours", "professional", "service", "faq", "policy"] as const;
const MAX_EVIDENCE = 20, MAX_IDENTITIES = 100, PAGE_IDENTITIES = 20;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const key = (type: PublicBusinessSourceType, sourceId: string) => JSON.stringify([type, sourceId]);
const id = (value: unknown): value is string => typeof value === "string" && !!value.trim()
  && value.length <= 191 && !/[\u0000-\u001f\u007f]/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(name => allowed.includes(name));
const family = (value: unknown): value is PublicBusinessSourceType => typeof value === "string"
  && (FAMILIES as readonly string[]).includes(value);

type Identity = Readonly<{ sourceType: PublicBusinessSourceType; sourceId: string }>;
export type CanonicalPairHint = Readonly<{ serviceId: string; professionalId: string }>;
/** Internal continuation only; it is neither an HTTP DTO nor evidence authority. */
export type CanonicalCursor = Readonly<{
  merchantId: string; sourceType: PublicBusinessSourceType; sourceId: string;
  kind: "after";
}> | Readonly<{
  merchantId: string; sourceType: PublicBusinessSourceType; sourceId: string;
  kind: "within"; nextChunk: number; sourceHash: string;
}>;
export type CanonicalReadRequest = Readonly<{
  merchantId: string; mode: "sources"; limit: number;
  sourceTypes?: ReadonlyArray<PublicBusinessSourceType>; cursor?: CanonicalCursor;
}> | Readonly<{
  merchantId: string; mode: "service_professional"; limit: number;
  pairs: ReadonlyArray<CanonicalPairHint>;
}>;
export interface CanonicalReadEvidence {
  readonly id: string;
  readonly content: string;
  readonly provenance: Readonly<{
    origin: typeof CANONICAL_READ_ORIGIN; namespace: typeof CANONICAL_READ_NAMESPACE;
    merchantId: string; sourceType: PublicBusinessSourceType; sourceId: string;
    sourceVersion: string; sourceHash: string; publicationState: "published";
    publicWorkVersion: null; embeddingModel: null; embeddingDimensions: null;
    chunkId: string; contentHash: string;
  }>;
}
export interface CanonicalReadPair {
  readonly serviceEvidenceId: string;
  readonly professionalEvidenceId: string;
}
declare const selectionBrand: unique symbol;
/** Retain the actual object in a server-only closure; never JSON/clone it. */
export type CanonicalSelectionHandle = Readonly<{ [selectionBrand]: true }>;
type Failure = Readonly<{
  status: "unavailable"; evidence: readonly []; pairs: readonly [];
  reason: "invalid_input" | "invalid_selection" | "cursor_changed" | "canonical_unavailable";
}> | Readonly<{ status: "conflicting"; evidence: readonly []; pairs: readonly [] }>;
export type CanonicalReadResult = Failure | Readonly<{
  status: "ready" | "insufficient"; mode: CanonicalReadRequest["mode"];
  evidence: ReadonlyArray<CanonicalReadEvidence>; pairs: ReadonlyArray<CanonicalReadPair>;
  partial: boolean; nextCursor?: CanonicalCursor; selection: CanonicalSelectionHandle;
}>;
export type CanonicalRecheckResult = Failure
  | Readonly<{ status: "changed"; evidence: readonly []; pairs: readonly [] }>
  | Readonly<{ status: "insufficient"; evidence: readonly []; pairs: readonly [] }>
  | Readonly<{ status: "current"; evidence: ReadonlyArray<CanonicalReadEvidence>; pairs: ReadonlyArray<CanonicalReadPair> }>;
export interface CanonicalPublicSnapshotPort {
  read(request: CanonicalReadRequest): Promise<CanonicalReadResult>;
  recheck(merchantId: string, selection: CanonicalSelectionHandle): Promise<CanonicalRecheckResult>;
}
interface SelectedSlice extends Identity {
  readonly offset: number; readonly sourceHash: string; readonly contentHash: string; readonly chunkId: string;
}
interface SourceObservation extends Identity {
  sourceHash: string | null; publicationState: PublicBusinessSourceProjection["publicationState"] | null;
}
interface DiscoveryObservation {
  sourceType: PublicBusinessSourceType; after: string | null; inclusive: boolean; ids: string[];
}
interface PairObservation extends CanonicalPairHint { eligible: boolean; admitted: boolean }
interface Page {
  evidence: CanonicalReadEvidence[]; pairs: CanonicalReadPair[]; slices: SelectedSlice[];
  pairHints: CanonicalPairHint[]; partial: boolean; nextCursor?: CanonicalCursor;
  sources: SourceObservation[]; discovery: DiscoveryObservation[]; requestedPairs: PairObservation[];
}
interface Selection {
  readonly merchantId: string; readonly request: CanonicalReadRequest; readonly signature: string;
}
const unavailable = (reason: Extract<Failure, { status: "unavailable" }>["reason"]): Failure =>
  Object.freeze({ status: "unavailable" as const, reason, evidence: [] as const, pairs: [] as const });
const changed = (): CanonicalRecheckResult => Object.freeze({ status: "changed" as const, evidence: [] as const, pairs: [] as const });
const emptyPage = (): Page => ({ evidence: [], pairs: [], slices: [], pairHints: [], partial: false,
  sources: [], discovery: [], requestedPairs: [] });
const freezeEvidence = (value: CanonicalReadEvidence): CanonicalReadEvidence =>
  Object.freeze({ ...value, provenance: Object.freeze({ ...value.provenance }) });

function immutableRequest(request: CanonicalReadRequest): CanonicalReadRequest {
  const copy = structuredClone(request);
  return copy.mode === "service_professional"
    ? Object.freeze({ ...copy, pairs: Object.freeze(copy.pairs.map(pair => Object.freeze({ ...pair }))) })
    : Object.freeze({ ...copy, ...(copy.sourceTypes ? { sourceTypes: Object.freeze([...copy.sourceTypes]) } : {}),
      ...(copy.cursor ? { cursor: Object.freeze({ ...copy.cursor }) } : {}) });
}
function observe(page: Page, identities: ReadonlyArray<Identity>, rows: ReadonlyArray<PublicBusinessSourceProjection | null>) {
  identities.forEach((identity, index) => page.sources.push({ ...identity,
    sourceHash: rows[index]?.sourceHash ?? null, publicationState: rows[index]?.publicationState ?? null }));
}
/** Public selector authority, not a hash of opaque row timestamps. Discovery
 * includes the existing bounded lookahead; no unlimited catalog scan is added.
 * Requested tuple outcomes include invalid/unadmitted hints, not only pairs.
 * The exact cursor and partial flag bind the original coverage claim. */
function selectionSignature(page: Page): string {
  return digest(JSON.stringify({ evidence: page.evidence.map(item => {
    const { sourceVersion: _opaqueVersion, ...proof } = item.provenance;
    return { id: item.id, content: item.content, provenance: proof };
  }), slices: page.slices, pairs: page.pairs, sources: page.sources, discovery: page.discovery,
    requestedPairs: page.requestedPairs, partial: page.partial, nextCursor: page.nextCursor ?? null }));
}

function requestValid(value: unknown): value is CanonicalReadRequest {
  if (!object(value) || !id(value.merchantId) || !Number.isSafeInteger(value.limit)
    || (value.limit as number) < 1 || (value.limit as number) > MAX_EVIDENCE) return false;
  if (value.mode === "service_professional") return exact(value, ["merchantId", "mode", "limit", "pairs"])
    && Array.isArray(value.pairs) && value.pairs.length > 0 && value.pairs.length <= 10
    && value.pairs.every(pair => object(pair) && exact(pair, ["serviceId", "professionalId"])
      && id(pair.serviceId) && id(pair.professionalId));
  if (value.mode !== "sources" || !exact(value, ["merchantId", "mode", "limit", "sourceTypes", "cursor"])) return false;
  if (value.sourceTypes !== undefined && (!Array.isArray(value.sourceTypes) || !value.sourceTypes.length
    || value.sourceTypes.length > 6 || !value.sourceTypes.every(family)
    || new Set(value.sourceTypes).size !== value.sourceTypes.length)) return false;
  if (value.cursor === undefined) return true;
  const cursor = value.cursor;
  if (!object(cursor) || cursor.merchantId !== value.merchantId || !family(cursor.sourceType) || !id(cursor.sourceId)
    || Array.isArray(value.sourceTypes) && !value.sourceTypes.includes(cursor.sourceType)) return false;
  if (cursor.kind === "after") return exact(cursor, ["kind", "merchantId", "sourceType", "sourceId"]);
  return cursor.kind === "within" && exact(cursor, ["kind", "merchantId", "sourceType", "sourceId", "nextChunk", "sourceHash"])
    && Number.isSafeInteger(cursor.nextChunk) && (cursor.nextChunk as number) > 0
    && typeof cursor.sourceHash === "string" && /^[a-f0-9]{64}$/.test(cursor.sourceHash);
}
function published(source: PublicBusinessSourceProjection | null | undefined): source is PublicBusinessSourceProjection {
  return !!source && source.publicationState === "published" && !!source.text.trim();
}
function linked(service: PublicBusinessSourceProjection, professionalId: string): boolean {
  const links = service.publicData.professionals;
  return Array.isArray(links) && links.some(value => object(value) && value.id === professionalId);
}
function evidence(source: PublicBusinessSourceProjection, offset: number): CanonicalReadEvidence {
  const content = publicBusinessTextChunks(source.text)[offset];
  if (!content) throw Error("canonical_slice_invalid");
  const chunkId = digest(JSON.stringify([source.sourceType, source.sourceId, offset]));
  return freezeEvidence({ id: "canonical-read:" + digest(JSON.stringify([source.merchantId, source.sourceType,
    source.sourceId, source.sourceHash, chunkId])), content, provenance: {
    origin: CANONICAL_READ_ORIGIN, namespace: CANONICAL_READ_NAMESPACE, merchantId: source.merchantId,
    sourceType: source.sourceType, sourceId: source.sourceId, sourceVersion: source.sourceVersion,
    sourceHash: source.sourceHash, publicationState: "published", publicWorkVersion: null,
    embeddingModel: null, embeddingDimensions: null, chunkId, contentHash: digest(content),
  } });
}
function append(page: Page, source: PublicBusinessSourceProjection, offset: number): CanonicalReadEvidence {
  const item = evidence(source, offset);
  page.evidence.push(item);
  page.slices.push(Object.freeze({ sourceType: source.sourceType, sourceId: source.sourceId, offset,
    sourceHash: source.sourceHash, contentHash: item.provenance.contentHash, chunkId: item.provenance.chunkId }));
  return item;
}

export class PrismaCanonicalPublicSnapshotReader implements CanonicalPublicSnapshotPort {
  private readonly selections = new WeakMap<CanonicalSelectionHandle, Selection>();
  constructor(private readonly prisma: PrismaClient, private readonly tenant: Pick<TenantContextService, "get">) {}

  private assertScope(merchantId: string): void {
    if (!id(merchantId) || this.tenant.get()?.merchantId !== merchantId) throw Error("canonical_read_scope_mismatch");
  }
  private async lock(tx: Prisma.TransactionClient, merchantId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM merchants WHERE id=${merchantId} FOR SHARE`);
    return rows.length === 1 && rows[0]!.id === merchantId;
  }
  private async current(tx: Prisma.TransactionClient, merchantId: string, identities: ReadonlyArray<Identity>) {
    this.assertScope(merchantId);
    const rows = await readCanonicalPublicBusinessSourcesWithin(tx, merchantId, identities.map(item => ({ ...item })));
    if (rows.length !== identities.length) throw Error("canonical_snapshot_incomplete");
    return rows.map((row, index) => {
      const expected = identities[index]!;
      if (row && (row.merchantId !== merchantId || row.sourceType !== expected.sourceType || row.sourceId !== expected.sourceId
        || !/^[a-f0-9]{64}$/.test(row.sourceHash) || typeof row.sourceVersion !== "string" || !row.sourceVersion))
        throw Error("canonical_snapshot_identity_invalid");
      return row;
    });
  }
  private seal(request: CanonicalReadRequest, page: Page): CanonicalReadResult {
    if (page.evidence.length > MAX_EVIDENCE) throw Error("canonical_evidence_budget_invalid");
    const handle = Object.freeze({}) as CanonicalSelectionHandle;
    const items = Object.freeze(page.evidence.map(freezeEvidence));
    const pairs = Object.freeze(page.pairs.map(pair => Object.freeze({ ...pair })));
    const status: "ready" | "insufficient" = items.length ? "ready" : "insufficient";
    this.selections.set(handle, Object.freeze({ merchantId: request.merchantId, request, signature: selectionSignature(page) }));
    return Object.freeze({ status, mode: request.mode, evidence: items, pairs,
      partial: page.partial, ...(page.nextCursor ? { nextCursor: Object.freeze({ ...page.nextCursor }) } : {}), selection: handle });
  }
  private refusal(error: unknown): Failure {
    if (error instanceof Error && error.message === "public_source_ambiguous")
      return Object.freeze({ status: "conflicting" as const, evidence: [] as const, pairs: [] as const });
    return unavailable(error instanceof Error && error.message === "canonical_cursor_changed" ? "cursor_changed" : "canonical_unavailable");
  }
  async read(request: CanonicalReadRequest): Promise<CanonicalReadResult> {
    if (!requestValid(request)) return unavailable("invalid_input");
    this.assertScope(request.merchantId);
    // Snapshot caller-owned data before awaiting SQL. No body/model can mutate the selection.
    const input = immutableRequest(request);
    try {
      // PostgreSQL default READ COMMITTED: acquire merchant lock before source discovery/reads.
      const page = await this.prisma.$transaction(async tx => {
        if (!await this.lock(tx, input.merchantId)) return emptyPage();
        return input.mode === "sources" ? this.sources(tx, input) : this.pairs(tx, input);
      });
      return this.seal(input, page);
    } catch (error) { return this.refusal(error); }
  }

  /** Current-only counterpart of the existing T63 enumerator's current branches.
   * No work/chunk UNION, no nested transaction, no index or embedding I/O.
   */
  private async ids(tx: Prisma.TransactionClient, merchantId: string, type: PublicBusinessSourceType,
    after: string | undefined, inclusive: boolean, take: number): Promise<string[]> {
    let current: Prisma.Sql;
    if (type === "company" || type === "business_hours") current = Prisma.sql`SELECT id FROM merchants WHERE id=${merchantId}`;
    else if (type === "professional") current = Prisma.sql`SELECT id FROM service_professionals WHERE merchant_id=${merchantId}`;
    else if (type === "service") current = Prisma.sql`SELECT id FROM products WHERE merchant_id=${merchantId} AND type='service'`;
    else {
      const values = type === "policy" ? Object.keys(PUBLIC_POLICY_LABELS) : parsePublicSupportFaqItems(
        (await tx.supportSetting.findUnique({ where: { merchantId }, select: { faqItems: true } }))?.faqItems).map(item => item.id);
      if (new Set(values).size !== values.length) throw Error("public_source_ambiguous");
      current = values.length ? Prisma.sql`SELECT public_ids.id FROM (VALUES ${Prisma.join(values.map(value => Prisma.sql`(${value}::text)`))}) AS public_ids(id)
        WHERE EXISTS(SELECT 1 FROM merchants WHERE id=${merchantId})` : Prisma.sql`SELECT NULL::text AS id WHERE FALSE`;
    }
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT s.id FROM (${current}) s WHERE s.id IS NOT NULL AND length(btrim(s.id))>0 AND length(s.id)<=191
        AND (${after ?? null}::text IS NULL OR s.id COLLATE "C">${after ?? null}::text COLLATE "C"
          OR (${inclusive} AND s.id=${after ?? null}))
      ORDER BY s.id COLLATE "C" LIMIT ${take + 1}`);
    if (rows.some(row => !id(row.id))) throw Error("canonical_discovery_identity_invalid");
    return rows.map(row => row.id);
  }
  private async sources(tx: Prisma.TransactionClient, request: Extract<CanonicalReadRequest, { mode: "sources" }>): Promise<Page> {
    const page = emptyPage(), types = FAMILIES.filter(type => !request.sourceTypes || request.sourceTypes.includes(type));
    let scanned = 0, resume = request.cursor;
    const start = resume ? types.indexOf(resume.sourceType) : 0;
    for (let familyIndex = start; familyIndex < types.length; familyIndex++) {
      const type = types[familyIndex]!;
      let after = resume?.sourceId, inclusive = resume?.kind === "within";
      for (;;) {
        const take = Math.min(PAGE_IDENTITIES, MAX_IDENTITIES - scanned);
        if (take < 1) throw Error("canonical_scan_accounting_invalid");
        const found = await this.ids(tx, request.merchantId, type, after, inclusive, take);
        page.discovery.push({ sourceType: type, after: after ?? null, inclusive: !!inclusive, ids: [...found] });
        if (inclusive && found[0] !== resume?.sourceId) throw Error("canonical_cursor_changed");
        const ids = found.slice(0, take);
        const identities = ids.map(sourceId => ({ sourceType: type, sourceId }));
        const rows = await this.current(tx, request.merchantId, identities);
        observe(page, identities, rows);
        for (let index = 0; index < ids.length; index++) {
          const sourceId = ids[index]!, source = rows[index];
          scanned++;
          const continuation = inclusive && index === 0 && resume?.kind === "within" ? resume : undefined;
          const chunks = published(source) ? publicBusinessTextChunks(source.text) : [];
          if (continuation && (!published(source) || source.sourceHash !== continuation.sourceHash || continuation.nextChunk >= chunks.length))
            throw Error("canonical_cursor_changed");
          const first = continuation?.nextChunk ?? 0;
          if (published(source)) for (let offset = first; offset < chunks.length; offset++) {
            append(page, source, offset);
            if (page.evidence.length === request.limit) {
              page.partial = true;
              page.nextCursor = offset + 1 < chunks.length
                ? { kind: "within", merchantId: request.merchantId, sourceType: type, sourceId, nextChunk: offset + 1, sourceHash: source.sourceHash }
                : { kind: "after", merchantId: request.merchantId, sourceType: type, sourceId };
              return page;
            }
          }
          after = sourceId;
          if (scanned === MAX_IDENTITIES) {
            page.partial = true;
            page.nextCursor = { kind: "after", merchantId: request.merchantId, sourceType: type, sourceId };
            return page;
          }
        }
        resume = undefined;inclusive = false;
        if (found.length <= take) break;
      }
      resume = undefined;
    }
    return page;
  }
  private async pairs(tx: Prisma.TransactionClient, request: Extract<CanonicalReadRequest, { mode: "service_professional" }>): Promise<Page> {
    const page = emptyPage(), identities = new Map<string, Identity>(), uniquePairs = new Map<string, CanonicalPairHint>();
    for (const pair of request.pairs) {
      uniquePairs.set(JSON.stringify([pair.serviceId, pair.professionalId]), pair);
      identities.set(key("service", pair.serviceId), { sourceType: "service", sourceId: pair.serviceId });
      identities.set(key("professional", pair.professionalId), { sourceType: "professional", sourceId: pair.professionalId });
    }
    const ordered = [...identities.values()], rows = await this.current(tx, request.merchantId, ordered);
    observe(page, ordered, rows);
    const byId = new Map(ordered.map((identity, index) => [key(identity.sourceType, identity.sourceId), rows[index]]));
    const added = new Map<string, CanonicalReadEvidence>();
    for (const pair of uniquePairs.values()) {
      const service = byId.get(key("service", pair.serviceId)), professional = byId.get(key("professional", pair.professionalId));
      if (!published(service) || !published(professional) || !linked(service, pair.professionalId)) {
        page.requestedPairs.push({ ...pair, eligible: false, admitted: false });
        continue;
      }
      const endpoints = [service, professional], needed = endpoints.filter(source => !added.has(key(source.sourceType, source.sourceId)));
      const admitted = page.evidence.length + needed.length <= request.limit;
      page.requestedPairs.push({ ...pair, eligible: true, admitted });
      if (!admitted) continue; // never admit a half-pair
      for (const source of needed) added.set(key(source.sourceType, source.sourceId), append(page, source, 0));
      page.pairs.push({ serviceEvidenceId: added.get(key("service", pair.serviceId))!.id,
        professionalEvidenceId: added.get(key("professional", pair.professionalId))!.id });
      page.pairHints.push(Object.freeze({ ...pair }));
    }
    page.partial = true; // bounded requested tuples never enumerate every possible relationship
    return page;
  }
  async recheck(merchantId: string, handle: CanonicalSelectionHandle): Promise<CanonicalRecheckResult> {
    this.assertScope(merchantId);
    const selected = this.selections.get(handle);
    if (!selected || selected.merchantId !== merchantId || selected.request.merchantId !== merchantId || !requestValid(selected.request))
      return unavailable("invalid_selection");
    try {
      return await this.prisma.$transaction(async tx => {
        if (!await this.lock(tx, merchantId)) return changed();
        // Re-evaluate the SAME immutable request, including previously rejected
        // hints and bounded discovery. Fresh facts are comparison material only;
        // no new semantic search/selection can retroactively authorize old text.
        const request = selected.request;
        const page = request.mode === "sources" ? await this.sources(tx, request) : await this.pairs(tx, request);
        if (selectionSignature(page) !== selected.signature) return changed();
        if (!page.evidence.length) return Object.freeze({ status: "insufficient" as const, evidence: [] as const, pairs: [] as const });
        // Equality includes IDs/hashes/publication/pairs/coverage/cursor while
        // actual opaque sourceVersion may refresh after private-only churn.
        return Object.freeze({ status: "current" as const, evidence: Object.freeze(page.evidence.map(freezeEvidence)),
          pairs: Object.freeze(page.pairs.map(pair => Object.freeze({ ...pair }))) });
      });
    } catch (error) { return this.refusal(error); }
  }
}
