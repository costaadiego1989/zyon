import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type { TenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import { canonicalJson } from "../../../shared/http/canonical-json.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { admitWhatsAppEffectInTransaction } from "../../../shared/whatsapp/whatsapp-automation-context.js";
import { appendOutboxInTransaction } from "../../../shared/messaging/infrastructure/append-outbox-in-transaction.js";
import { WhatsAppOperatorAuthorizationError } from "../../whatsapp-channel/domain/services/whatsapp-operator-authorization.js";
import { initialResumeDelivery, prepareWhatsAppClose, whatsappResumeDeliveryId, WHATSAPP_RESUME_REQUESTED, WHATSAPP_RESUME_TEXT, type WhatsAppResumeAuthority } from "../../whatsapp-channel/domain/services/whatsapp-resume-command.js";
import { whatsappE164 } from "../../whatsapp-channel/domain/services/whatsapp-phone.js";
import { twilioAuthorityAccountId } from "../../whatsapp-channel/domain/services/connected-twilio-credentials.js";
import { decodeWhatsAppCredentials } from "../../whatsapp-channel/infrastructure/repositories/whatsapp-credential-codec.js";
import { PrismaWhatsAppHandoffRepository } from "../../whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js";
import { appendSupportEvent, lockSupportResource, persistSupportMessage } from "./support-persistence.js";
import { readOperatorDeliveryProjection } from "../../whatsapp-channel/application/services/whatsapp-support-message-state.js";
import { operatorConnection } from "../../whatsapp-channel/domain/services/whatsapp-operator-connection.js";

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const storedId = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);

/** UNEXECUTED cache candidate. All mutations share the retained session/support
 * transaction. Delivery is a new durable resumed-notice purpose, not a55human
 * operator message, provider callback, AI turn or invented webhook inbox. */
