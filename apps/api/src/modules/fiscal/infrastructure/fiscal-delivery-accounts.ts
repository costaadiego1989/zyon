import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FiscalCredentialCipherPort } from "../domain/fiscal-configuration.port.js";
import type { FiscalDeliveryWebhookConfigurationPort } from "./fiscal-delivery.dispatcher.js";
import type { FiscalEmailAccountPort } from "./fiscal-email.sender.js";
import type { EmailSenderPort } from "../../notifications/domain/ports/email-sender.port.js";
/** Protected mappings bind the actual existing sender key/from-domain and webhook secret. No public ready flag. */
export class FiscalDeliveryAccounts
  implements FiscalEmailAccountPort, FiscalDeliveryWebhookConfigurationPort
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cipher: FiscalCredentialCipherPort,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetcher: typeof fetch = fetch,
    private readonly sender?: EmailSenderPort
  ) {}
  private bindings(): {
    keyFingerprint: string;
    fromEmail: string;
    domainId: string;
    hookRef: string;
    hookSecret: string;
  }[] {
    try {
      const rows = JSON.parse(this.env.FISCAL_RESEND_ACCOUNTS ?? "[]");
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }
  async read() {
    const key = this.env.RESEND_API_KEY,
      from = this.env.RESEND_FROM_EMAIL || "noreply@zyon.com.br";
    if (!key) return null;
    const keyFingerprint = createHash("sha256").update(key).digest("hex");
    const actual = this.sender?.deliveryAccountIdentity?.();
    if (
      this.sender &&
      (!actual ||
        actual.provider !== "resend" ||
        actual.credentialFingerprint !== keyFingerprint ||
        actual.fromEmail !== from)
    )
      return null;
    const binding = this.bindings().find(
      (b) =>
        b.keyFingerprint === keyFingerprint &&
        b.fromEmail === from &&
        /^[A-Za-z0-9-]{1,100}$/.test(b.domainId)
    );
    if (!binding) return null;
    try {
      const response = await this.fetcher(
        "https://api.resend.com/domains/" + binding.domainId,
        {
          method: "GET",
          redirect: "manual",
          headers: { authorization: "Bearer " + key },
          signal: AbortSignal.timeout(15000),
        }
      );
      if (!response.ok) return null;
      const domain = (await response.json()) as {
        id?: string;
        name?: string;
        status?: string;
      };
      if (
        domain.id !== binding.domainId ||
        domain.name !== from.match(/@([^>\s]+)>?$/)?.[1] ||
        domain.status !== "verified"
      )
        return null;
      return { accountId: "resend:" + keyFingerprint, enabled: true };
    } catch {
      return null;
    }
  }
  async resend(hookRef: string) {
    const b = this.bindings().filter(
      (b) =>
        b.hookRef === hookRef &&
        /^[a-f0-9]{64}$/.test(b.keyFingerprint) &&
        typeof b.hookSecret === "string" &&
        b.hookSecret.startsWith("whsec_")
    );
    return b.length === 1
      ? {
          accountId: "resend:" + b[0]!.keyFingerprint,
          secret: b[0]!.hookSecret,
        }
      : null;
  }
  async twilio(configId: string, accountSid: string, messageId?: string) {
    if (!messageId) return null;
    const binding = {
      transportProvider: "twilio",
      transportConnectionId: configId,
      transportAccountId: accountSid,
    };
    const exact = await this.prisma.fiscalDelivery.findMany({
      where: { ...binding, providerMessageId: messageId },
      select: { callbackCredentialCipher: true },
      take: 2,
    });
    if (exact.length > 1) return null;
    // Original account evidence persisted before IO can authenticate a callback
    // racing the provider response. receipt() then returns retryable identity_pending.
    const rows = exact.length
      ? exact
      : await this.prisma.fiscalDelivery.findMany({
          where: {
            ...binding,
            providerMessageId: null,
            state: "delivery_unknown",
          },
          select: { callbackCredentialCipher: true },
          take: 51,
        });
    if (!rows.length || rows.length > 50) return null;
    try {
      const tokens = new Set(
        rows.map((row) => {
          if (!row.callbackCredentialCipher) throw new Error();
          const original = JSON.parse(
            this.cipher.decrypt(row.callbackCredentialCipher)
          );
          if (
            original.accountSid !== accountSid ||
            typeof original.authToken !== "string" ||
            !original.authToken
          )
            throw new Error();
          return original.authToken as string;
        })
      );
      return tokens.size === 1
        ? { accountSid, authToken: [...tokens][0]! }
        : null;
    } catch {
      return null;
    }
  }
}
