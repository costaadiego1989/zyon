import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, CheckoutSession } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { checkoutContractHash } from "../../checkout/domain/services/checkout-chat-baseline.js";
import { executionContract, renderStrategyTurn, strategyArm, strategyExecutionEnabled, type StrategyExecutionContract } from "../domain/strategy-execution.js";
import type { StrategyProposal } from "../domain/strategy-proposal.js";
import { lockCheckoutBaselineRows, readCheckoutBaseline } from "./checkout-baseline.reader.js";

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
  async admitTurn(input: { merchantId: string; sessionId: string; requestKey: string; inputHash: string;
    route: "primary_llm" | "deterministic" | "fallback"; turn: Parameters<typeof renderStrategyTurn>[3] }) {
    if (input.route !== "primary_llm") return { status: "unavailable" as const };
    if (!strategyExecutionEnabled(input.merchantId)) return { status: "unavailable" as const };
    if (!/^[a-zA-Z0-9:_-]{1,150}$/.test(input.requestKey) || !/^[a-f0-9]{64}$/.test(input.inputHash)) throw new Error("STRATEGY_INVALID_TURN_KEY");
    return this.prisma.$transaction(async tx => {
      await lockCheckoutBaselineRows(tx, input.merchantId);
      const assignment = await tx.strategyAssignment.findUnique({ where: { merchantId_sessionId: {
        merchantId: input.merchantId, sessionId: input.sessionId } }, include: { execution: true, session: true, stop: true } });
      if (!assignment) return { status: "unavailable" as const };
      const requestHash = digest({ inputHash: input.inputHash, turn: input.turn });
      const existing = await tx.strategyTurn.findUnique({ where: { assignmentId_merchantId_requestKey: {
        assignmentId: assignment.id, merchantId: input.merchantId, requestKey: input.requestKey } } });
      if (existing) {
        if (existing.inputHash !== requestHash) throw new Error("STRATEGY_TURN_KEY_CONFLICT");
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
      let systemPrompt: string;
      try { systemPrompt = renderStrategyTurn(contract, current, assignment.arm as "control" | "treatment", input.turn); }
      catch { return { status: "unavailable" as const }; }
      const row = await tx.strategyTurn.create({ data: { id: randomUUID(), merchantId: input.merchantId,
        assignmentId: assignment.id, requestKey: input.requestKey, inputHash: requestHash, promptHash: digest(systemPrompt), admittedAt: now } });
      return { status: "admitted" as const, turnId: row.id, systemPrompt, baseline: contract.baseline };
    });
  }

  // These states describe provider processing only. Buyer delivery requires its
  // own integration/receipt and is deliberately not expressible by this method.
  async recordProviderOutcome(merchantId: string, turnId: string, outcome: "provider_completed" | "provider_failed" | "provider_unknown") {
    if (!["provider_completed", "provider_failed", "provider_unknown"].includes(outcome)) throw new Error("STRATEGY_INVALID_TURN_OUTCOME");
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