@Injectable()
export class CloseWhatsAppConversationUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient, private readonly handoffs: PrismaWhatsAppHandoffRepository) {}

  async execute(principal: TenantPrincipal, ticketId: string, input: unknown) {
    if (principal.kind !== "human" || !["owner", "admin", "staff"].includes(principal.role)) throw new ForbiddenException("human_operator_required");
    if (typeof ticketId !== "string" || !ticketId.trim() || ticketId.length > 191 || !input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some(key => !["expectedEpoch", "status"].includes(key))) throw new BadRequestException("invalid_whatsapp_close");
    const expectedEpoch: unknown = Reflect.get(input, "expectedEpoch"), status = Reflect.get(input, "status") ?? "closed";
    if (typeof expectedEpoch !== "number" || !Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0 || expectedEpoch > 2_147_483_647
      || status !== "closed" && status !== "resolved") throw new BadRequestException("invalid_whatsapp_close");
    const merchantId = principal.tenantId;
    const candidate = await this.prisma.whatsAppHandoffBinding.findFirst({ where: { merchantId, ticketId } });
    if (!candidate) throw new NotFoundException("whatsapp_handoff_ticket_not_found");
    const scope = { merchantId, configId: candidate.configId, whatsappSessionId: candidate.whatsappSessionId };
    try {
      return await this.handoffs.withReadLock(scope, async (tx, locked) => {
        await admitWhatsAppEffectInTransaction(tx, merchantId);
        const current = locked.binding;
        if (!current || current.id !== candidate.id || current.ticketId !== ticketId) throw new NotFoundException("whatsapp_handoff_ticket_not_found");
        await lockSupportResource(tx, "support:" + ticketId);
        const ticket = await tx.supportTicket.findFirst({ where: { id: ticketId, merchantId, sessionId: scope.whatsappSessionId, source: "whatsapp", mergedIntoId: null } });
        if (!ticket) throw new NotFoundException("whatsapp_handoff_ticket_not_found");
        await tx.$queryRaw`SELECT id FROM merchant_users WHERE id=${principal.userId} AND merchant_id=${merchantId} FOR SHARE`;
        const member = await tx.merchantUser.findFirst({ where: { id: principal.userId, merchantId } });
        if (!member || member.disabledAt !== null || !["owner", "admin", "staff"].includes(member.role.toLowerCase()))
          throw new ForbiddenException("human_operator_required");
        const plan = prepareWhatsAppClose(scope, current, ticket, principal, expectedEpoch, status);
        const deliveryId = whatsappResumeDeliveryId(current.id, plan.epoch);
        if (plan.replay) {
          const row = await tx.whatsAppDelivery.findUnique({ where: { id: deliveryId } }), saved = record(row?.response), authority = record(saved.authority), projection = readOperatorDeliveryProjection(saved.delivery);
          const message = typeof saved.messageId === "string" ? await tx.supportTicketMessage.findFirst({ where: { id: saved.messageId, ticketId, senderType: "system" } }) : null;
          const metadata = record(message?.metadata), event = typeof saved.outboxEventId === "string" ? await tx.outboxMessage.findFirst({ where: { eventId: saved.outboxEventId, merchantId } }) : null;
          const payload = { messageId: message?.id, ticketId, bindingId: current.id, previousEpoch: plan.previousEpoch, epoch: plan.epoch };
          if (!row || row.id !== deliveryId || row.merchantId !== merchantId || row.configId !== scope.configId || row.deviceId !== locked.session.deviceId
            || saved.purpose !== "human_resume" || saved.schemaVersion !== 1 || saved.ticketId !== ticketId || saved.status !== status
            || saved.contentHash !== createHash("sha256").update(WHATSAPP_RESUME_TEXT).digest("hex")
            || authority.merchantId !== merchantId || authority.configId !== scope.configId || authority.whatsappSessionId !== scope.whatsappSessionId
            || authority.bindingId !== current.id || authority.ticketId !== ticketId || authority.operatorId !== principal.userId
            || authority.previousEpoch !== plan.previousEpoch || authority.epoch !== plan.epoch
            || !storedId(authority.deviceId) || authority.deviceId !== row.deviceId
            || authority.identityStatus !== "available" && authority.identityStatus !== "unavailable"
            || authority.identityStatus === "available" && (!storedId(authority.accountId)
              || typeof authority.recipient !== "string" || whatsappE164(authority.recipient) !== authority.recipient)
            || authority.identityStatus === "unavailable" && (authority.accountId !== null && !storedId(authority.accountId)
              || authority.recipient !== null && (typeof authority.recipient !== "string" || whatsappE164(authority.recipient) !== authority.recipient)
              || row.state !== "failed" || row.processingToken !== "not_started" || projection?.status !== "failed"
              || projection.errorCode !== "channel_identity_unavailable" || projection.revision !== 0 || saved.submission !== undefined)
            || authority.provider !== "META_CLOUD" && authority.provider !== "TWILIO" && authority.provider !== "BUBBLEWHATS"
            || !message || message.content !== WHATSAPP_RESUME_TEXT || metadata.kind !== "whatsapp_resume" || metadata.schemaVersion !== 1
            || metadata.bindingId !== current.id || metadata.configId !== scope.configId || metadata.whatsappSessionId !== scope.whatsappSessionId
            || metadata.previousEpoch !== plan.previousEpoch || metadata.epoch !== plan.epoch || metadata.operatorId !== principal.userId
            || !event || event.eventType !== WHATSAPP_RESUME_REQUESTED || event.schemaVersion !== 1 || event.producer !== "support"
            || event.correlationId !== deliveryId || event.causationId !== message.id || canonicalJson(event.payload) !== canonicalJson(payload)
            || !projection || canonicalJson(saved.delivery) !== canonicalJson(projection) || canonicalJson(metadata.delivery) !== canonicalJson(projection)
            || row.providerMessageId !== projection.providerMessageId)
            throw new ConflictException("whatsapp_resume_original_command_required");
          return { bindingId: current.id, ...scope, ticketId, mode: "ai" as const, epoch: plan.epoch, status, idempotent: true,
            resume: { messageId: message.id, status: String(projection.status) } };
        }
        if (ticket.returnId) {
          const ret = await tx.return.findFirst({ where: { id: ticket.returnId, merchantId } });
          if (ret && !["REFUND_COMPLETED", "EXCHANGE_COMPLETED", "REJECTED", "CANCELLED"].includes(ret.status)) throw new ConflictException("resolve_return_before_closing_ticket");
        }
        // A broken/unavailable channel cannot undo the operator's close. Its
        // fixed no-start disposition never becomes a later account grant.
        let credentials: Record<string, unknown>;
        try { credentials = decodeWhatsAppCredentials(record(locked.config.credentials)); }
        catch { credentials = {}; }
        const candidateAccount = locked.config.provider === "META_CLOUD" ? credentials.phoneNumberId : locked.config.provider === "TWILIO"
          ? twilioAuthorityAccountId({ ...locked.config, credentials }) : undefined;
        const account = storedId(candidateAccount) ? candidateAccount : null;
        const recipient = whatsappE164(locked.session.buyerPhone);
        const senderConfig = { ...locked.config, credentials, whatsappNumber: locked.config.whatsappNumber ?? undefined,
          deviceId: locked.config.deviceId ?? undefined, phoneNumber: locked.config.phoneNumber ?? undefined,
          webhookSecret: locked.config.webhookSecret ?? undefined, connectedAt: locked.config.connectedAt ?? undefined };
        const identityStatus = account && recipient && operatorConnection(senderConfig, { ...scope,
          deviceId: locked.session.deviceId, provider: locked.config.provider, recipient, accountId: account }).kind === "ready" ? "available" : "unavailable";
        const changed = await tx.whatsAppHandoffBinding.updateMany({ where: { id: current.id, ...scope, ticketId,
          mode: "human", epoch: current.epoch, assignedOperatorId: principal.userId }, data: { mode: "ai", epoch: plan.epoch, assignedOperatorId: null } });
        if (changed.count !== 1) throw new ConflictException("whatsapp_handoff_epoch_conflict");
        const closed = await tx.supportTicket.updateMany({ where: { id: ticketId, merchantId, source: "whatsapp", sessionId: scope.whatsappSessionId,
          status: "in_progress", assignedTo: principal.userId, mergedIntoId: null }, data: { status, resolvedAt: new Date() } });
        if (closed.count !== 1) throw new ConflictException("whatsapp_conversation_unavailable");
        const delivery = initialResumeDelivery(identityStatus);
        const message = await persistSupportMessage(tx, { id: randomUUID(), ticketId, merchantId, senderType: "system", content: WHATSAPP_RESUME_TEXT,
          metadata: { kind: "whatsapp_resume", schemaVersion: 1, bindingId: current.id, configId: scope.configId, whatsappSessionId: scope.whatsappSessionId,
            previousEpoch: plan.previousEpoch, epoch: plan.epoch, operatorId: principal.userId, delivery } });
        const authority: WhatsAppResumeAuthority = { ...scope, bindingId: current.id, ticketId, operatorId: principal.userId,
          previousEpoch: plan.previousEpoch, epoch: plan.epoch, deviceId: locked.session.deviceId, provider: locked.config.provider, recipient, accountId: account, identityStatus };
        const outboxEventId = randomUUID();
        await tx.whatsAppDelivery.create({ data: { id: deliveryId, merchantId, configId: scope.configId, deviceId: locked.session.deviceId,
          state: delivery.status, processingToken: "not_started", response: { purpose: "human_resume", schemaVersion: 1, outboxEventId, messageId: message.id,
            ticketId, status, contentHash: createHash("sha256").update(WHATSAPP_RESUME_TEXT).digest("hex"), authority: { ...authority }, delivery } } });
        await appendOutboxInTransaction(tx, { event_id: outboxEventId, event_type: WHATSAPP_RESUME_REQUESTED, schema_version: 1, merchant_id: merchantId,
          occurred_at: message.createdAt.toISOString(), correlation_id: deliveryId, causation_id: message.id, producer: "support",
          payload: { messageId: message.id, ticketId, bindingId: current.id, previousEpoch: plan.previousEpoch, epoch: plan.epoch } });
        await appendSupportEvent(tx, merchantId, ticketId, status);
        return { bindingId: current.id, ...scope, ticketId, mode: "ai" as const, epoch: plan.epoch, status, idempotent: false,
          resume: { messageId: message.id, status: delivery.status } };
      });
    } catch (error) {
      if (error instanceof WhatsAppOperatorAuthorizationError) {
        if (error.kind === "forbidden") throw new ForbiddenException(error.code);
        if (error.kind === "not_found") throw new NotFoundException(error.code);
        throw new ConflictException(error.code);
      }
      throw error;
    }
  }
}
