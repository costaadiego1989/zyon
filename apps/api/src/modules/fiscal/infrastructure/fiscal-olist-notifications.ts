import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FiscalConnection, PrismaClient } from "@prisma/client";
import type { FiscalCredentialCipherPort } from "../domain/fiscal-configuration.port.js";
import type { FiscalActor, FiscalTenant } from "../domain/fiscal-repository.port.js";
import type { FiscalOlistNotificationsPort } from "../domain/fiscal-olist-notifications.port.js";
import { FiscalWebhookDispatchError } from "../../../shared/integrations/fiscal-webhook-dispatch.port.js";
import { fiscalPublicUrl } from "./fiscal-olist-oauth.service.js";

const digest = (value: string) => createHash("sha256").update(value).digest();
const eventHash = (value: string) => digest(value).toString("hex");
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
type Credential = { contract?: string; issuerTaxId?: string; environment?: string; token?: string; notificationToken?: string };
interface Hint { connectionId: string; environment: "homologation" | "production"; through: string; notificationId: string; cursor?: string }

/** Notification bodies are deliberately opaque. Only authenticated API consultation changes fiscal state. */
export class FiscalOlistNotifications implements FiscalOlistNotificationsPort {
  constructor(private readonly prisma: PrismaClient, private readonly cipher: FiscalCredentialCipherPort, private readonly env: NodeJS.ProcessEnv = process.env) {}
  private credential(connection: FiscalConnection): Credential {
    try {
      const value = JSON.parse(this.cipher.decrypt(connection.credentialCipher!)) as Credential;
      if (value.contract === "olist_oauth_v3" && value.issuerTaxId === connection.issuerTaxId && value.environment === connection.environment && value.token) return value;
    } catch { /* Do not reveal credential details. */ }
    throw new Error("fiscal_olist_authorization_required");
  }
  private view(connectionId: string, key: string | undefined) {
    if (!key || !secretPattern.test(key)) return { configured: false, notificationUrl: null };
    const url = fiscalPublicUrl(this.env.API_PUBLIC_URL);
    url.pathname = "/v1/webhooks/fiscal/olist/" + encodeURIComponent(connectionId) + "/notification";
    url.searchParams.set("key", key);
    return { configured: true, notificationUrl: url.toString() };
  }
  async read(scope: FiscalTenant, connectionId: string) {
    const connection = await this.prisma.fiscalConnection.findFirst({ where: { ...scope, id: connectionId, provider: "tiny", disconnectedAt: null } });
    if (!connection) throw new Error("fiscal_connection_not_found");
    return this.view(connectionId, this.credential(connection).notificationToken);
  }
  async configure(scope: FiscalTenant, connectionId: string, actor: FiscalActor, rotate: boolean) {
    if (!actor.actorId) throw new Error("fiscal_actor_required");
    // Validate the public origin before generating or persisting a capability.
    fiscalPublicUrl(this.env.API_PUBLIC_URL);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM fiscal_connections WHERE id = ${connectionId} AND merchant_id = ${scope.merchantId} AND environment = ${scope.environment}::"FiscalEnvironment" FOR UPDATE`;
      const connection = await tx.fiscalConnection.findFirst({ where: { ...scope, id: connectionId, provider: "tiny", disconnectedAt: null } });
      if (!connection) throw new Error("fiscal_connection_not_found");
      const value = this.credential(connection);
      if (!rotate && secretPattern.test(value.notificationToken ?? "")) return this.view(connection.id, value.notificationToken);
      value.notificationToken = randomBytes(32).toString("base64url");
      await tx.fiscalConnection.update({ where: { id: connection.id }, data: { credentialCipher: this.cipher.encrypt(JSON.stringify(value)) } });
      await tx.merchantAuditEvent.create({ data: { merchantId: scope.merchantId, actorType: actor.actorKind, actorId: actor.actorId!, action: "fiscal.olist.notification_configured", resourceType: "fiscal_connection", resourceId: connection.id, metadata: { environment: scope.environment, rotated: rotate } } });
      return this.view(connection.id, value.notificationToken);
    });
  }
  private authenticated(connection: FiscalConnection | null, key: string) {
    let configured: string | undefined;
    try { configured = connection ? this.credential(connection).notificationToken : undefined; } catch { configured = undefined; }
    if (!connection || !configured || !secretPattern.test(configured) || !timingSafeEqual(digest(key), digest(configured))) throw new FiscalWebhookDispatchError(401, "fiscal_webhook_authentication_failed");
    return connection;
  }
  async receive(connectionId: string, key: unknown, rawBody: Uint8Array | undefined) {
    if (typeof key !== "string" || !secretPattern.test(key) || !/^[A-Za-z0-9_-]{1,128}$/.test(connectionId)) throw new FiscalWebhookDispatchError(401, "fiscal_webhook_authentication_failed");
    this.authenticated(await this.prisma.fiscalConnection.findFirst({ where: { id: connectionId, provider: "tiny", disconnectedAt: null } }), key);
    if (!(rawBody instanceof Uint8Array) || !rawBody.byteLength || rawBody.byteLength > 1024 * 1024) throw new FiscalWebhookDispatchError(400, "fiscal_webhook_payload_invalid");
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM fiscal_connections WHERE id = ${connectionId} FOR UPDATE`;
        const connection = this.authenticated(await tx.fiscalConnection.findFirst({ where: { id: connectionId, provider: "tiny", disconnectedAt: null } }), key);
        const clock = await tx.$queryRaw<Array<{ receivedAt: Date }>>`SELECT clock_timestamp()::timestamptz(3) AS "receivedAt"`;
        const now = new Date(Math.max(Date.now(), clock[0]!.receivedAt.getTime()));
        const outstanding = connection.olistNotificationId ? await tx.outboxMessage.findFirst({ where: { eventId: "fiscal.olist.notify:" + connection.olistNotificationId,
          merchantId: connection.merchantId, eventType: "fiscal.olist.notification.received", status: { in: ["pending", "processing"] } }, select: { eventId: true } }) : null;
        if (outstanding) {
          await tx.fiscalConnection.update({ where: { id: connection.id }, data: { olistNotificationAt: now } });
          return { received: true as const };
        }
        const notificationId = randomBytes(32).toString("hex");
        await tx.outboxMessage.create({ data: { eventId: "fiscal.olist.notify:" + notificationId, eventType: "fiscal.olist.notification.received", schemaVersion: 1,
          merchantId: connection.merchantId, occurredAt: now, correlationId: connection.id, causationId: notificationId, producer: "fiscal.olist.notification",
          payload: { connectionId: connection.id, environment: connection.environment, through: now.toISOString(), notificationId } } });
        await tx.fiscalConnection.update({ where: { id: connection.id }, data: { olistNotificationId: notificationId, olistNotificationAt: now } });
        return { received: true as const };
      });
    } catch (error) {
      if (error instanceof FiscalWebhookDispatchError) throw error;
      throw new FiscalWebhookDispatchError(503, "fiscal_webhook_persistence_failed");
    }
  }
  async consume(merchantId: string, payload: unknown) {
    const value = payload as Hint;
    if (!value || !/^[A-Za-z0-9_-]{1,128}$/.test(value.connectionId ?? "") || !["homologation", "production"].includes(value.environment)
      || !/^[a-f0-9]{64}$/.test(value.notificationId ?? "") || typeof value.through !== "string" || !Number.isFinite(Date.parse(value.through))
      || Date.parse(value.through) > Date.now() + 60000 || value.cursor !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(value.cursor)) throw new Error("fiscal_olist_notification_invalid");
    const connection = await this.prisma.fiscalConnection.findFirst({ where: { merchantId, environment: value.environment, id: value.connectionId, provider: "tiny", disconnectedAt: null } });
    if (!connection) throw new Error("fiscal_olist_notification_scope_invalid");
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM fiscal_connections WHERE id = ${connection.id} AND merchant_id = ${merchantId} AND environment = ${value.environment}::"FiscalEnvironment" FOR UPDATE`;
      const current = await tx.fiscalConnection.findFirst({ where: { id: connection.id, merchantId, environment: value.environment, provider: "tiny", disconnectedAt: null } });
      if (!current) throw new Error("fiscal_olist_notification_scope_invalid");
      let through = value.through;
      if (!value.cursor) {
        if (current.olistNotificationId !== value.notificationId) return;
        if (!current.olistNotificationAt) throw new Error("fiscal_olist_notification_invalid");
        through = current.olistNotificationAt.toISOString();
        // Clearing admission and creating all work below commit atomically. A later callback gets a fresh batch.
        await tx.fiscalConnection.update({ where: { id: current.id }, data: { olistNotificationId: null, olistNotificationAt: null } });
      }
      const intents = await tx.fiscalIntent.findMany({ where: { merchantId, environment: value.environment, connectionId: connection.id,
        state: { in: ["processing", "reconciliation_required"] }, createdAt: { lte: new Date(through) }, ...(value.cursor ? { id: { gt: value.cursor } } : {}) }, orderBy: { id: "asc" }, take: 50 });
      const data = intents.map(intent => ({ eventId: "fiscal.olist.query:" + eventHash(value.notificationId + ":" + intent.id), eventType: "fiscal.reconciliation.requested", schemaVersion: 1, merchantId,
        occurredAt: new Date(), correlationId: intent.id, causationId: value.notificationId, producer: "fiscal.olist.notification",
        payload: { intentId: intent.id, environment: connection.environment, connectionId: connection.id, provider: "tiny", stableReference: intent.stableReference } }));
      if (data.length) await tx.outboxMessage.createMany({ skipDuplicates: true, data });
      if (intents.length === 50) {
        const cursor = intents[intents.length - 1]!.id;
        await tx.outboxMessage.createMany({ skipDuplicates: true, data: { eventId: "fiscal.olist.page:" + eventHash(value.notificationId + ":" + cursor), eventType: "fiscal.olist.notification.received", schemaVersion: 1, merchantId,
          occurredAt: new Date(), correlationId: connection.id, causationId: value.notificationId, producer: "fiscal.olist.notification", payload: { ...value, through, cursor } } });
      }
    });
  }
}
