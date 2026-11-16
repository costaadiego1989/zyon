import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import type { WhatsAppRequestScope } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
import type { WhatsAppChannelConfigEntity } from "../ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "./connected-meta-cloud-credentials.js";
import { connectedTwilioCredentials, twilioAuthorityAccountId } from "./connected-twilio-credentials.js";
import { whatsappE164 } from "./whatsapp-phone.js";
export interface OperatorChannelAuthority { merchantId: string; configId: string; deviceId: string; provider: string; accountId: string; recipient: string }
export type OperatorRequestScope = Readonly<Extract<WhatsAppRequestScope, { kind: "whatsapp" }> & { credentialDigest: string }>;
export type OperatorConnection = { kind: "ready"; scope: OperatorRequestScope }
  | { kind: "unavailable"; code: "channel_offline" | "channel_identity_unavailable" | "channel_context_changed" };
/** A digest of actual SDK auth fields, not of transient onboarding leases.
 * Raw secrets stay server-side and never enter the public message/lease payload. */
export function operatorCredentialDigest(config: WhatsAppChannelConfigEntity): string | undefined {
  if (config.provider === "META_CLOUD") {
    const credentials = connectedMetaCloudCredentials(config, config.merchantId); if (!credentials) return;
    return createHash("sha256").update(canonicalJson({ provider: config.provider, accessToken: credentials.accessToken,
      wabaId: credentials.wabaId, phoneNumberId: credentials.phoneNumberId })).digest("hex");
  }
  if (config.provider === "TWILIO") {
    if (!connectedTwilioCredentials(config, config.merchantId)) return;
    return createHash("sha256").update(canonicalJson({ provider: config.provider, accountSid: config.credentials.accountSid,
      authToken: config.credentials.authToken, senderId: config.credentials.senderId, whatsappNumber: config.whatsappNumber })).digest("hex");
  }
  return;
}
export function operatorConnection(config: WhatsAppChannelConfigEntity, original: OperatorChannelAuthority): OperatorConnection {
  if (config.merchantId !== original.merchantId || config.id !== original.configId || config.provider !== original.provider
    || (config.deviceId ?? config.provider + ":" + config.id) !== original.deviceId || whatsappE164(original.recipient) !== original.recipient)
    return { kind: "unavailable", code: "channel_context_changed" };
  if (!config.enabled || config.status !== "ACTIVE") return { kind: "unavailable", code: "channel_offline" };
  // Legacy Bubble SDK uses a process-global account without a verified mapping
  // to this config/device. Do not call it for a newly privileged human command.
  // Its pre-existing AI/product path is deliberately unchanged.
  if (config.provider === "BUBBLEWHATS") return { kind: "unavailable", code: "channel_identity_unavailable" };
  const accountId = config.provider === "META_CLOUD" ? connectedMetaCloudCredentials(config, original.merchantId)?.phoneNumberId
    : config.provider === "TWILIO" ? twilioAuthorityAccountId(config) : undefined;
  const credentialDigest = operatorCredentialDigest(config);
  if (!accountId || !credentialDigest) return { kind: "unavailable", code: "channel_identity_unavailable" };
  if (accountId !== original.accountId) return { kind: "unavailable", code: "channel_context_changed" };
  return { kind: "ready", scope: Object.freeze({ kind: "whatsapp", merchantId: original.merchantId, configId: original.configId,
    deviceId: original.deviceId, provider: original.provider, accountId, recipient: original.recipient, credentialDigest }) };
}
