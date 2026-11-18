import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, ServiceAppointment } from "@prisma/client";
import { assertServiceAdministration, type ServiceActor } from "../../../shared/bookings/service-business-access.js";
import { lockCatalogMerchant } from "../../../shared/persistence/catalog-stock-ledger.js";
import { lockServiceProfessional } from "../../../shared/bookings/service-professional-lock.js";
import { assertExpectedVersion } from "../../catalog/domain/services/service-professional-input.js";
import { admitWhatsAppEffectInTransaction } from "../../../shared/whatsapp/whatsapp-automation-context.js";
import { readCanonicalPublicBusinessSourcesWithin } from "../../graph-rag/infrastructure/prisma-public-business.sources.js";
import { PUBLIC_POLICY_LABELS } from "../../knowledge-base/domain/public-knowledge-content.js";
import { findAppointmentLeaseWithin } from "../../../shared/bookings/appointment-lease-proof.js";
import { SERVICE_APPOINTMENT_HOLD_CLEANUP } from "./service-appointment-hold-cleanup.consumer.js";
import type { PublicBusinessSourceProjection } from "../../graph-rag/domain/public-business-source.js";

export interface CancelServiceAppointmentCommand {
  appointmentId: string;
  expectedVersion: number;
  commandId: string;
  requestMessageId?: string;
  /** Authenticated human request, not a buyer message or WhatsApp intake. */
  operatorRequestId?: string;
  /** Internal hash of the canonical public policy view shown to the operator. */
  policyHash: string;
}
interface CancellationContext { /** Server/test seam, never a body timestamp. */ clock?: () => Date }
type PolicyReference = Pick<PublicBusinessSourceProjection, "sourceId" | "sourceVersion" | "sourceHash" | "publicationState">;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown) => typeof value === "string" && value.trim() === value && !!value && value.length <= 191;

/** Internal already-authorized, transaction-bound reader for the operator view
 * and final decision. Existing public formatter/IDs only; no index/LLM/URL IO.
 * Withdrawn entries explicitly record missing policy; text is never interpreted. */
export async function readCancellationPoliciesWithin(tx: Prisma.TransactionClient, merchantId: string) {
  const ids = Object.keys(PUBLIC_POLICY_LABELS).sort();
  const sources = await readCanonicalPublicBusinessSourcesWithin(tx, merchantId, ids.map(sourceId => ({ sourceType: "policy", sourceId })));
  if (sources.length !== ids.length) throw new ServiceUnavailableException("service_cancellation_policy_unavailable");
  const references: PolicyReference[] = sources.map((source, index) => {
    if (!source || source.merchantId !== merchantId || source.sourceType !== "policy" || source.sourceId !== ids[index])
      throw new ServiceUnavailableException("service_cancellation_policy_unavailable");
    return { sourceId: source.sourceId, sourceVersion: source.sourceVersion, sourceHash: source.sourceHash, publicationState: source.publicationState };
  });
  return { references, hash: hash(["service-cancellation-policy-view-v1", merchantId, references]),
    policies: references.map((reference, index) => ({ ...reference, text: sources[index]!.publicationState === "published" ? sources[index]!.text : null })) };
}

function validate(input: CancelServiceAppointmentCommand) {
  if (!object(input) || Object.keys(input).some(key => !["appointmentId", "expectedVersion", "commandId", "requestMessageId", "operatorRequestId", "policyHash"].includes(key))
    || !id(input.appointmentId) || !id(input.commandId)
    || input.requestMessageId !== undefined && !id(input.requestMessageId)
    || input.operatorRequestId !== undefined && !id(input.operatorRequestId)
    || id(input.requestMessageId) === id(input.operatorRequestId)
    || typeof input.policyHash !== "string" || !/^[a-f0-9]{64}$/.test(input.policyHash))
    throw new BadRequestException("service_cancellation_command_invalid");
  assertExpectedVersion(input.expectedVersion);
}

async function financialFacts(tx: Prisma.TransactionClient, appointment: ServiceAppointment) {
  const facts = await tx.appointmentPayment.findMany({ where: { merchantId: appointment.merchantId, appointmentId: appointment.id },
    select: { id: true, mode: true, status: true, amountCents: true, currency: true, version: true,
      requiresRegularization: true, regularizationReason: true }, orderBy: { id: "asc" }, take: 101 });
  if (facts.length > 100) throw new ServiceUnavailableException("service_cancellation_financial_facts_limit");
  // Stored independent facts only. No providerEvidence, refund request or
  // inference that operational cancellation moved/returned any money.
  return facts;
}

