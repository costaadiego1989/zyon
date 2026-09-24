import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, CheckoutSession, StrategyTurn, StrategyExecution } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { checkoutContractHash } from "../../checkout/domain/services/checkout-chat-baseline.js";
import { executionContract, renderStrategyTurn, strategyArm, strategyExecutionEnabled, type StrategyExecutionContract } from "../domain/strategy-execution.js";
import type { StrategyProposal } from "../domain/strategy-proposal.js";
import { lockCheckoutBaselineRows, readCheckoutBaseline } from "./checkout-baseline.reader.js";
import type { PinnedChatResult } from "../../checkout/application/services/chat-llm-gateway.service.js";
import type { ChatExchangeClaim } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { chatMessageTextHash } from "../../checkout/domain/services/chat-message-identity.js";
import { CHECKOUT_CHAT_BINDINGS_VERSION, checkoutSessionPrompt } from "../../checkout/domain/services/checkout-chat-context.js";
import { missingFieldsForStage } from "../../checkout/domain/services/customer-extraction.service.js";
import { toCheckoutSession } from "../../checkout/infrastructure/prisma/checkout-session.mapper.js";

type TurnInput = { merchantId: string; sessionId: string; requestKey: string; inputHash: string;
  route: "primary_llm" | "deterministic" | "fallback"; userMessage?: string } & (
  { chatRequest: ChatExchangeClaim; turn?: never } |
  { chatRequest?: undefined; turn: Parameters<typeof renderStrategyTurn>[3] }
);

type Tx = Prisma.TransactionClient;
export async function executionClock(tx: Tx): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return row.now;
}

export async function lockExecutionMerchant(tx: Tx, merchantId: string) {
  await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
}

async function lockRunningExperiment(tx: Tx, merchantId: string, experimentId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM prompt_experiments
    WHERE id = ${experimentId} AND merchant_id = ${merchantId} AND status = 'running' FOR SHARE`;
  return rows.length === 1;
}

export async function lockStrategySession(tx: Tx, merchantId: string, sessionId: string) {
  await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${merchantId}
    AND session_id = ${sessionId} FOR SHARE`;
}

export function sessionContextHash(session: CheckoutSession) {
  // Dates must be serialized before canonical hashing. Include version and all
  // persisted fields: even a changed-and-restored cart invalidates a stale turn.
  return digest(JSON.parse(JSON.stringify(session)));
}

/** Caller holds baseline rows and the session lock. Shared by completion and
 * actual publication so historical eligibility cannot become a future permit. */
export async function currentStrategyTurnReason(tx: Tx, turn: StrategyTurn, execution: StrategyExecution,
  session: CheckoutSession, now: Date): Promise<string> {
  const merchantId = turn.merchantId;
  await tx.$queryRaw`SELECT id FROM strategy_executions WHERE id = ${execution.id} AND merchant_id = ${merchantId} FOR SHARE`;
  // Re-read after acquiring the lock (a direct database update may have waited).
  const currentExecution = await tx.strategyExecution.findUniqueOrThrow({ where: { id: execution.id } });
  if (!strategyExecutionEnabled(merchantId)) return "execution_disabled";
  if (process.env.REVENUE_STRATEGY_CHAT_DISPATCH_ENABLED !== "true") return "dispatch_disabled";
  if (currentExecution.status !== "running") return "execution_stopped";
  if (now < currentExecution.startedAt || now >= currentExecution.endsAt) return "outside_horizon";
  if (await tx.strategyAssignmentStop.findUnique({ where: { assignmentId: turn.assignmentId } })) return "assignment_stopped";
  if (!turn.sessionContextHash || turn.sessionContextHash !== sessionContextHash(session)) return "session_changed";
  if (!await lockRunningExperiment(tx, merchantId, currentExecution.experimentId)) return "experiment_stopped";
  const contract = currentExecution.contract as unknown as StrategyExecutionContract;
  const baseline = await readCheckoutBaseline(tx, merchantId);
  return digest(contract) !== currentExecution.contractHash || !baseline
    || checkoutContractHash(baseline) !== checkoutContractHash(contract.baseline) ? "baseline_changed" : "current_at_recording";
}

