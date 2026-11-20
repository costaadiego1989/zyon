import { randomUUID } from "node:crypto";
import { Prisma, type WhatsAppDelivery, type WhatsAppChannelConfig } from "@prisma/client";
import { canonicalJson } from "../../../shared/http/canonical-json.js";
import { appendOutboxInTransaction } from "../../../shared/messaging/infrastructure/append-outbox-in-transaction.js";
import { operatorCredentialDigest } from "../../whatsapp-channel/domain/services/whatsapp-operator-connection.js";
import { twilioAuthorityAccountId } from "../../whatsapp-channel/domain/services/connected-twilio-credentials.js";
import { decodeWhatsAppCredentials } from "../../whatsapp-channel/infrastructure/repositories/whatsapp-credential-codec.js";
import type { WhatsAppChannelConfigEntity } from "../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import type { HandoffState } from "../../whatsapp-channel/domain/services/whatsapp-handoff-state.js";
import { whatsappE164 } from "../../whatsapp-channel/domain/services/whatsapp-phone.js";
import { STAFF_ALERT_REQUESTED, staffAlertId, staffAlertLink, object, publicStaffAlert, mergeStaffAlert,
  type StaffAlertAuthority, type StaffAlertDelivery, type StaffAlertCandidate, type StaffAlertProof } from "../domain/support-case-alert.js";
import { appendSupportEvent } from "./support-persistence.js";

