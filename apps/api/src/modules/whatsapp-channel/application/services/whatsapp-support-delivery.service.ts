import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { lockSupportResource } from "../../../support/application/support-persistence.js";
import type { WhatsAppChannelConfigEntity } from "../../domain/ports/whatsapp-config-repository.port.js";
import { parseOperatorDispatch, mergeOperatorDelivery } from "../../domain/services/whatsapp-operator-delivery.js";
import { parseMetaOperatorReceipt, readOriginalOperatorAttempt, operatorReceiptAccountMatches,
  type OperatorReceipt } from "../../domain/services/whatsapp-operator-receipt.js";
import { readStoredOperatorAuthority, loadOperatorMessageWithin, saveOperatorDeliveryWithin } from "./whatsapp-support-message-state.js";

/** Called only after the provider controller authenticates the actual account.
 * Correlation is a selector; immutable command/attempt proof remains mandatory.
 * A receipt settles history and never invokes a sender or current-case action. */
@Injectable()
export class WhatsAppSupportDeliveryService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient, private readonly tenant: TenantContextService) {}

  async reconcileMeta(config: WhatsAppChannelConfigEntity, phoneNumberId: string, input: unknown): Promise<boolean> {
    if (config.credentials.phoneNumberId !== phoneNumberId) return false;
    const receipt = parseMetaOperatorReceipt(phoneNumberId, input);
    return receipt ? this.reconcile(config, receipt) : false;
  }
  async reconcile(config: WhatsAppChannelConfigEntity, receipt: OperatorReceipt): Promise<boolean> {
    const context = this.tenant.get(); if (context && context.merchantId !== config.merchantId) return false;
    if (config.provider !== receipt.provider) return false;
    return this.tenant.run({ merchantId: config.merchantId, userId: "whatsapp-support-receipt", role: "system" }, async () => {
      const rows = await this.prisma.whatsAppDelivery.findMany({ where: { merchantId: config.merchantId, configId: config.id,
        ...(receipt.correlationId ? { id: receipt.correlationId } : { id: { startsWith: "support_message:" }, providerMessageId: receipt.providerMessageId }) }, take: 2 });
      if (rows.length !== 1 || !rows[0].id.startsWith("support_message:")) return false;
      const row = rows[0], attempt = readOriginalOperatorAttempt(row.response, row.processingToken);
      if (!attempt || !["preparing", "started", "accepted", "delivered", "read", "failed", "unknown"].includes(row.state)) return false;
      const event = await this.prisma.outboxMessage.findFirst({ where: { eventId: attempt.outboxEventId, merchantId: config.merchantId } });
      if (!event || event.producer !== "support") return false;
      // Deliberately retain the original attempt lease. A current/reclaimed
      // event lease is not the authority of a historical provider callback.
      const proof = parseOperatorDispatch({ eventId: event.eventId, eventType: event.eventType, merchantId: event.merchantId,
        schemaVersion: event.schemaVersion, correlationId: event.correlationId, causationId: event.causationId,
        payload: event.payload, deliveryLeaseToken: attempt.outboxLeaseToken });
      const authority = proof && readStoredOperatorAuthority(row, proof);
      if (!proof || !authority || !operatorReceiptAccountMatches(authority, attempt, config, receipt)) return false;
      try {
        return await this.prisma.$transaction(async tx => {
          await lockSupportResource(tx, "support:" + proof.ticketId);
          const command = await loadOperatorMessageWithin(tx, proof, authority);
          if (["preparing", "started"].includes(command.row.state) ? command.projection.status !== "queued" : command.row.state !== command.projection.status) return false;
          const original = readOriginalOperatorAttempt(command.response, command.row.processingToken);
          if (!original || canonicalJson(original) !== canonicalJson(attempt)
            || !operatorReceiptAccountMatches(command.authority, original, config, receipt)) return false;
          const durableEvent = await tx.outboxMessage.findFirst({ where: { eventId: proof.eventId, merchantId: proof.merchantId } });
          if (!durableEvent || durableEvent.producer !== "support" || durableEvent.eventType !== "whatsapp.support.message.requested"
            || durableEvent.schemaVersion !== 1 || durableEvent.correlationId !== proof.correlationId || durableEvent.causationId !== proof.messageId
            || canonicalJson(durableEvent.payload) !== proof.payloadDigest) return false;
          if (command.projection.providerMessageId !== null && command.projection.providerMessageId !== receipt.providerMessageId) return false;
          const candidate = { status: receipt.status, providerMessageId: receipt.providerMessageId,
            ...(receipt.status === "failed" ? { errorCode: "provider_delivery_failed" } : {}) };
          // A duplicate or weaker out-of-order receipt leaves the entire private
          // row, public revision and realtime outbox unchanged.
          if (!mergeOperatorDelivery(command.projection, candidate).changed) return true;
          await saveOperatorDeliveryWithin(tx, command, candidate); return true;
        });
      } catch (error) {
        if (error instanceof Error && ["operator_command_identity_invalid", "operator_command_response_invalid", "operator_command_message_invalid"].includes(error.message)) return false;
        throw error;
      }
    });
  }
}