/** Internal publisher primitive. No HTTP route calls it yet. The approval must
 * already be durable and exact; copying the reviewed plan never replans it. */
export async function registerApprovedExecution(tx: Tx, merchantId: string, approvalId: string, clock = executionClock) {
  if (!strategyExecutionEnabled(merchantId)) throw new Error("STRATEGY_EXECUTION_DISABLED");
  await lockCheckoutBaselineRows(tx, merchantId);
  const approval = await tx.revenueStrategyAction.findFirst({ where: { id: approvalId, merchantId },
    include: { proposal: { include: { strategy: true } } } });
  if (!approval || approval.kind !== "approve" || !approval.actorId.trim()) throw new Error("STRATEGY_APPROVAL_REQUIRED");
  const version = approval.proposal;
  const receipt = approval.result as Record<string, unknown>;
  if (receipt.status !== "activation_pending" || receipt.proposal_hash !== version.proposalHash
    || receipt.strategy_id !== approval.strategyId || receipt.version !== approval.version
    || receipt.action_id !== approval.id) throw new Error("STRATEGY_APPROVAL_CONFLICT");
  const contract = executionContract({ merchantId, strategyId: approval.strategyId, version: approval.version,
    runId: version.strategy.runId, proposalHash: version.proposalHash, proposal: version.proposal as unknown as StrategyProposal });
  const previous = await tx.strategyExecution.findUnique({ where: { approvalActionId: approvalId } });
  if (previous) {
    if (previous.merchantId !== merchantId || previous.contractHash !== digest(contract)) throw new Error("STRATEGY_EXECUTION_CONFLICT");
    return previous;
  }
  const now = await clock(tx);
  if (version.expiresAt <= now || approval.createdAt > now || approval.createdAt < version.createdAt || version.strategy.currentVersion !== approval.version
    || version.strategy.status !== "activation_pending") throw new Error("STRATEGY_ACTIVATION_CONFLICT");
  const current = await readCheckoutBaseline(tx, merchantId);
  if (!current || checkoutContractHash(current) !== checkoutContractHash(contract.baseline)) throw new Error("STRATEGY_EXECUTION_BASELINE_CHANGED");
  if (!await tx.revenueAnalysisSchedule.findUnique({ where: { merchantId } })) throw new Error("STRATEGY_WEEKLY_OWNERSHIP_REQUIRED");
  if (await tx.promptExperiment.count({ where: { merchantId, status: "running" } })
    || await tx.strategyExecution.count({ where: { merchantId, status: { in: ["running", "paused"] } } })) {
    throw new Error("STRATEGY_EXECUTION_ALREADY_ACTIVE");
  }
  const review = contract.review;
  await tx.promptExperiment.create({ data: { id: review.experimentId, merchantId, name: `${review.name} (${review.experimentId})`,
    description: review.description, status: "running", startedAt: now,
    variants: { create: review.variants.map(v => ({ id: v.id, name: v.name, weight: v.weight,
      isControl: v.isControl, systemPrompt: v.systemPrompt, appliedRuleId: null })) },
    measurementPlan: { create: { planHash: review.planHash, plan: review.plan as unknown as Prisma.InputJsonValue, createdAt: now } } } });
  const execution = await tx.strategyExecution.create({ data: { id: randomUUID(), merchantId, strategyId: approval.strategyId,
    version: approval.version, approvalActionId: approval.id, experimentId: review.experimentId,
    proposalHash: version.proposalHash, contractHash: digest(contract), contract: contract as unknown as Prisma.InputJsonValue,
    status: "running", startedAt: now, endsAt: new Date(now.getTime() + review.plan.durationDays * 86_400_000) } });
  await tx.strategyExecutionEvent.create({ data: { id: randomUUID(), merchantId, executionId: execution.id,
    requestKey: `activation:${approval.id}`, actorId: approval.actorId, kind: "activated", occurredAt: now } });
  await tx.revenueStrategy.update({ where: { id: approval.strategyId }, data: { status: "active" } });
  return execution;
}