export function staffConfig(raw: WhatsAppChannelConfig): WhatsAppChannelConfigEntity {
  return { ...raw, credentials: decodeWhatsAppCredentials(object(raw.credentials)), deviceId: raw.deviceId ?? undefined,
    phoneNumber: raw.phoneNumber ?? undefined, whatsappNumber: raw.whatsappNumber ?? undefined,
    webhookSecret: raw.webhookSecret ?? undefined, connectedAt: raw.connectedAt ?? undefined };
}
export interface StaffAlertCommand { row: WhatsAppDelivery; authority: StaffAlertAuthority; response: Record<string, unknown>; delivery: StaffAlertDelivery; text: string; link: string; storeName: string }
export function readStaffAlertCommand(row: WhatsAppDelivery, proof?: Pick<StaffAlertProof, "eventId" | "alertId" | "merchantId" | "ticketId" | "bindingId" | "creationEpoch">): StaffAlertCommand {
  const response = object(row.response), a = object(response.authority), delivery = object(response.delivery), projection = publicStaffAlert(delivery);
  if (response.kind !== "staff_case_alert" || response.schemaVersion !== 1 || !projection
    || !["queued", "preparing", "started", "accepted", "unavailable", "failed", "unknown", "delivered", "read"].includes(row.state)
    || (["preparing", "started"].includes(row.state) ? projection.status !== "queued" : projection.status !== row.state)
    || a.merchantId !== row.merchantId || a.configId !== row.configId || a.deviceId !== row.deviceId
    || typeof a.ticketId !== "string" || typeof a.bindingId !== "string" || typeof a.whatsappSessionId !== "string" || typeof a.provider !== "string"
    || !Number.isSafeInteger(a.creationEpoch) || Number(a.creationEpoch) < 1 || !Number.isSafeInteger(a.settingsVersion) || Number(a.settingsVersion) < 0
    || row.id !== staffAlertId(row.merchantId, a.ticketId, Number(a.creationEpoch))
    || !(a.recipient === null || typeof a.recipient === "string" && whatsappE164(a.recipient) === a.recipient)
    || !(a.accountId === null || typeof a.accountId === "string") || !(a.credentialDigest === null || typeof a.credentialDigest === "string" && /^[a-f0-9]{64}$/.test(a.credentialDigest))
    || typeof response.text !== "string" || typeof response.link !== "string" || typeof response.storeName !== "string"
    || typeof response.outboxEventId !== "string" || !response.outboxEventId
    || delivery.providerMessageId !== row.providerMessageId || !(row.providerMessageId === null || typeof row.providerMessageId === "string")
    || row.providerMessageId !== null && (row.providerMessageId.length === 0 || row.providerMessageId.length > 1024 || /[\s\u0000-\u001f\u007f]/.test(row.providerMessageId))
    || ["accepted", "delivered", "read"].includes(projection.status) && row.providerMessageId === null
    || ["queued", "unavailable"].includes(projection.status) && row.providerMessageId !== null
    || proof && (proof.alertId !== row.id || proof.merchantId !== row.merchantId || proof.ticketId !== a.ticketId || proof.bindingId !== a.bindingId || proof.creationEpoch !== a.creationEpoch
      || proof.eventId !== response.outboxEventId))
    throw new Error("staff_alert_original_command_required");
  return { row, response, authority: a as unknown as StaffAlertAuthority, delivery: delivery as unknown as StaffAlertDelivery,
    text: response.text, link: response.link, storeName: response.storeName };
}
/** Called only for created=true inside the canonical inbox/binding transaction. */
export async function enqueueStaffAlertWithin(tx: Prisma.TransactionClient, state: HandoffState): Promise<void> {
  if (state.mode !== "waiting_human" || !state.ticketId || state.assignedOperatorId !== null) throw new Error("staff_alert_creation_required");
  // Matches T99's merchant row lock, including first save/clear/version change.
  await tx.$queryRaw`SELECT id FROM merchants WHERE id=${state.merchantId} FOR SHARE`;
  const [setting, raw, merchant] = await Promise.all([
    tx.supportNotificationSetting.findUnique({ where: { merchantId: state.merchantId } }),
    tx.whatsAppChannelConfig.findFirst({ where: { id: state.configId, merchantId: state.merchantId } }),
    tx.merchant.findUnique({ where: { id: state.merchantId }, select: { name: true } }),
  ]);
  if (!raw) throw new Error("staff_alert_creation_config_required");
  const config = staffConfig(raw), c = config.credentials, recipient = setting?.fallbackWhatsapp ?? null;
  const accountId = config.provider === "META_CLOUD" && typeof c.phoneNumberId === "string" ? c.phoneNumberId
    : config.provider === "TWILIO" ? twilioAuthorityAccountId(config) ?? null : null;
  const digest = operatorCredentialDigest(config) ?? null;
  const authority: StaffAlertAuthority = { merchantId: state.merchantId, configId: state.configId, whatsappSessionId: state.whatsappSessionId,
    ticketId: state.ticketId, bindingId: state.id, creationEpoch: state.epoch,
    deviceId: config.deviceId ?? config.provider + ":" + config.id, provider: config.provider, recipient,
    settingsVersion: setting?.version ?? 0, accountId, credentialDigest: digest,
    ...(config.provider === "TWILIO" && typeof c.accountSid === "string" ? { providerAccountId: c.accountSid }
      : config.provider === "META_CLOUD" && accountId ? { providerAccountId: accountId } : {}),
    ...(config.provider === "TWILIO" && typeof c.senderId === "string" && whatsappE164(c.senderId.replace(/^whatsapp:/, ""))
      ? { sender: whatsappE164(c.senderId.replace(/^whatsapp:/, ""))! } : {}) };
  let link = ""; try { link = staffAlertLink(state.ticketId); } catch { /* The ticket still commits with an unavailable alert. */ }
  const storeName = (merchant?.name ?? "Sua empresa").replace(/[\r\n\t]+/g, " ").trim().slice(0, 120);
  const text = `Novo atendimento humano em ${storeName}.\nAbra a conversa no painel: ${link}`;
  const ready = !!recipient && whatsappE164(recipient) === recipient && !!accountId && !!digest && !!link && config.enabled && config.status === "ACTIVE";
  const alertId = staffAlertId(state.merchantId, state.ticketId, state.epoch), outboxEventId = randomUUID();
  const delivery: StaffAlertDelivery = { status: ready ? "queued" : "unavailable", revision: 0, providerMessageId: null,
    ...(!ready ? { errorCode: "alert_not_configured_or_available" } : {}) };
  await tx.whatsAppDelivery.create({ data: { id: alertId, merchantId: state.merchantId, configId: state.configId, deviceId: authority.deviceId,
    state: delivery.status, processingToken: "not_started", response: { kind: "staff_case_alert", schemaVersion: 1, authority, delivery, text, link, storeName, outboxEventId } as unknown as Prisma.InputJsonValue } });
  if (!ready) return;
  await appendOutboxInTransaction(tx, { event_id: outboxEventId, event_type: STAFF_ALERT_REQUESTED, schema_version: 1,
    merchant_id: state.merchantId, producer: "support", occurred_at: new Date().toISOString(), correlation_id: alertId, causation_id: state.ticketId,
    payload: { alertId, ticketId: state.ticketId, bindingId: state.id, creationEpoch: state.epoch } });
}
export async function loadStaffAlertWithin(tx: Pick<Prisma.TransactionClient, "whatsAppDelivery">, proof: StaffAlertProof): Promise<StaffAlertCommand> {
  const row = await tx.whatsAppDelivery.findFirst({ where: { id: proof.alertId, merchantId: proof.merchantId } });
  if (!row) throw new Error("staff_alert_original_command_required");
  return readStaffAlertCommand(row, proof);
}
export async function saveStaffAlertWithin(tx: Prisma.TransactionClient, command: StaffAlertCommand, incoming: StaffAlertCandidate,
  options: { state?: string; token?: string; submission?: unknown } = {}): Promise<void> {
  const delivery = mergeStaffAlert(command.delivery, incoming), changed = canonicalJson(delivery) !== canonicalJson(command.delivery);
  const response = { ...command.response, delivery, ...(options.submission === undefined ? {} : { submission: options.submission }) };
  const updated = await tx.whatsAppDelivery.updateMany({ where: { id: command.row.id, merchantId: command.row.merchantId,
    state: command.row.state, processingToken: command.row.processingToken }, data: { state: options.state ?? delivery.status,
    processingToken: options.token ?? command.row.processingToken, providerMessageId: delivery.providerMessageId,
    response: response as unknown as Prisma.InputJsonValue } });
  if (updated.count !== 1) throw new Error("staff_alert_attempt_changed");
  if (changed) await appendSupportEvent(tx, command.authority.merchantId, command.authority.ticketId, "staff_alert");
}
export async function staffAlertProjectionWithin(tx: Pick<Prisma.TransactionClient, "whatsAppDelivery">, merchantId: string, ticketId: string) {
  const rows = await tx.whatsAppDelivery.findMany({ where: { merchantId, id: { startsWith: "support_case_alert:" },
    response: { path: ["authority", "ticketId"], equals: ticketId } }, take: 2 });
  if (rows.length !== 1) return undefined;
  const command = readStaffAlertCommand(rows[0]);
  return command.authority.ticketId === ticketId ? publicStaffAlert(command.delivery) : undefined;
}
