import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FiscalIssuanceStorePort } from "../domain/fiscal-issuance.port.js";
import type { FiscalTenant } from "../domain/fiscal-repository.port.js";
import type { FiscalChannel, FiscalDeliveryReceipt, FiscalDeliverySenderPort } from "../domain/fiscal-delivery.port.js";
import { validateFiscalRecipient } from "../domain/fiscal-recipient.js";
import { whatsappE164 } from "../../whatsapp-channel/domain/services/whatsapp-phone.js";
import { safelyObserveFiscal, type FiscalObservationPort } from "../domain/fiscal-observation.port.js";

export class FiscalDeliveryService {
  constructor(private readonly prisma: PrismaClient, private readonly issuance: FiscalIssuanceStorePort, private readonly senders: Partial<Record<FiscalChannel, FiscalDeliverySenderPort>>, private readonly observations?: FiscalObservationPort) {}
  async initialize(scope: FiscalTenant, intentId: string) {
    const session = await this.issuance.readOnly(scope, intentId);
    const document = await this.prisma.fiscalDocument.findFirst({ where: { ...scope, intentId, state: { in: ["authorized", "cancelled"] }, authorizationProtocol: { not: null } } });
    if (!document) throw new Error("fiscal_document_pending");
    const emailRequest = await session.providerEmailRequest();
    const envelope = session.context.envelope;
    const rows = [];
    for (const channel of ["email", "whatsapp"] as const) {
      const responsibleSender = channel === "email" ? envelope.policy.emailOwner : envelope.policy.whatsappOwner;
      const raw = channel === "email" ? envelope.buyerContacts.email : envelope.buyerContacts.phone;
      const destination = channel === "email" ? (raw?.trim() && validateFiscalRecipient({ email: raw }, ["email"]).valid ? raw.trim().toLowerCase() : null) : whatsappE164(raw ?? "");
      let state = "queued", reason: string | undefined;
      if (!destination) { state = "blocked"; reason = `fiscal_${channel}_destination_invalid`; }
      else if (responsibleSender === "provider") {
        state = channel === "email" && emailRequest.included ? "delivery_unknown" : "blocked";
        reason = channel === "email" ? emailRequest.reasonCode ?? "fiscal_provider_email_request_included" : "fiscal_provider_whatsapp_evidence_unavailable";
      } else if (responsibleSender !== "zyon") { state = "blocked"; reason = "fiscal_delivery_owner_invalid"; }
      const created = await this.prisma.fiscalDelivery.createMany({ data: { ...scope, documentId: document.id, channel, responsibleSender, destination, idempotencyKey: "fiscal-" + createHash("sha256").update(document.id + ":" + channel).digest("hex"), state, safeReasonCode: reason }, skipDuplicates: true });
      if (created.count && state !== "queued") safelyObserveFiscal(() => this.observations?.delivery({ provider: session.context.identity.provider, environment: scope.environment, channel, transport: responsibleSender === "provider" ? "provider" : null, outcome: state }));
      rows.push(await this.prisma.fiscalDelivery.findUniqueOrThrow({ where: { documentId_channel: { documentId: document.id, channel } } }));
    }
    return rows;
  }
  async dispatch(scope: FiscalTenant, intentId: string, channel: FiscalChannel) {
    const rows = await this.initialize(scope, intentId); let row = rows.find(item => item.channel === channel)!;
    if (row.state === "blocked" && row.responsibleSender === "zyon" && row.destination && row.attempts === 0 && !row.transportProvider) {
      await this.prisma.fiscalDelivery.updateMany({ where: { ...scope, id: row.id, version: row.version, state: "blocked", attempts: 0, transportProvider: null }, data: { state: "queued", safeReasonCode: null, version: { increment: 1 } } });
      row = await this.prisma.fiscalDelivery.findUniqueOrThrow({ where: { id: row.id } });
    }
    if (row.state !== "queued" || row.responsibleSender !== "zyon") return row;
    const sender = this.senders[channel];
    const session = await this.issuance.readOnly(scope, intentId);
    const document = await this.prisma.fiscalDocument.findFirstOrThrow({ where: { ...scope, id: row.documentId } });
    const plan = sender ? await sender.prepare({ delivery: row, document, issuance: session.context }) : { ready: false as const, reasonCode: "fiscal_delivery_sender_unavailable" };
    if (!plan.ready) {
      const changed = await this.prisma.fiscalDelivery.updateMany({ where: { id: row.id, state: "queued", version: row.version }, data: { state: "blocked", safeReasonCode: plan.reasonCode, version: { increment: 1 } } });
      if (changed.count) safelyObserveFiscal(() => this.observations?.delivery({ provider: session.context.identity.provider, environment: scope.environment, channel, transport: row.transportProvider, outcome: "blocked" }));
    }
    else {
      if (!plan.accountId?.trim()) throw new Error("fiscal_delivery_account_required");
      const token = randomUUID();
      // Persist uncertainty BEFORE any possible write. A crash/timeout never reopens queued.
      const claim = await this.prisma.fiscalDelivery.updateMany({ where: { id: row.id, ...scope, state: "queued", version: row.version }, data: { state: "delivery_unknown", safeReasonCode: "fiscal_delivery_write_started", leaseToken: token, attempts: { increment: 1 }, lastAttemptAt: new Date(), version: { increment: 1 }, transportProvider: plan.provider, transportAccountId: plan.accountId, transportConnectionId: plan.connectionId, callbackCredentialCipher: plan.callbackCredentialCipher } });
      if (claim.count) {
        let result; try { result = await plan.send(); } catch { result = { state: "delivery_unknown" as const, reasonCode: "fiscal_delivery_acceptance_unknown" }; }
        const accepted = result.state === "accepted" && !!result.messageId?.trim();
        const outcome = accepted ? "accepted" : result.state === "accepted" ? "delivery_unknown" : result.state;
        const changed = await this.prisma.fiscalDelivery.updateMany({ where: { id: row.id, ...scope, state: "delivery_unknown", leaseToken: token }, data: { state: outcome, providerMessageId: result.state === "accepted" && accepted ? result.messageId : undefined, safeReasonCode: accepted ? null : "reasonCode" in result ? result.reasonCode : "fiscal_delivery_acceptance_unknown", leaseToken: null, version: { increment: 1 } } });
        if (changed.count) safelyObserveFiscal(() => this.observations?.delivery({ provider: session.context.identity.provider, environment: scope.environment, channel, transport: plan.provider, outcome }));
      }
    }
    return this.prisma.fiscalDelivery.findUniqueOrThrow({ where: { id: row.id } });
  }
  async dispatchAll(scope: FiscalTenant, intentId: string) {
    // Independent channels; one persistence/transport failure does not suppress the other.
    return Promise.allSettled((["email", "whatsapp"] as const).map(channel => this.dispatch(scope, intentId, channel)));
  }
  async receipt(receipt: FiscalDeliveryReceipt) {
    const rows = await this.prisma.fiscalDelivery.findMany({ where: { transportProvider: receipt.provider, transportAccountId: receipt.accountId, providerMessageId: receipt.messageId }, include: { document: { select: { intent: { select: { connection: { select: { provider: true } } } } } } } });
    if (rows.length !== 1) {
      // A valid callback can race the response/ID commit. Ask the provider to retry,
      // rather than acknowledge and lose its only delivery evidence.
      if (!rows.length && await this.prisma.fiscalDelivery.count({ where: { transportProvider: receipt.provider, transportAccountId: receipt.accountId, providerMessageId: null, state: "delivery_unknown" } })) throw new Error("fiscal_delivery_identity_pending");
      return false;
    }
    const row = rows[0]!;
    const destination = receipt.destination === undefined ? undefined : row.channel === "email" ? receipt.destination.trim().toLowerCase() : whatsappE164(receipt.destination);
    if (destination !== undefined && destination !== row.destination) return false;
    if (row.state === "delivered") return true;
    if (receipt.state === row.state || receipt.state === "accepted" || !["accepted", "delivery_unknown", "failed"].includes(row.state)) return true;
    const changed = await this.prisma.fiscalDelivery.updateMany({ where: { id: row.id, version: row.version, state: { not: "delivered" } }, data: { state: receipt.state, ...(receipt.state === "delivered" ? { deliveredAt: new Date(), safeReasonCode: null } : { safeReasonCode: "fiscal_delivery_provider_failed" }), version: { increment: 1 } } });
    if (changed.count) {
      // The original persisted document/connection supplies the bounded provider;
      // callback account/message/destination evidence never becomes a label.
      safelyObserveFiscal(() => this.observations?.delivery({ provider: row.document.intent.connection.provider, environment: row.environment, channel: row.channel, transport: row.transportProvider, outcome: receipt.state }));
    }
    return true;
  }
}