/** Called only in the same transaction that FIRST inserts the checkout session.
 * Caller holds the merchant lock before the insert. Never repairs enrollment
 * retrospectively from chat, order, an old session or a repeated start. */
export async function enrollCreatedStrategySession(tx: Tx, session: CheckoutSession, now: Date) {
  if (!strategyExecutionEnabled(session.merchantId) || session.cohort !== "treatment" || !session.globalUserId.trim()
    || (session.cart as Record<string, unknown>)?.currency !== "BRL" || session.promptVariantId
    || !Array.isArray(session.chatHistory) || session.chatHistory.length !== 0) return;
  const execution = await tx.strategyExecution.findFirst({ where: { merchantId: session.merchantId, status: "running",
    startedAt: { lte: now }, endsAt: { gt: now } } });
  if (!execution || session.createdAt < execution.startedAt || session.createdAt > now
    || !await lockRunningExperiment(tx, session.merchantId, execution.experimentId)) return;
  const contract = execution.contract as unknown as StrategyExecutionContract;
  if (digest(contract) !== execution.contractHash) throw new Error("STRATEGY_EXECUTION_CORRUPT");
  const earliest = await tx.checkoutSession.findFirst({ where: { merchantId: session.merchantId,
    globalUserId: session.globalUserId, cohort: "treatment", cart: { path: ["currency"], equals: "BRL" },
    createdAt: { gte: execution.startedAt, lt: execution.endsAt } }, orderBy: [{ createdAt: "asc" }, { sessionId: "asc" }] });
  if (earliest?.id !== session.id) return;
  const arm = strategyArm(contract, session.globalUserId);
  await tx.strategyAssignment.createMany({ data: [{ id: randomUUID(), merchantId: session.merchantId,
    executionId: execution.id, sessionId: session.sessionId, globalUserId: session.globalUserId,
    arm, variantId: arm === "control" ? contract.review.plan.controlVariantId : contract.review.plan.treatmentVariantId,
    assignedAt: now }], skipDuplicates: true });
}

export class StrategyExecutionLedger {
  constructor(private readonly prisma: PrismaClient, private readonly clock = executionClock) {}

