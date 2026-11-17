import { createHash } from "node:crypto";
import type { BillingPlanMeteringService } from "../../../../modules/payment/domain/billing-plan-guard.js";
import type { KnowledgeChunk } from "../../../../modules/knowledge-base/domain/ports/knowledge-repository.port.js";
import type { getProfessionalAvailability, ProfessionalAvailabilityReadInput } from "../../../../modules/catalog/application/get-professional-availability.js";
import type { readProfessionalServiceLink } from "../../../../modules/catalog/domain/services/professional-service-link.js";
import type { CanonicalPublicSnapshotPort, CanonicalReadEvidence, CanonicalReadPair, CanonicalReadRequest } from "../../infrastructure/prisma-canonical-public-snapshot-reader.js";
// Retrieval candidates retain the canonical admission and relationship contract.
import type { RevalidatePublicSourceService as Revalidator70 } from "../../application/use-cases/revalidate-public-source.service.js";
import type { PublicEvidenceCanonicalPort, PublicEvidenceCandidate, PublicEvidencePairCandidate, ValidatedPublicEvidence,
  LegacyKnowledgeRetrievalEvidence, PublicEvidenceResult, PublicEvidencePairResult } from "../../domain/public-source-evidence.js";

export type AnswerEvidence = CanonicalReadEvidence | Readonly<ValidatedPublicEvidence>;
type State = "ready" | "insufficient" | "conflicting" | "unavailable";
type Purpose = "knowledge" | "existing_company_context" | "existing_support_faq" | "existing_store_policy";
type Reply = { message: string };
type Pair = readonly [string, string];
interface Bundle { status: State; evidence: readonly AnswerEvidence[]; pairs: readonly Pair[]; partial: boolean }
interface Group { original: Bundle; recheck: () => Promise<Bundle> }
export interface SessionDependencies {
  scope: Pick<PublicEvidenceCanonicalPort, "assertScope">;
  billing: Pick<BillingPlanMeteringService, "assertAllowed">;
  canonical: CanonicalPublicSnapshotPort;
  publicSources: Pick<Revalidator70, "revalidate" | "revalidatePairs" | "revalidateLegacy">;
}
export type LiveChoice = Readonly<Pick<ProfessionalAvailabilityReadInput, "productId" | "variantId" | "professionalId" | "fromDate" | "toDate">>;
export interface LiveBusinessSnapshot {
  readonly facts: Awaited<ReturnType<typeof readProfessionalServiceLink>>;
  readonly availability: Awaited<ReturnType<typeof getProfessionalAvailability>>;
  readonly publicLabels?: Readonly<{ serviceName: string; professionalName: string }>;
}
type LiveRead = (input: LiveChoice & Readonly<{ merchantId: string }>) => Promise<LiveBusinessSnapshot>;
export interface FinalAnswer<T extends Reply> {
  readonly reply: T;
  readonly status: State;
  readonly route: "informational" | "clarification" | "human_required";
  readonly evidence: readonly AnswerEvidence[];
  readonly partial: boolean;
  readonly reason?: string;
}
const families = ["company", "business_hours", "professional", "service", "faq", "policy"];
function narrowFamilies(purpose: Purpose): ReadonlyArray<CanonicalReadEvidence["provenance"]["sourceType"]> | undefined {
  if (purpose === "existing_company_context") return ["company", "business_hours"];
  if (purpose === "existing_support_faq") return ["faq"];
  if (purpose === "existing_store_policy") return ["policy"];
  return undefined;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const failure = (status: Exclude<State, "ready">): Bundle => ({ status, evidence: [], pairs: [], partial: false });
const clone = <T>(value: T): T => structuredClone(value);
function frozen<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }
// Opaque canonical updatedAt/sourceVersion is deliberately excluded. All public
// text/hash/work/model/chunk/storage and original retrieval values remain bound.
function authority(item: AnswerEvidence) {
  const { sourceVersion: _opaqueVersion, ...publicProof } = item.provenance;
  return JSON.stringify([item.id, item.content, publicProof, "retrieval" in item ? item.retrieval ?? null : null]);
}
const pairKey = (pair: Pair) => JSON.stringify(pair);
function same(a: Bundle, b: Bundle) {
  const left = new Set(a.evidence.map(authority)), right = new Set(b.evidence.map(authority));
  const lp = new Set(a.pairs.map(pairKey)), rp = new Set(b.pairs.map(pairKey));
  return left.size === right.size && [...left].every(key => right.has(key)) && lp.size === rp.size && [...lp].every(key => rp.has(key));
}
function canonicalPairs(evidence: readonly AnswerEvidence[], pairs: readonly CanonicalReadPair[]): Pair[] {
  return pairs.map(pair => {
    const service = evidence.find(item => item.id === pair.serviceEvidenceId), professional = evidence.find(item => item.id === pair.professionalEvidenceId);
    if (service?.provenance.sourceType !== "service" || professional?.provenance.sourceType !== "professional") throw Error("grounding_pair_invalid");
    return [authority(service), authority(professional)] as const;
  });
}
function publicBundle(result: PublicEvidenceResult, partial = false): Bundle { return { ...result, pairs: [], partial }; }
function pairedBundle(result: PublicEvidencePairResult, partial = false): Bundle {
  return { status: result.status, evidence: result.evidence, partial,
    pairs: result.status === "ready" ? result.pairs.map(pair => [authority(pair.service), authority(pair.professional)] as const) : [] };
}

