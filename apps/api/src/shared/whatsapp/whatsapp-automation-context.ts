import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import type { OriginalAiAuthority } from "../../modules/whatsapp-channel/domain/services/whatsapp-ai-authority.js";
import type { WhatsAppHumanNotice } from "../../modules/whatsapp-channel/application/services/whatsapp-human-intake.service.js";

export type WhatsAppRequestScope =
  | { kind: "model"; merchantId: string }
  | { kind: "payment"; merchantId: string; intentId?: string; sessionId?: string; creationLeaseToken?: string }
  | { kind: "whatsapp"; merchantId: string; configId: string; deviceId: string; provider: string;
      accountId: string | null; recipient?: string; mediaId?: string; messageId?: string; credentialDigest?: string };
export interface WhatsAppExecution {
  authority: Readonly<OriginalAiAuthority>;
  notice?: Readonly<WhatsAppHumanNotice>;
  admitEffect(tx: Prisma.TransactionClient, merchantId: string): Promise<void>;
  admitDelivery(tx: Prisma.TransactionClient, merchantId: string): Promise<void>;
  startRequest<T>(scope: WhatsAppRequestScope, start: () => Promise<T>): Promise<T>;
}
const executions = new AsyncLocalStorage<Readonly<WhatsAppExecution> | undefined>();
/** Internal human/notice submission capability. Its factory must prove the
 * original durable command and dispatch lease; no DTO can supply callbacks. */
export interface WhatsAppSubmission {
  readonly requestScope: Readonly<Extract<WhatsAppRequestScope, { kind: "whatsapp" }>>;
  startRequest<T>(scope: Extract<WhatsAppRequestScope, { kind: "whatsapp" }>, start: () => Promise<T>): Promise<T>;
}
const submissions = new AsyncLocalStorage<Readonly<WhatsAppSubmission> | undefined>();
export class WhatsAppSubmissionSuppressedError extends Error {
  constructor() { super("whatsapp_submission_suppressed"); }
}
export function currentWhatsAppSubmissionScope(): WhatsAppSubmission["requestScope"] | undefined { return submissions.getStore()?.requestScope; }
export function withWhatsAppSubmission<T>(frame: WhatsAppSubmission, run: () => T): T {
  if (!frame || !frame.requestScope || frame.requestScope.kind !== "whatsapp" || !Object.isFrozen(frame.requestScope)
    || typeof frame.startRequest !== "function" || executions.getStore()) throw new WhatsAppSubmissionSuppressedError();
  const parent = submissions.getStore();
  if (parent && parent !== frame) throw new WhatsAppSubmissionSuppressedError();
  return parent === frame ? run() : submissions.run(Object.freeze(frame), run);
}

type PaymentCreationScope = { kind: "payment"; merchantId: string; intentId: string; sessionId: string; creationLeaseToken: string };
const paymentCreations = new AsyncLocalStorage<Readonly<PaymentCreationScope> | undefined>();

export class WhatsAppAiSuppressedError extends Error {
  constructor() { super("whatsapp_ai_turn_suppressed"); }
}

export function currentWhatsAppExecution(): Readonly<WhatsAppExecution> | undefined { return executions.getStore(); }

/** Server capability built by the canonical fence, never a buyer/model DTO.
 * Nested work cannot replace it with a freshly captured epoch or callbacks. */
export function withWhatsAppExecution<T>(frame: WhatsAppExecution, run: () => T): T {
  if (submissions.getStore() || !frame || !frame.authority || typeof frame.authority !== "object" || !Object.isFrozen(frame.authority)
    || typeof frame.admitEffect !== "function" || typeof frame.admitDelivery !== "function" || typeof frame.startRequest !== "function")
    throw new Error("whatsapp_execution_invalid");
  const parent = executions.getStore();
  if (parent && parent !== frame) throw new Error("whatsapp_execution_replace_forbidden");
  if (parent === frame) return run();
  return executions.run(Object.freeze(frame), run);
}

/** Only a verified canonical server handler calls this after its own payment,
 * order or booking proof. There is deliberately no origin flag argument.
 * ALS.run keeps inline event-bus siblings and the caller's frame unchanged. */
