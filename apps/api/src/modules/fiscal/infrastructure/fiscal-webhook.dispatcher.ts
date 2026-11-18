import { createHash } from "node:crypto";
import type { FiscalConnection, FiscalIntent, PrismaClient } from "@prisma/client";
import { FiscalWebhookDispatchError, type FiscalWebhookDispatchPort } from "../../../shared/integrations/fiscal-webhook-dispatch.port.js";
import { authenticateFiscalWebhook, type FiscalWebhookAuthenticationConfiguration } from "./fiscal-webhook-auth.js";
import type { FiscalTenant } from "../domain/fiscal-repository.port.js";

export interface FiscalWebhookConfigurationPort { read(connection: FiscalConnection): Promise<FiscalWebhookAuthenticationConfiguration | null> }
export class FiscalWebhookDispatcher implements FiscalWebhookDispatchPort {
  constructor(private readonly prisma: PrismaClient, private readonly configuration: FiscalWebhookConfigurationPort,
    private readonly reconciliation: { reconcile(scope: FiscalTenant, id: string): Promise<{ retryable: boolean }> }) {}
  private async enqueue(connection: FiscalConnection, intent: FiscalIntent, fingerprint: string) {
    const eventId = "fiscal.webhook:" + fingerprint;
    try {
      const inserted = await this.prisma.outboxMessage.createMany({ skipDuplicates: true, data: {
        eventId, eventType: "fiscal.reconciliation.requested", schemaVersion: 1, merchantId: connection.merchantId, occurredAt: new Date(), correlationId: intent.id, causationId: fingerprint, producer: "fiscal.webhook",
        payload: { intentId: intent.id, environment: connection.environment, connectionId: connection.id, provider: connection.provider, stableReference: intent.stableReference } } });
      if (!inserted.count) await this.prisma.outboxMessage.findUniqueOrThrow({ where: { eventId, merchantId: connection.merchantId, eventType: "fiscal.reconciliation.requested" }, select: { eventId: true } });
    } catch { throw new FiscalWebhookDispatchError(503, "fiscal_webhook_persistence_failed"); }
    return { received: true as const };
  }
  async receive(provider: string, connectionRef: string, body: unknown, rawBody: Uint8Array | undefined, headers: Readonly<Record<string, unknown>>) {
    if (provider === "omie" || provider === "tiny") throw new FiscalWebhookDispatchError(401, "fiscal_webhook_query_only");
    // The Bling account receiver below is the documented configured path. Do not add a competing trust path.
    if (provider !== "focus" || !/^[A-Za-z0-9_-]{1,128}$/.test(connectionRef)) throw new FiscalWebhookDispatchError(400, "fiscal_webhook_route_invalid");
    const connection = await this.prisma.fiscalConnection.findFirst({ where: { id: connectionRef, provider: "focus" } });
    const config = connection ? await this.configuration.read(connection) : null;
    if (!connection || !authenticateFiscalWebhook({ provider: "focus", headers, configuration: config ?? undefined }).authenticated) throw new FiscalWebhookDispatchError(401, "fiscal_webhook_authentication_failed");
    if (!(rawBody instanceof Uint8Array) || !rawBody.byteLength || rawBody.byteLength > 1024 * 1024) throw new FiscalWebhookDispatchError(503, "fiscal_webhook_raw_body_required");
    const value = body as { ref?: unknown; cnpj_emitente?: unknown; cpf_emitente?: unknown; ambiente?: unknown; protocolo_nota_fiscal?: { ambiente?: unknown } };
    const environment = value?.ambiente ?? value?.protocolo_nota_fiscal?.ambiente;
    if (!value || typeof value.ref !== "string" || (value.cnpj_emitente ?? value.cpf_emitente) !== connection.issuerTaxId || environment !== undefined && String(environment) !== (connection.environment === "production" ? "1" : "2")) throw new FiscalWebhookDispatchError(400, "fiscal_webhook_identity_mismatch");
    const intent = await this.prisma.fiscalIntent.findFirst({ where: { merchantId: connection.merchantId, environment: connection.environment, connectionId: connection.id, stableReference: value.ref } });
    if (!intent) throw new FiscalWebhookDispatchError(400, "fiscal_webhook_identity_mismatch");
    return this.enqueue(connection, intent, createHash("sha256").update(connection.id).update(rawBody).digest("hex"));
  }
  async fromBlingAccount(input: Parameters<FiscalWebhookDispatchPort["fromBlingAccount"]>[0]) {
    const value = input.body as { event?: unknown; data?: { id?: unknown } };
    if (typeof value?.event !== "string" || !value.event.startsWith("invoice.") || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.eventId)) throw new FiscalWebhookDispatchError(400, "fiscal_webhook_payload_invalid");
    const invoiceId = typeof value.data?.id === "number" && Number.isSafeInteger(value.data.id) ? String(value.data.id) : value.data?.id;
    if (typeof invoiceId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(invoiceId)) throw new FiscalWebhookDispatchError(400, "fiscal_webhook_payload_invalid");
    const route = await this.prisma.erpWebhookRoute.findFirst({ where: { provider: "bling", externalAccountId: input.externalAccountId, merchantId: input.merchantId, connectionId: input.erpConnectionId } });
    if (!route) throw new FiscalWebhookDispatchError(400, "fiscal_webhook_identity_mismatch");
    const intents = await this.prisma.fiscalIntent.findMany({ where: { merchantId: input.merchantId, connection: { provider: "bling", erpConnectionId: input.erpConnectionId }, OR: [{ remoteInvoiceId: invoiceId },
      { stageReceipts: { some: { stage: { in: ["invoice.generate", "invoice.submit"] }, remoteId: invoiceId, outcome: "accepted" } } }] }, include: { connection: true }, take: 2 });
    if (!intents.length) return { received: true as const, ignored: true };
    if (intents.length !== 1) throw new FiscalWebhookDispatchError(400, "fiscal_webhook_connection_ambiguous");
    const intent = intents[0]!;
    return this.enqueue(intent.connection, intent, createHash("sha256").update(JSON.stringify([input.externalAccountId, input.erpConnectionId, input.eventId])).digest("hex"));
  }
  async consume(trustedMerchantId: string, payload: unknown) {
    const value = payload as { intentId?: string; environment?: "homologation" | "production"; connectionId?: string; provider?: string; stableReference?: string };
    if (!value?.intentId || !["homologation", "production"].includes(value.environment ?? "")) throw new Error("fiscal_webhook_request_invalid");
    const intent = await this.prisma.fiscalIntent.findFirst({ where: { merchantId: trustedMerchantId, environment: value.environment, id: value.intentId, connectionId: value.connectionId, stableReference: value.stableReference, connection: { provider: value.provider as "focus" | "bling" | "tiny" } } });
    if (!intent || !value.connectionId || !value.stableReference || !["focus", "bling", "tiny"].includes(value.provider ?? "")) throw new Error("fiscal_webhook_identity_mismatch");
    if ((await this.reconciliation.reconcile({ merchantId: trustedMerchantId, environment: intent.environment }, intent.id)).retryable) throw new Error("fiscal_webhook_reconciliation_pending");
  }
}