  /** Admission is a one-use claim, not a replayable instruction. An uncertain
   * provider attempt must not be retried under the same key. No message text is stored. */
  async admitTurn(input: TurnInput) {
    input = structuredClone(input);
    if (input.route !== "primary_llm") return { status: "unavailable" as const };
    if (!strategyExecutionEnabled(input.merchantId)) return { status: "unavailable" as const };
    if (!/^[a-zA-Z0-9:_-]{1,150}$/.test(input.requestKey) || !/^[a-f0-9]{64}$/.test(input.inputHash)) throw new Error("STRATEGY_INVALID_TURN_KEY");
    return this.prisma.$transaction(async tx => {
      await lockCheckoutBaselineRows(tx, input.merchantId);
      await lockStrategySession(tx, input.merchantId, input.sessionId);
      const assignment = await tx.strategyAssignment.findUnique({ where: { merchantId_sessionId: {
        merchantId: input.merchantId, sessionId: input.sessionId } }, include: { execution: true, session: true, stop: true } });
      if (!assignment) return { status: "unavailable" as const };
      if (input.chatRequest) {
        if (process.env.REVENUE_STRATEGY_CHAT_PUBLICATION_ENABLED !== "true") return { status: "unavailable" as const };
        if (input.turn !== undefined) throw new Error("STRATEGY_CALLER_CONTEXT_UNSUPPORTED");
        const request = await tx.checkoutChatRequest.findFirst({ where: { id: input.chatRequest.requestId,
          merchantId: input.merchantId, sessionId: input.sessionId, requestHash: input.chatRequest.requestHash,
          conversationId: assignment.session.conversationId, status: "processing", protocolVersion: 2 } });
        if (!request || input.requestKey !== request.id || typeof input.userMessage !== "string"
          || digest(input.userMessage) !== input.inputHash || chatMessageTextHash(input.userMessage) !== request.buyerMessageHash) {
          throw new Error("STRATEGY_CHAT_REQUEST_CONFLICT");
        }
      }
      const existing = await tx.strategyTurn.findUnique({ where: { assignmentId_merchantId_requestKey: {
        assignmentId: assignment.id, merchantId: input.merchantId, requestKey: input.requestKey } } });
      if (existing) {
        if (existing.chatRequestId !== (input.chatRequest?.requestId ?? null)
          || (!input.chatRequest && existing.inputHash !== digest({ inputHash: input.inputHash, turn: input.turn }))) {
          throw new Error("STRATEGY_TURN_KEY_CONFLICT");
        }
        return { status: "already_admitted" as const, turnId: existing.id };
      }
      const { execution, session } = assignment;
      const now = await this.clock(tx);
      if (assignment.stop || execution.status !== "running" || now < execution.startedAt || now >= execution.endsAt
        || session.cohort !== "treatment" || session.globalUserId !== assignment.globalUserId
        || (session.cart as Record<string, unknown>)?.currency !== "BRL" || session.promptVariantId) return { status: "unavailable" as const };
      if (!await lockRunningExperiment(tx, input.merchantId, execution.experimentId)) return { status: "unavailable" as const };
      const contract = execution.contract as unknown as StrategyExecutionContract;
      if (digest(contract) !== execution.contractHash) throw new Error("STRATEGY_EXECUTION_CORRUPT");
      const current = await readCheckoutBaseline(tx, input.merchantId);
      if (!current) return { status: "unavailable" as const };
      let turn = input.turn;
      if (input.chatRequest) {
        const snapshot = toCheckoutSession(session);
        // Both the bindings and full context hash come from this locked row.
        // Request/DTO fields cannot override cart, stage, rules or buyer memory.
        try { turn = checkoutSessionPrompt(snapshot); }
        catch { return { status: "unavailable" as const }; }
        if (turn.stage === "data_collection" || (turn.stage === "shipping"
          && missingFieldsForStage(snapshot, "shipping").length > 0)) return { status: "unavailable" as const };
      }
      if (!turn) throw new Error("STRATEGY_TURN_CONTEXT_REQUIRED");
      const requestHash = digest({ inputHash: input.inputHash, turn,
        ...(input.chatRequest ? { contextSource: CHECKOUT_CHAT_BINDINGS_VERSION } : {}) });
      let systemPrompt: string;
      try { systemPrompt = renderStrategyTurn(contract, current, assignment.arm as "control" | "treatment", turn); }
      catch { return { status: "unavailable" as const }; }
      const row = await tx.strategyTurn.create({ data: { id: randomUUID(), merchantId: input.merchantId,
        assignmentId: assignment.id, requestKey: input.requestKey, inputHash: requestHash, promptHash: digest(systemPrompt),
        sessionContextHash: sessionContextHash(session), admittedAt: now,
        ...(input.chatRequest ? { chatRequestId: input.chatRequest.requestId, sessionContextVersion: session.strategyContextVersion,
          publicationPolicy: "text_only_no_personalization_v1" } : {}) } });
      return { status: "admitted" as const, turnId: row.id, systemPrompt, baseline: contract.baseline };
    });
  }

  // These states describe provider processing only. Buyer delivery requires its
  // own integration/receipt and is deliberately not expressible by this method.
  async recordProviderOutcome(merchantId: string, turnId: string, outcome: PinnedChatResult["outcome"]) {
    if (!["provider_completed", "provider_failed", "provider_unknown", "provider_not_dispatched"].includes(outcome)) throw new Error("STRATEGY_INVALID_TURN_OUTCOME");
    return this.prisma.$transaction(async tx => {
      await lockExecutionMerchant(tx, merchantId);
      const turn = await tx.strategyTurn.findFirst({ where: { id: turnId, merchantId }, include: { outcome: true } });
      if (!turn) throw new Error("STRATEGY_TURN_NOT_FOUND");
      if (turn.outcome) {
        if (turn.outcome.outcome !== outcome) throw new Error("STRATEGY_TURN_OUTCOME_CONFLICT");
        return turn.outcome;
      }
      return tx.strategyTurnOutcome.create({ data: { turnId, merchantId, outcome, recordedAt: await this.clock(tx) } });
    });
  }