/** Explicit human command, not buyer/LLM cancellation and not Order cancellation.
 * The entrypoint owns the default transaction; callers of Within must roll back
 * every rejection. No model/network/provider/Redis request belongs inside it. */
export async function cancelServiceAppointmentWithin(tx: Prisma.TransactionClient, actor: ServiceActor,
  input: CancelServiceAppointmentCommand, context: CancellationContext = {}) {
  if (typeof (tx as unknown as { $transaction?: unknown }).$transaction === "function")
    throw new BadRequestException("service_cancellation_transaction_required");
  validate(input);
  input = { ...input }; // Preserve original request identity across awaits.
  await admitWhatsAppEffectInTransaction(tx, actor.merchantId);
  await lockCatalogMerchant(tx, actor.merchantId);
  await assertServiceAdministration(tx, actor);
  const selected = await tx.serviceAppointment.findFirst({ where: { id: input.appointmentId, merchantId: actor.merchantId },
    select: { professionalId: true } });
  if (!selected) throw new NotFoundException("service_appointment_not_found");
  await lockServiceProfessional(tx, actor.merchantId, selected.professionalId);
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM service_appointments
    WHERE id = ${input.appointmentId} AND merchant_id = ${actor.merchantId} FOR UPDATE`;
  if (locked.length !== 1) throw new NotFoundException("service_appointment_not_found");
  const appointment = await tx.serviceAppointment.findFirst({ where: { id: input.appointmentId, merchantId: actor.merchantId } });
  if (!appointment || appointment.professionalId !== selected.professionalId) throw new ConflictException("service_appointment_version_conflict");
  const fingerprint = hash(["service-cancellation-command-v1", actor.merchantId, actor.userId, input.appointmentId,
    input.expectedVersion, input.requestMessageId ?? null, input.operatorRequestId ?? null, input.policyHash]);
  const prior = await tx.appointmentAudit.findUnique({ where: { merchantId_commandId: { merchantId: actor.merchantId, commandId: input.commandId } } });
  if (prior) {
    const receipt = prior.after;
    if (prior.appointmentId !== appointment.id || prior.actorId !== actor.userId || prior.action !== "cancel"
      || prior.version !== input.expectedVersion + 1 || !object(receipt) || receipt.version !== prior.version
      || receipt.requestFingerprint !== fingerprint || appointment.version < prior.version)
      throw new ConflictException("service_appointment_idempotency_conflict");
    return { appointment, replayed: true, appliedVersion: prior.version, financialFacts: await financialFacts(tx, appointment) };
  }
  if (appointment.version !== input.expectedVersion) throw new ConflictException("service_appointment_version_conflict");
  // New canonical cancellation edge; no actionsForUnit/Order alias exists.
  // Preserve completed/no_show outcomes. cancelled accepts only the receipt
  // replay above. No scheduled-start cutoff or payment/proof guard is imported.
  if (!["pending", "scheduled", "in_service"].includes(appointment.operationalStatus))
    throw new ConflictException("service_cancellation_state_conflict");
  let handoff: Prisma.InputJsonObject;
  if (input.operatorRequestId) {
    // The authenticated operator is the author of this request. Do not claim
    // a buyer utterance, external delivery or an intake that does not exist.
    handoff = { kind: "operator_request", requestId: input.operatorRequestId, operatorId: actor.userId, originalChannel: appointment.origin };
  } else {
    if (!appointment.buyerGlobalUserId) throw new NotFoundException("service_cancellation_request_not_found");
    const request = await tx.supportTicketMessage.findFirst({ where: { id: input.requestMessageId, senderType: "buyer",
      ticket: { merchantId: actor.merchantId, buyerId: appointment.buyerGlobalUserId, source: "whatsapp" } }, include: { ticket: true } });
    const metadata = request?.metadata;
    if (!request || !object(metadata) || metadata.kind !== "whatsapp_intake" || metadata.schemaVersion !== 1
      || metadata.appointmentId !== appointment.id || metadata.policyVersion !== appointment.policyVersion)
      throw new NotFoundException("service_cancellation_request_not_found");
    handoff = { kind: "buyer_handoff", ticketId: request.ticket.id, requestMessageId: request.id, bookedPolicyVersion: appointment.policyVersion };
  }
  const policies = await readCancellationPoliciesWithin(tx, actor.merchantId);
  if (policies.hash !== input.policyHash) throw new ConflictException("service_cancellation_policy_changed");
  const facts = await financialFacts(tx, appointment);
  const binding = await findAppointmentLeaseWithin(tx, appointment);
  if (!binding && object(appointment.policySnapshot) && appointment.policySnapshot.holdEnabled === true)
    throw new ConflictException("service_hold_original_proof_required");
  const cleanup = binding?.capture.kind === "owned" ? { originalAuditId: binding.auditId } : undefined;
  const now = context.clock ? context.clock() : new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new BadRequestException("service_cancellation_clock_invalid");
  const version = input.expectedVersion + 1;
  const changed = await tx.serviceAppointment.updateMany({ where: { id: appointment.id, merchantId: actor.merchantId,
    version: input.expectedVersion, operationalStatus: appointment.operationalStatus },
    data: { operationalStatus: "cancelled", cancelledAt: now, version: { increment: 1 }, updatedAt: now } });
  if (changed.count !== 1) throw new ConflictException("service_appointment_version_conflict");
  // Existing optional compatibility projection only, never an Order authority.
  // No broad resource/professional/session release and no physical restock.
  await tx.serviceReservation.updateMany({ where: { merchantId: actor.merchantId, appointmentId: appointment.id, status: "reserved" },
    data: { status: "cancelled" } });
  await tx.appointmentAudit.create({ data: { merchantId: actor.merchantId, appointmentId: appointment.id,
    commandId: input.commandId, version, action: "cancel", actorId: actor.userId, origin: "operator", occurredAt: now,
    before: { operationalStatus: appointment.operationalStatus, version: appointment.version },
    after: { operationalStatus: "cancelled", version, requestFingerprint: fingerprint,
      handoff, ...(cleanup ? { privateLeaseCleanup: cleanup } : {}),
      publicPolicies: policies.references } } });
  const eventType = "service.appointment.cancelled", eventId = hash([actor.merchantId, appointment.id, version, eventType]);
  await tx.outboxMessage.create({ data: { eventId, eventType, schemaVersion: 1, merchantId: actor.merchantId, occurredAt: now,
    correlationId: appointment.id, causationId: input.commandId, producer: "service-booking",
    payload: { appointmentId: appointment.id, version, operationalStatus: "cancelled" } } });
  if (cleanup) await tx.outboxMessage.create({ data: {
    eventId: hash([actor.merchantId, appointment.id, version, SERVICE_APPOINTMENT_HOLD_CLEANUP]),
    eventType: SERVICE_APPOINTMENT_HOLD_CLEANUP, schemaVersion: 1, merchantId: actor.merchantId, occurredAt: now,
    correlationId: appointment.id, causationId: input.commandId, producer: "service-booking-private",
    payload: { originalAuditId: cleanup.originalAuditId, appointmentId: appointment.id, cancelVersion: version },
  } });
  const current = await tx.serviceAppointment.findFirst({ where: { id: appointment.id, merchantId: actor.merchantId } });
  if (!current || current.version !== version || current.operationalStatus !== "cancelled") throw new ConflictException("service_appointment_version_conflict");
  return { appointment: current, replayed: false, appliedVersion: version, financialFacts: facts };
}

export class CancelServiceAppointmentUseCase {
  constructor(private readonly prisma: PrismaClient) {}
  policies(actor: ServiceActor, appointmentId: string) {
    if (!id(appointmentId)) throw new BadRequestException("service_cancellation_command_invalid");
    return this.prisma.$transaction(async tx => {
      await lockCatalogMerchant(tx, actor.merchantId); await assertServiceAdministration(tx, actor);
      const appointment = await tx.serviceAppointment.findFirst({ where: { id: appointmentId, merchantId: actor.merchantId }, select: { id: true } });
      if (!appointment) throw new NotFoundException("service_appointment_not_found");
      return readCancellationPoliciesWithin(tx, actor.merchantId);
    });
  }
  execute(actor: ServiceActor, input: CancelServiceAppointmentCommand, context: CancellationContext = {}) {
    return this.prisma.$transaction(tx => cancelServiceAppointmentWithin(tx, actor, input, context));
  }
}
