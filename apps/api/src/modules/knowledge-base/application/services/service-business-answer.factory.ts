import { Prisma, type PrismaClient } from "@prisma/client";
import type { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import type { BillingPlanMeteringService } from "../../../payment/domain/billing-plan-guard.js";
import type { GraphRagRuntime } from "../../../graph-rag/graph-rag.module.js";
import { graphReadSchema } from "../../../graph-rag/domain/graph-query.js";
import { publicBusinessReadSchema } from "../../../graph-rag/domain/public-business-query.js";
import { publicGraphCandidate } from "../../../graph-rag/domain/public-business-result.js";
import type { PublicBusinessRequest } from "../../../graph-rag/application/public-business-retrieval.service.js";
import type { PublicBusinessSourceType } from "../../../graph-rag/domain/public-business-source.js";
import type { PublicEvidenceCandidate, PublicEvidencePairCandidate, PublicEvidenceResult } from "../../domain/public-source-evidence.js";
import type { CanonicalPairHint, CanonicalPublicSnapshotPort, CanonicalReadRequest } from "../../infrastructure/prisma-canonical-public-snapshot-reader.js";
import { PublicBusinessAnswerSession, type SessionDependencies } from "./public-business-answer-session.js";
import type { BusinessLiveAttachment, PublicBusinessLiveTools } from "./public-business-live-tools.js";

export type BusinessFallbackPurpose = "existing_company_context" | "existing_support_faq" | "existing_store_policy";
type Purpose = "knowledge" | BusinessFallbackPurpose;
export interface BusinessAnswerOpenInput { merchantId: string; fallbackPurpose: BusinessFallbackPurpose }
export type BusinessAnswerOpen = { kind: "products" }
  | { kind: "unavailable"; reason: "canonical_scope_unavailable" }
  | { kind: "services"; session: PublicBusinessAnswerSession; purpose: Purpose; assertCurrentServiceMode: () => Promise<void> };
export type BusinessKnowledgeCaptureInput = Readonly<{ merchantId: string; queryText: string; mode: "sources";
  sourceTypes?: readonly PublicBusinessSourceType[]; limit?: number }>
  | Readonly<{ merchantId: string; queryText: string; mode: "service_professional"; pairs: readonly CanonicalPairHint[]; limit?: number }>;
export type BusinessKnowledgeCapture = Readonly<{ status: PublicEvidenceResult["status"]; arm: "public_graph" | "canonical_sql" }>;
interface Turn { merchantId: string; purpose: Purpose; failed: boolean; liveRequests: number }
const fallbackPurposes: readonly string[] = ["existing_company_context", "existing_support_faq", "existing_store_policy"];

/** Server-only per-turn bridge. Canonical business mode selects the arm; a body
 * flag, model response, stored-index namespace or structural session cannot. */
export class ServiceBusinessAnswerFactory {
  private readonly turns = new WeakMap<PublicBusinessAnswerSession, Turn>();
  constructor(private readonly prisma: Pick<PrismaClient, "$transaction">,
    private readonly tenant: Pick<TenantContextService, "get">,
    private readonly billing: Pick<BillingPlanMeteringService, "assertAllowed">,
    private readonly canonical: CanonicalPublicSnapshotPort,
    private readonly publicSources: SessionDependencies["publicSources"],
    private readonly graph?: Pick<GraphRagRuntime, "searchPublicBusiness">,
    private readonly live?: Pick<PublicBusinessLiveTools, "attach">) {}

  private assertScope(merchantId: string) {
    if (!merchantId || this.tenant.get()?.merchantId !== merchantId) throw Error("business_answer_session_denied");
  }
  private async currentMode(merchantId: string): Promise<"products" | "services"> {
    this.assertScope(merchantId);
    const row = await this.prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM merchants WHERE id=${merchantId} FOR SHARE`);
      if (locked.length !== 1 || locked[0]!.id !== merchantId) throw Error("business_answer_mode_unavailable");
      return tx.merchant.findUnique({ where: { id: merchantId }, select: {
        businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true,
      } });
    });
    this.assertScope(merchantId);
    // Canonical legacy/default products keeps its existing flow. Service mode
    // additionally requires the approved explicit selection/review state.
    if (row?.businessMode === "products") return "products";
    if (row?.businessMode === "services" && row.businessModeSelectedAt !== null && row.businessModeSelectedAt !== undefined
      && row.businessModeNeedsReview === false) return "services";
    throw Error("business_answer_mode_unavailable");
  }
  async open(input: BusinessAnswerOpenInput): Promise<BusinessAnswerOpen> {
    const merchantId = input.merchantId, fallbackPurpose = input.fallbackPurpose;
    try {
      this.assertScope(merchantId);
      if (!fallbackPurposes.includes(fallbackPurpose)) throw Error("business_answer_session_denied");
      if (await this.currentMode(merchantId) === "products") return { kind: "products" };
      const deps: SessionDependencies = { scope: { assertScope: merchantId => this.assertScope(merchantId) },
        billing: this.billing, canonical: this.canonical, publicSources: this.publicSources };
      const paid = await PublicBusinessAnswerSession.open({ merchantId: merchantId, purpose: "knowledge" }, deps);
      const opened = paid.status === "ready" ? paid
        : await PublicBusinessAnswerSession.open({ merchantId: merchantId, purpose: fallbackPurpose }, deps);
      if (opened.status !== "ready") return { kind: "unavailable", reason: "canonical_scope_unavailable" };
      const purpose: Purpose = paid.status === "ready" ? "knowledge" : fallbackPurpose;
      const turn: Turn = { merchantId: merchantId, purpose, failed: false, liveRequests: 0 };
      this.turns.set(opened.session, turn);
      return { kind: "services", session: opened.session, purpose, assertCurrentServiceMode: async () => {
        this.registered(opened.session, merchantId);
        if (turn.failed) throw Error("business_answer_selection_unavailable");
        if (await this.currentMode(merchantId) !== "services") throw Error("service_business_mode_changed");
        if (purpose === "knowledge") await this.billing.assertAllowed(merchantId, { kind: "feature", key: "knowledgeBase" });
        this.registered(opened.session, merchantId);
        if (turn.failed) throw Error("business_answer_selection_unavailable");
      } };
    } catch { return { kind: "unavailable", reason: "canonical_scope_unavailable" }; }
  }
  private registered(session: PublicBusinessAnswerSession, merchantId: string, general = false): Turn {
    this.assertScope(merchantId);
    const turn = this.turns.get(session);
    if (!turn || turn.merchantId !== merchantId || general && turn.purpose !== "knowledge") throw Error("business_answer_session_denied");
    return turn;
  }
  async captureBusinessKnowledge(session: PublicBusinessAnswerSession, input: BusinessKnowledgeCaptureInput): Promise<BusinessKnowledgeCapture> {
    const turn = this.registered(session, input.merchantId, true);
    if (turn.failed) throw Error("business_answer_selection_unavailable");
    const finish = (status: PublicEvidenceResult["status"], arm: BusinessKnowledgeCapture["arm"]): BusinessKnowledgeCapture => {
      if (status !== "ready") turn.failed = true;
      return { status, arm };
    };
    const query = graphReadSchema.shape.query.safeParse(input.queryText), requestedLimit = graphReadSchema.shape.limit.safeParse(input.limit ?? 12);
    if (!query.success || !requestedLimit.success) return finish("unavailable", "canonical_sql");
    const budget = Math.min(requestedLimit.data, session.remainingBudget);
    if (budget < (input.mode === "sources" ? 1 : 2)) return finish("insufficient", "canonical_sql");
    let graphRequest: PublicBusinessRequest, canonicalRequest: CanonicalReadRequest;
    if (input.mode === "sources") {
      const types = publicBusinessReadSchema.options[0].shape.sourceTypes.safeParse(input.sourceTypes);
      if (!types.success) return finish("unavailable", "canonical_sql");
      graphRequest = { merchantId: input.merchantId, query: query.data, mode: "sources", sourceTypes: [...types.data], limit: budget };
      canonicalRequest = { merchantId: input.merchantId, mode: "sources", sourceTypes: [...types.data], limit: budget };
    } else if (input.mode === "service_professional") {
      const pairs = publicBusinessReadSchema.options[1].shape.pairs.safeParse(input.pairs);
      if (!pairs.success) return finish("unavailable", "canonical_sql");
      const pairLimit = Math.min(10, Math.floor(budget / 2));
      graphRequest = { merchantId: input.merchantId, query: query.data, mode: "service_professional", pairs: pairs.data, limit: pairLimit };
      canonicalRequest = { merchantId: input.merchantId, mode: "service_professional", pairs: pairs.data, limit: pairLimit * 2 };
    } else return finish("unavailable", "canonical_sql");
    const fallback = async (): Promise<BusinessKnowledgeCapture> => {
      this.registered(session, input.merchantId, true);
      try { return finish((await session.captureCanonical(canonicalRequest)).status, "canonical_sql"); }
      catch { return finish("unavailable", "canonical_sql"); }
    };
    // Pre-admission is deliberately separate from capture: an invalid/cold
    // indexed candidate can choose canonical BEFORE generation/selection.
    const selected = await this.graph?.searchPublicBusiness(graphRequest).catch(() => undefined);
    this.registered(session, input.merchantId, true);
    if (!selected || selected.status !== "ready" || selected.mode !== graphRequest.mode) return fallback();
    if (selected.mode === "sources") {
      if (!selected.hits.length || selected.hits.length > budget) return fallback();
      let candidates: PublicEvidenceCandidate[];
      try { candidates = selected.hits.map(publicGraphCandidate); } catch { return fallback(); }
      const admitted = await this.publicSources.revalidate({ merchantId: input.merchantId, candidates }).catch(() => undefined);
      this.registered(session, input.merchantId, true);
      if (admitted?.status === "conflicting") return finish("conflicting", "public_graph");
      if (admitted?.status !== "ready") return fallback();
      // From this point onward capture's refusal is persistent. No fallback,
      // new semantic search, session reset or different references can hide it.
      try { return finish((await session.capturePublic(candidates, { partial: selected.partial })).status, "public_graph"); }
      catch { return finish("unavailable", "public_graph"); }
    }
    const pairLimit = Math.floor(budget / 2);
    if (!selected.pairs.length || selected.pairs.length > pairLimit) return fallback();
    let pairs: PublicEvidencePairCandidate[];
    try { pairs = selected.pairs.map(pair => ({ service: publicGraphCandidate(pair.service), professional: publicGraphCandidate(pair.professional) })); }
    catch { return fallback(); }
    const admitted = await this.publicSources.revalidatePairs({ merchantId: input.merchantId, pairs }).catch(() => undefined);
    this.registered(session, input.merchantId, true);
    if (admitted?.status === "conflicting") return finish("conflicting", "public_graph");
    if (admitted?.status !== "ready") return fallback();
    try { return finish((await session.capturePairs(pairs, { partial: selected.partial })).status, "public_graph"); }
    catch { return finish("unavailable", "public_graph"); }
  }
  async attachBusinessLiveRequest(session: PublicBusinessAnswerSession, input: { merchantId: string; request: unknown }): Promise<BusinessLiveAttachment> {
    const turn = this.registered(session, input.merchantId, true);
    if (turn.failed) throw Error("business_answer_selection_unavailable");
    if (turn.liveRequests >= 3) throw Error("business_answer_live_limit");
    turn.liveRequests++;
    if (!this.live) return { status: "unavailable", reason: "canonical_unavailable" };
    return this.live.attach(session, input);
  }
}