export function withoutWhatsAppExecutionForVerifiedOperation<T>(run: () => T): T {
  return submissions.run(undefined, () => paymentCreations.run(undefined, () => executions.run(undefined, run)));
}

/** Call at the beginning of the actual writer transaction, before merchant,
 * professional, checkout/cart/buyer locks. An outer mutex cannot enlist a
 * root client's separate transaction. Non-WhatsApp flows remain unchanged. */
export async function admitWhatsAppEffectInTransaction(tx: Prisma.TransactionClient, merchantId: string): Promise<void> {
  if (submissions.getStore()) throw new WhatsAppSubmissionSuppressedError();
  const frame = executions.getStore();
  if (!frame) return;
  if (typeof Reflect.get(tx, "$transaction") === "function") throw new Error("whatsapp_effect_transaction_required");
  await frame.admitEffect(tx, merchantId);
}

/** Durable response capture has its own capability: a verified handoff notice
 * may be persisted/sent, but that cannot authorize a cart or checkout tool. */
export async function admitWhatsAppDeliveryInTransaction(tx: Prisma.TransactionClient, merchantId: string): Promise<void> {
  if (submissions.getStore()) throw new WhatsAppSubmissionSuppressedError();
  const frame = executions.getStore();
  if (!frame) return;
  if (typeof Reflect.get(tx, "$transaction") === "function") throw new Error("whatsapp_effect_transaction_required");
  await frame.admitDelivery(tx, merchantId);
}

/** Enlist a direct repository write only when invoked by a WhatsApp turn.
 * The callback receives the real transaction client and cannot open another
 * transaction through this port. Existing non-WhatsApp writes stay unchanged. */
export function withWhatsAppEffectTransaction<T>(prisma: import("@prisma/client").PrismaClient, merchantId: string | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (submissions.getStore()) throw new WhatsAppSubmissionSuppressedError();
  const frame = executions.getStore();
  if (!frame) return work(prisma);
  return prisma.$transaction(async tx => {
    await admitWhatsAppEffectInTransaction(tx, merchantId ?? frame.authority.merchantId);
    return work(tx);
  });
}

/** Adapters call at actual request initiation after asynchronous preparation.
 * The fence owns the synchronous start/commit/unknown distinction. */
export function startWhatsAppRequest<T>(scope: WhatsAppRequestScope, start: () => Promise<T>): Promise<T> {
  const submission = submissions.getStore();
  if (submission) {
    if (scope.kind !== "whatsapp") throw new WhatsAppSubmissionSuppressedError();
    return submission.startRequest(scope, start);
  }
  const frame = executions.getStore();
  return frame ? frame.startRequest(scope, start) : start();
}

/** Installed only from the durable creation claim, not provider/customer DTOs.
 * Final adapter requests inherit its original exact lease across preparation. */
export function withWhatsAppPaymentCreation<T>(scope: Omit<PaymentCreationScope, "kind">, run: () => T): T {
  if (submissions.getStore()) throw new WhatsAppSubmissionSuppressedError();
  if (!executions.getStore()) return run();
  if (![scope.merchantId, scope.intentId, scope.sessionId, scope.creationLeaseToken].every(value => typeof value === "string" && value.trim()))
    throw new WhatsAppAiSuppressedError();
  const parent = paymentCreations.getStore();
  if (parent && (parent.intentId !== scope.intentId || parent.creationLeaseToken !== scope.creationLeaseToken || parent.merchantId !== scope.merchantId))
    throw new WhatsAppAiSuppressedError();
  return paymentCreations.run(Object.freeze({ kind: "payment", merchantId: scope.merchantId,
    intentId: scope.intentId, sessionId: scope.sessionId, creationLeaseToken: scope.creationLeaseToken }), run);
}

export function startWhatsAppPaymentRequest<T>(merchantId: string, start: () => Promise<T>): Promise<T> {
  const claim = paymentCreations.getStore();
  if (claim && claim.merchantId !== merchantId) throw new WhatsAppAiSuppressedError();
  return startWhatsAppRequest(claim ?? { kind: "payment", merchantId }, start);
}