  /** Atomic provider evidence and eligibility at recording time. Never persists
   * text, executes a tool or authorizes later delivery. A caller must perform a
   * new transactional check when persisting the actual buyer response. */
  async completeTurn(merchantId: string, turnId: string, provider: PinnedChatResult) {
    if (!["provider_completed", "provider_failed", "provider_unknown", "provider_not_dispatched"].includes(provider.outcome)) {
      throw new Error("STRATEGY_INVALID_TURN_OUTCOME");
    }
    const responseHash = provider.outcome === "provider_completed" ? digest(provider.result) : null;
    return this.prisma.$transaction(async tx => {
      await lockCheckoutBaselineRows(tx, merchantId);
      const turn = await tx.strategyTurn.findFirst({ where: { id: turnId, merchantId },
        include: { outcome: true, completion: true, assignment: { include: { execution: true } } } });
      if (!turn) throw new Error("STRATEGY_TURN_NOT_FOUND");
      if (turn.outcome && turn.outcome.outcome !== provider.outcome) throw new Error("STRATEGY_TURN_OUTCOME_CONFLICT");
      if (turn.completion) {
        if (turn.completion.responseHash !== responseHash) throw new Error("STRATEGY_TURN_RESPONSE_CONFLICT");
        return turn.completion;
      }
      const { assignment } = turn;
      const { execution } = assignment;
      await lockStrategySession(tx, merchantId, assignment.sessionId);
      const session = await tx.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: assignment.sessionId } } });
      const now = await this.clock(tx);
      const reason = provider.outcome !== "provider_completed" ? provider.outcome
        : await currentStrategyTurnReason(tx, turn, execution, session, now);
      if (!turn.outcome) await tx.strategyTurnOutcome.create({ data: { turnId, merchantId, outcome: provider.outcome, recordedAt: now } });
      return tx.strategyTurnCompletion.create({ data: { turnId, merchantId, responseHash, reason,
        decision: reason === "current_at_recording" ? "eligible_at_recording" : "suppressed", recordedAt: now } });
    });
  }

  /** Stop is terminal. Pause has no implicit resume and never extends the horizon. */
  async stop(input: { merchantId: string; executionId: string; actorId: string; requestKey: string; kind: "paused" | "stopped" }) {
    if (!input.actorId?.trim() || !/^[a-zA-Z0-9:_-]{1,150}$/.test(input.requestKey)
      || !["paused", "stopped"].includes(input.kind)) throw new Error("STRATEGY_INVALID_STOP");
    return this.prisma.$transaction(async tx => {
      await lockExecutionMerchant(tx, input.merchantId);
      const execution = await tx.strategyExecution.findFirst({ where: { id: input.executionId, merchantId: input.merchantId } });
      if (!execution) throw new Error("STRATEGY_EXECUTION_NOT_FOUND");
      const previous = await tx.strategyExecutionEvent.findUnique({ where: { executionId_merchantId_requestKey: {
        executionId: input.executionId, merchantId: input.merchantId, requestKey: input.requestKey } } });
      if (previous) {
        if (previous.actorId !== input.actorId || previous.kind !== input.kind) throw new Error("STRATEGY_STOP_KEY_CONFLICT");
        return previous;
      }
      if (execution.status === "stopped" || (execution.status === "paused" && input.kind === "paused")) throw new Error("STRATEGY_STOP_CONFLICT");
      const now = await this.clock(tx);
      const firstStop = execution.stoppedAt ?? now;
      await tx.strategyExecution.update({ where: { id: execution.id }, data: { status: input.kind, stoppedAt: firstStop } });
      await tx.promptExperiment.update({ where: { id: execution.experimentId }, data: { status: "completed", completedAt: firstStop } });
      await tx.revenueStrategy.update({ where: { id: execution.strategyId }, data: { status: input.kind } });
      return tx.strategyExecutionEvent.create({ data: { ...input, id: randomUUID(), occurredAt: now } });
    });
  }
}
