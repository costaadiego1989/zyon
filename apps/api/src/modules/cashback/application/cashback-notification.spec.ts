import { test } from "node:test";
import assert from "node:assert/strict";
import { CashbackNotificationService } from "./cashback-notification.service.js";
import { categoryFor, getTemplateDefinition } from "../../whatsapp-templates/domain/catalog/template-catalog.js";

function fixture(options: { whatsapp?: boolean; email?: boolean; revokedBeforeDispatch?: boolean; uncertain?: boolean } = {}) {
  const sent: any[] = []; const records = new Map<string, any>(); const consentChecks: any[] = [];
  const prisma = {
    buyerAccount: { findUnique: async () => ({ email: "buyer@example.test", displayName: "Ana" }) },
    $queryRaw: async (parts: TemplateStringsArray, ...values: any[]) => {
      if (parts.join("").includes("buyer_verified_phones")) return [{ phone: "5511988887777" }];
      const key = [values[0], values[2], values[3]].join(":");
      if (records.has(key)) return [];
      records.set(key, { state: "dispatching" }); return [{ id: key }];
    },
    $executeRaw: async (parts: TemplateStringsArray, ...values: any[]) => {
      if (parts.join("").includes("INSERT INTO")) records.set([values[0], values[2], values[3]].join(":"), { state: "skipped", reason: "cashback_contact_not_authorized" });
      else records.set(values[3], { state: values[0], reason: values[1], providerMessageId: values[2] });
    },
  };
  const service = new CashbackNotificationService({ repository: { prisma }, wallet: async () => ({ merchantId: "m", buyerId: "canonical",
    balance: { availableCents: 1000, nextExpiryCents: 400, nextExpiryAt: "2026-11-17T12:00:00Z" } }) } as any,
    { canContact: async (input: any) => { consentChecks.push(input); return !options.revokedBeforeDispatch || consentChecks.length <= 2
      ? input.channel === "whatsapp" ? Boolean(options.whatsapp) : Boolean(options.email) : false; } } as any,
    { findByMerchantAndType: async (_merchant: string, _type: string, channel: string) => ({ merchantId: "m", isActive: channel === "whatsapp" ? Boolean(options.whatsapp) : Boolean(options.email) }) } as any,
    { execute: async (input: any) => { sent.push(input); return options.uncertain ? { status: "uncertain", channel: "whatsapp_template" }
      : { status: "sent", channel: input.toPhone ? "whatsapp_template" : "email", messageId: "msg" }; } } as any);
  return { service, sent, records, consentChecks };
}
const notice = { merchantId: "m", buyerId: "previous-wa", type: "cashback_available" as const, sourceId: "release-1" };

test("CB-24 absent marketing consent prevents every outbound channel and records the decision", async () => {
  const { service, sent, records, consentChecks } = fixture();
  const result = await service.dispatch(notice);
  assert.equal(result.reason, "cashback_contact_not_authorized"); assert.deepEqual(sent, []);
  assert.equal(records.get("m:cashback_available:release-1").state, "skipped");
  assert.deepEqual(consentChecks, [{ merchantId: "m", globalUserId: "canonical", channel: "whatsapp" }, { merchantId: "m", globalUserId: "canonical", channel: "email" }]);
});

test("CB-24 WhatsApp authorization never grants fallback email authorization", async () => {
  const { service, sent, records } = fixture({ whatsapp: true });
  await service.dispatch(notice);
  assert.equal(sent[0].toPhone, "5511988887777"); assert.equal(sent[0].fallbackEmail, undefined);
  assert.equal(sent[0].variables.cashbackAmount, "R$ 10,00");
  assert.equal(records.get("m:cashback_available:release-1").state, "sent");
});

test("CB-24 revocation before dispatch cancels a claimed notification", async () => {
  const { service, sent, records } = fixture({ whatsapp: true, email: true, revokedBeforeDispatch: true });
  const result = await service.dispatch(notice);
  assert.deepEqual(sent, []); assert.equal(result.reason, "contact_consent_revoked");
  assert.equal(records.get("m:cashback_available:release-1").state, "cancelled");
});

test("CB-23 uncertain notification is recorded and never automatically resent or switched to email", async () => {
  const { service, sent, records } = fixture({ whatsapp: true, email: true, uncertain: true });
  await service.dispatch(notice); await service.dispatch(notice);
  assert.equal(sent.length, 1); assert.equal(records.get("m:cashback_available:release-1").state, "unknown");
});

test("CB-24 cashback templates are marketing and retain exact amount and expiry variables", () => {
  assert.equal(categoryFor("cashback_available"), "MARKETING"); assert.equal(categoryFor("cashback_expiring"), "MARKETING");
  const template = getTemplateDefinition("cashback_expiring");
  assert.ok(Object.values(template.variableMap).includes("cashbackAmount"));
  assert.ok(Object.values(template.variableMap).includes("cashbackExpiresAt")); assert.equal(template.hasCoupon, false);
});
