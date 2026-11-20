import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import type { WhatsAppChannelConfigEntity } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { readOriginalOperatorAttempt, operatorReceiptAccountMatches, type OperatorReceipt } from "../../../whatsapp-channel/domain/services/whatsapp-operator-receipt.js";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { whatsappE164 } from "../../../whatsapp-channel/domain/services/whatsapp-phone.js";
import { object, parseStaffAlertDispatch, mergeStaffAlert, STAFF_ALERT_PREFIX } from "../../domain/support-case-alert.js";
import { readStaffAlertCommand, loadStaffAlertWithin, saveStaffAlertWithin } from "../support-case-alert-state.js";
import { lockSupportResource } from "../support-persistence.js";

export function parseStaffMetaReceipt(account: string, input: unknown): OperatorReceipt | undefined {
  const row = object(input), status = row.status === "sent" ? "accepted" : row.status;
  if (!account || typeof row.id !== "string" || !row.id || row.id.length > 1024 || /\s/.test(row.id)
    || !["accepted", "delivered", "read", "failed"].includes(String(status)) || typeof row.recipient_id !== "string") return;
  const recipient = whatsappE164(row.recipient_id); if (!recipient) return;
  if (row.biz_opaque_callback_data !== undefined && (typeof row.biz_opaque_callback_data !== "string" || !/^support_case_alert:[a-f0-9]{64}$/.test(row.biz_opaque_callback_data))) return;
  return { provider: "META_CLOUD", providerAccountId: account, providerMessageId: row.id, status: status as OperatorReceipt["status"], recipient,
    ...(typeof row.biz_opaque_callback_data === "string" ? { correlationId: row.biz_opaque_callback_data } : {}) };
}
@Injectable()
export class SupportCaseAlertDeliveryService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient, private readonly tenant: TenantContextService) {}
  async reconcileMeta(config: WhatsAppChannelConfigEntity, account: string, input: unknown): Promise<boolean> {
    if (config.credentials.phoneNumberId !== account) return false;
    const receipt = parseStaffMetaReceipt(account, input); return receipt ? this.reconcile(config, receipt) : false;
  }
  async reconcile(config: WhatsAppChannelConfigEntity, receipt: OperatorReceipt): Promise<boolean> {
    if (this.tenant.get() && this.tenant.get()!.merchantId !== config.merchantId || config.provider !== receipt.provider || !receipt.recipient
      || receipt.correlationId !== undefined && !/^support_case_alert:[a-f0-9]{64}$/.test(receipt.correlationId)) return false;
    return this.tenant.run({ merchantId: config.merchantId, userId: "whatsapp-staff-alert-receipt", role: "system" }, async () => {
      const rows = await this.prisma.whatsAppDelivery.findMany({ where: { merchantId: config.merchantId, configId: config.id,
        ...(receipt.correlationId ? { id: receipt.correlationId } : { id: { startsWith: STAFF_ALERT_PREFIX }, providerMessageId: receipt.providerMessageId }) }, take: 2 });
      if (rows.length !== 1 || !rows[0].id.startsWith(STAFF_ALERT_PREFIX)) return false;
      const command = readStaffAlertCommand(rows[0]), attempt = readOriginalOperatorAttempt(command.response, command.row.processingToken), a = command.authority;
      if (!attempt || !a.accountId || !a.recipient || receipt.recipient !== a.recipient || !operatorReceiptAccountMatches({ ...a, accountId: a.accountId, recipient: a.recipient }, attempt, config, receipt)) return false;
      const event = await this.prisma.outboxMessage.findFirst({ where: { eventId: attempt.outboxEventId, merchantId: a.merchantId } });
      const proof = event && parseStaffAlertDispatch({ ...event, deliveryLeaseToken: attempt.outboxLeaseToken });
      if (!proof || event?.producer !== "support") return false;
      return this.prisma.$transaction(async tx => {
        await lockSupportResource(tx, "support:" + a.ticketId);
        const current = await loadStaffAlertWithin(tx, proof), original = readOriginalOperatorAttempt(current.response, current.row.processingToken);
        if (!original || canonicalJson(original) !== canonicalJson(attempt) || current.delivery.status === "unavailable"
          || current.row.providerMessageId !== null && current.row.providerMessageId !== receipt.providerMessageId) return false;
        // Historical attempt evidence, never a current setting or lease grant.
        const durable = await tx.outboxMessage.findFirst({ where: { eventId: proof.eventId, merchantId: a.merchantId } });
        const same = durable && parseStaffAlertDispatch({ ...durable, deliveryLeaseToken: original.outboxLeaseToken });
        if (!same || durable?.producer !== "support" || canonicalJson(same) !== canonicalJson(proof)) return false;
        const before = canonicalJson(current.delivery);
        const candidate = { status: receipt.status, providerMessageId: receipt.providerMessageId,
          ...(receipt.status === "failed" ? { errorCode: "provider_delivery_failed" } : {}) };
        if (canonicalJson(mergeStaffAlert(current.delivery, candidate)) === before) return true;
        await saveStaffAlertWithin(tx, current, candidate, { submission: { ...object(current.response.submission), phase: receipt.status, requestInvoked: true } });
        return true;
      });
    });
  }
}