/** Per-turn internal selection/final fence. Never HTTP/model-constructible
 * authority and never a replacement for QueryKnowledge's existing paid gate. */
export class PublicBusinessAnswerSession {
  private readonly groups: Group[] = [];
  private readonly refs = new Map<string, AnswerEvidence>();
  private readonly pairs = new Map<string, Pair>();
  private readonly live: Array<{ choice: LiveChoice; read: LiveRead }> = [];
  private inFlight = 0;
  private phase: "collecting" | "producing" | "finalizing" | "closed" = "collecting";
  private refusal?: { status: Exclude<State, "ready">; reason: string };
  private partial = false;
  private constructor(private readonly merchantId: string, private readonly purpose: Purpose, private readonly deps: SessionDependencies) {}

  static async open(input: { merchantId: string; purpose: Purpose }, deps: SessionDependencies) {
    deps.scope.assertScope(input.merchantId);
    if (!["knowledge", "existing_company_context", "existing_support_faq", "existing_store_policy"].includes(input.purpose)) throw Error("grounding_purpose_denied");
    if (input.purpose === "knowledge") {
      try { await deps.billing.assertAllowed(input.merchantId, { kind: "feature", key: "knowledgeBase" }); }
      catch { return { status: "unavailable" as const, reason: "knowledge_base_denied" as const }; }
    }
    deps.scope.assertScope(input.merchantId);
    return { status: "ready" as const, session: new PublicBusinessAnswerSession(input.merchantId, input.purpose, deps) };
  }
  get evidenceCount() { return this.refs.size; }
  get remainingBudget() { return 20 - this.refs.size; }
  private collecting(general = false) {
    this.deps.scope.assertScope(this.merchantId);
    if (!["collecting", "producing"].includes(this.phase)) throw Error("grounding_selection_sealed");
    if (general && this.purpose !== "knowledge") throw Error("grounding_purpose_denied");
  }
  private remember(status: Exclude<State, "ready">, reason: string) {
    // A missing required selection cannot be hidden by a later unrelated fact.
    if (!this.refusal || status === "conflicting" || this.refusal.status === "insufficient") this.refusal = { status, reason };
    return { status, reason };
  }
  private currentRefusal() { return this.refusal; }
  private normalize(bundle: Bundle, canonical: boolean): Bundle {
    if (bundle.status !== "ready") return failure(bundle.status);
    if (!Array.isArray(bundle.evidence) || bundle.evidence.length > 20 || !bundle.evidence.length) return failure("insufficient");
    const evidence = bundle.evidence.map(item => {
      const p = item.provenance;
      if (p.merchantId !== this.merchantId || p.publicationState !== "published" || !families.includes(p.sourceType)
        || typeof item.content !== "string" || !item.content || p.contentHash !== hash(item.content)) throw Error("grounding_reference_invalid");
      if (canonical && (p.origin !== "canonical_sql" || p.namespace !== "canonical-public"
        || p.publicWorkVersion !== null || p.embeddingModel !== null || p.embeddingDimensions !== null)) throw Error("grounding_canonical_proof_invalid");
      if (!canonical && !["public_graph", "public_sql", "legacy_graph", "legacy_sql"].includes(p.origin)) throw Error("grounding_reference_invalid");
      const allowed = narrowFamilies(this.purpose);
      if (allowed && !allowed.includes(p.sourceType)) throw Error("grounding_purpose_denied");
      return frozen(clone(item));
    });
    const identities = new Set(evidence.map(authority));
    if (bundle.pairs.some(pair => pair.length !== 2 || pair.some(key => !identities.has(key)))) throw Error("grounding_pair_invalid");
    return frozen({ status: "ready" as const, evidence, pairs: clone(bundle.pairs), partial: bundle.partial });
  }
  private commit(bundle: Bundle, recheck: () => Promise<Bundle>, canonical: boolean) {
    this.collecting();
    const current = this.normalize(bundle, canonical);
    if (current.status !== "ready") return this.remember(current.status, "selection_" + current.status);
    const extra = new Set(current.evidence.map(authority).filter(key => !this.refs.has(key)));
    if (this.refs.size + extra.size > 20) return this.remember("insufficient", "evidence_budget");
    // Whole group/pair commitment: no slicing a two-endpoint pair at the limit.
    current.evidence.forEach(item => this.refs.set(authority(item), item)); current.pairs.forEach(pair => this.pairs.set(pairKey(pair), pair));
    this.groups.push({ original: current, recheck: async () => this.normalize(await recheck(), canonical) });
    this.partial ||= current.partial;
    return { status: "ready" as const };
  }
  private async capture(initial: () => Promise<Bundle>, recheck: () => Promise<Bundle>, canonical: boolean) {
    this.inFlight++;
    try { return this.commit(await initial(), recheck, canonical); }
    catch { return this.remember("unavailable", "initial_read_unavailable"); }
    finally { this.inFlight--; }
  }
  async captureCanonical(request: CanonicalReadRequest) {
    this.collecting();
    if (request.merchantId !== this.merchantId) throw Error("grounding_scope_mismatch");
    if (!this.remainingBudget) return this.remember("insufficient", "evidence_budget");
    const allowed = narrowFamilies(this.purpose);
    if (allowed && (request.mode !== "sources"
      || request.sourceTypes?.some(type => !allowed.includes(type)))) throw Error("grounding_purpose_denied");
    const selected = frozen(clone({ ...request, limit: Math.min(request.limit, this.remainingBudget),
      ...(allowed ? { sourceTypes: [...allowed] } : {}) })) as CanonicalReadRequest;
    // Keep the actual WeakMap capability; never clone/serialize this object.
    let handle: Parameters<CanonicalPublicSnapshotPort["recheck"]>[1] | undefined, partial = false;
    const initial = async (): Promise<Bundle> => {
      const result = await this.deps.canonical.read(selected); this.deps.scope.assertScope(this.merchantId);
      if (result.status !== "ready") return failure(result.status);
      handle = result.selection; partial = result.partial;
      return { status: "ready", evidence: result.evidence, pairs: canonicalPairs(result.evidence, result.pairs), partial };
    };
    return this.capture(initial, async () => {
      if (!handle) return failure("unavailable");
      const current = await this.deps.canonical.recheck(this.merchantId, handle);
      if (current.status !== "current") return failure(current.status === "changed" ? "insufficient" : current.status);
      return { status: "ready", evidence: current.evidence, pairs: canonicalPairs(current.evidence, current.pairs), partial };
    }, true);
  }
  async capturePublic(candidates: readonly PublicEvidenceCandidate[], coverage?: Readonly<{ partial: boolean }>) {
    this.collecting(true); const original = frozen(clone(candidates)), partial = coverage?.partial === true;
    const read = () => this.deps.publicSources.revalidate({ merchantId: this.merchantId, candidates: original });
    return this.capture(async () => publicBundle(await read(), partial), async () => publicBundle(await read(), partial), false);
  }
  async capturePairs(pairs: readonly Readonly<PublicEvidencePairCandidate>[], coverage?: Readonly<{ partial: boolean }>) {
    this.collecting(true); const original = frozen(clone(pairs)), partial = coverage?.partial === true;
    const read = () => this.deps.publicSources.revalidatePairs({ merchantId: this.merchantId, pairs: original });
    return this.capture(async () => pairedBundle(await read(), partial), async () => pairedBundle(await read(), partial), false);
  }
  async captureLegacy(chunks: KnowledgeChunk[], origin: "legacy_graph" | "legacy_sql", retrieval: readonly Readonly<LegacyKnowledgeRetrievalEvidence>[] = []) {
    this.collecting(true); const original = frozen(clone(chunks)), proof = frozen(clone(retrieval));
    const read = () => this.deps.publicSources.revalidateLegacy(this.merchantId, [...original], origin, proof);
    return this.capture(async () => publicBundle(await read()), async () => publicBundle(await read()), false);
  }
  groundingData(): string {
    this.deps.scope.assertScope(this.merchantId);
    return JSON.stringify({ role: "quoted_public_business_data", partial: this.partial,
      coverage: { scope: "selected_public_sources", completeCatalog: false, currentPriceOrAvailability: false },
      sources: [...this.refs.values()].map(item => ({ reference: hash(authority(item)), sourceType: item.provenance.sourceType,
        sourceId: item.provenance.sourceId, publicText: item.content })), linkedPairs: [...this.pairs.values()].map(pair => pair.map(hash)) });
  }
  attachLive(choice: LiveChoice, read: LiveRead) {
    this.collecting(true);
    const linked = [...this.pairs.values()].some(pair => {
      const service = this.refs.get(pair[0]), professional = this.refs.get(pair[1]);
      return service?.provenance.sourceId === choice.productId && professional?.provenance.sourceId === choice.professionalId;
    });
    if (!linked) throw Error("grounding_pair_required");
    if (this.live.length >= 10) throw Error("grounding_live_limit");
    this.live.push({ choice: frozen(clone(choice)), read });
  }
  private checkLive(choice: LiveChoice, value: LiveBusinessSnapshot) {
    const f = value.facts, a = value.availability;
    if (f.merchantId !== this.merchantId || f.productId !== choice.productId || f.variantId !== choice.variantId || f.professionalId !== choice.professionalId
      || a.status === "stale" || f.professionalVersion !== a.professionalVersion || f.timeZone !== a.timeZone || f.durationMinutes !== a.durationMinutes
      || !Number.isSafeInteger(f.priceInCents) || f.priceInCents <= 0 || !/^[A-Z]{3}$/.test(f.currency)
      || !Number.isSafeInteger(a.policyVersion) || !a.policyVersion || !Array.isArray(a.slots)) throw Error("grounding_live_unavailable");
    return frozen(clone(value));
  }
  private safe<T extends Reply>(status: Exclude<State, "ready">, reason: string, build: (state: State) => T): FinalAnswer<T> {
    this.phase = "closed";
    return { reply: build(status), status, route: "clarification", reason, evidence: [], partial: this.partial };
  }
  async answer<T extends Reply>(produce: (quotedData: string) => Promise<T>, options: {
    kind: "public_text" | "live_facts"; safeReply: (state: State) => T; renderLive?: (current: readonly LiveBusinessSnapshot[]) => T;
  }): Promise<FinalAnswer<T>> {
    if (this.phase !== "collecting") throw Error("grounding_answer_already_started");
    this.collecting();
    if (this.inFlight) return this.safe("unavailable", "unawaited_capture", options.safeReply);
    if (this.refusal) return this.safe(this.refusal.status, this.refusal.reason, options.safeReply);
    if (!this.refs.size) return this.safe("insufficient", "empty_selection", options.safeReply);
    if (options.kind === "live_facts" && !this.live.length) return this.safe("insufficient", "missing_live_authority", options.safeReply);
    this.phase = "producing";
    // The caller completes generation, review, copy and tool-result awaits here,
    // including a zero-model/facts-only shortcut. No source text selects tools.
    let proposed: T;
    try { proposed = await produce(this.groundingData()); }
    catch { return this.safe("unavailable", "generation_unavailable", options.safeReply); }
    this.phase = "finalizing";
    try {
      this.deps.scope.assertScope(this.merchantId);
      if (this.inFlight) return this.safe("unavailable", "unawaited_capture", options.safeReply);
      const refusal = this.currentRefusal();
      if (refusal) return this.safe(refusal.status, refusal.reason, options.safeReply);
      const live: LiveBusinessSnapshot[] = [];
      for (const selection of this.live) {
        const value = await selection.read(frozen({ ...selection.choice, merchantId: this.merchantId }));
        this.deps.scope.assertScope(this.merchantId); live.push(this.checkLive(selection.choice, value));
      }
      const final = new Map<string, AnswerEvidence>();
      for (const group of this.groups) {
        const current = await group.recheck(); this.deps.scope.assertScope(this.merchantId);
        if (current.status !== "ready") return this.safe(current.status, "final_" + current.status, options.safeReply);
        if (!same(group.original, current)) return this.safe("insufficient", "selected_authority_changed", options.safeReply);
        current.evidence.forEach(item => final.set(authority(item), item));
      }
      if (final.size > 20 || !final.size) return this.safe("insufficient", "final_budget_or_empty", options.safeReply);
      // A live response NEVER reuses generated price/slot text or old blocks.
      // The formatter is synchronous, server-owned and gets current machine facts only.
      const reply = live.length ? options.renderLive?.(frozen(live)) : proposed;
      if (!reply || typeof reply.message !== "string") return this.safe("unavailable", "live_formatter_unavailable", options.safeReply);
      this.phase = "closed";
      return { reply, status: "ready", route: "informational", evidence: frozen([...final.values()]), partial: this.partial };
    } catch { return this.safe("unavailable", "final_read_unavailable", options.safeReply); }
  }
  referProfessional<T extends Reply>(existingHumanReply: () => T): FinalAnswer<T> {
    if (this.phase !== "collecting") throw Error("grounding_answer_already_started");
    this.collecting(); this.phase = "closed";
    return { reply: existingHumanReply(), status: "insufficient", route: "human_required", evidence: [], partial: this.partial, reason: "professional_decision" };
  }
}
