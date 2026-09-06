import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { RecoveryScannerJob } from "../infrastructure/jobs/recovery-scanner.job.js";
import { AttemptCartRecoveryUseCase } from "../application/use-cases/attempt-cart-recovery.use-case.js";
import { InMemoryRecoveryAttemptRepository } from "../infrastructure/repositories/in-memory-recovery-attempt.repository.js";
import { InMemoryStrategyPreferencesRepository } from "../infrastructure/repositories/in-memory-strategy-preferences.repository.js";
import { PrismaRecoveryAttemptRepository } from "../infrastructure/repositories/prisma-recovery-attempt.repository.js";
import { RecoveryAttempt } from "../domain/entities/recovery-attempt.entity.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession, merchantRules } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryBuyerPurchaseHistoryRepository } from "../../buyer-purchase-history/infrastructure/in-memory-buyer-purchase-history.repository.js";
import { InMemoryBuyerAccountRepository } from "../../buyer-account/infrastructure/in-memory-buyer-account.repository.js";
import { BuyerAccount } from "../../buyer-account/domain/entities/buyer-account.entity.js";
import { SendWhatsAppMessageUseCase } from "../../whatsapp-templates/application/use-cases/send-whatsapp-message.use-case.js";
import type { WhatsAppConfigRepository } from "../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import type { WhatsAppTemplateRepositoryPort } from "../../whatsapp-templates/domain/ports/whatsapp-template-repository.port.js";

const scenarios = [
  { name: "connected and approved", status: "ACTIVE", approved: true, timeout: false, channel: "whatsapp_template", attemptStatus: "sent", whatsapp: 1, email: 0 },
  { name: "disconnected", status: "DISCONNECTED", approved: true, timeout: false, channel: "email", attemptStatus: "sent", whatsapp: 0, email: 1 },
  { name: "pending verification", status: "PENDING_VERIFICATION", approved: true, timeout: false, channel: "email", attemptStatus: "sent", whatsapp: 0, email: 1 },
  { name: "unapproved template", status: "ACTIVE", approved: false, timeout: false, channel: "email", attemptStatus: "sent", whatsapp: 0, email: 1 },
  { name: "WhatsApp acceptance unknown", status: "ACTIVE", approved: true, timeout: true, channel: "whatsapp_template", attemptStatus: "unknown", whatsapp: 1, email: 0 },
] as const;

for (const scenario of scenarios) {
  test(`scanner -> attempt -> shared router: ${scenario.name}`, async (context) => {
    const now = new Date("2026-09-05T12:00:00Z");
    context.mock.method(Math, "random", () => 0);
    context.mock.timers.enable({ apis: ["setTimeout", "Date"], now });
    const session = checkoutSession({ triggerAgent: true, abandonmentScore: 0.9, createdAt: now.toISOString(), updatedAt: now.toISOString() });
    const sessions = new InMemoryCheckoutRepository();
    await sessions.saveSession(session);
    const attempts = new InMemoryRecoveryAttemptRepository();
    const buyers = new InMemoryBuyerAccountRepository();
    await buyers.save(new BuyerAccount({
      globalUserId: session.globalUserId, email: "buyer@example.invalid", passwordHash: null,
      displayName: "Test buyer", phone: "+5511999991111", createdAt: now, updatedAt: now,
    }));
    const configs: WhatsAppConfigRepository = { findByMerchantId: async (merchantId: string) => ({
      id: "connection", merchantId, enabled: true, status: scenario.status, provider: "TWILIO",
      whatsappNumber: "+5511999990000", createdAt: now, updatedAt: now,
      credentials: { accountSid: "AC-test", authToken: "fake-token", senderId: "whatsapp:+5511999990000" },
    }),
      findById: async () => null, findByDeviceId: async () => null,
      findByWhatsAppNumber: async () => null, findByMetaPhoneNumberId: async () => null,
      upsert: async () => { throw new Error("Routing must not change connection configuration"); },
    };
    const templates: WhatsAppTemplateRepositoryPort = { findByMerchantAndType: async (merchantId: string, type: string, channel: string) => ({
      id: "template", merchantId, type, channel, name: "Recovery", body: "Olá {{1}}", subject: null,
      isActive: true, metaCategory: "MARKETING", metaLanguage: "pt_BR", metaTemplateBody: "Olá {{1}}",
      metaVariableMap: { "1": "buyerName" }, twilioContentSid: "HX-test",
      metaStatus: scenario.approved ? "approved" : "rejected", metaRejectionReason: null,
      createdAt: now, updatedAt: now,
    }),
      findAllByMerchant: async () => [],
      upsert: async () => { throw new Error("Routing must not invent a template"); },
      updateMeta: async () => { throw new Error("Routing must not invent template approval"); },
    };
    let whatsapp = 0;
    let email = 0;
    let bubble = 0;
    const router = new SendWhatsAppMessageUseCase(templates, {
      sendTemplate: async (request) => {
        assert.equal(request.merchantId, session.merchantId);
        assert.equal(request.type, "cart_recovery");
        whatsapp++;
        if (scenario.timeout) throw new Error("provider acceptance unknown");
        return { messageId: "SM-test", status: "queued" };
      },
    }, { send: async () => { bubble++; return { status: "accepted" }; } }, {
      send: async (request) => {
        assert.equal(request.to, "buyer@example.invalid");
        email++;
        return { messageId: "email-test", status: "queued" };
      },
    }, configs);
    const useCase = new AttemptCartRecoveryUseCase(attempts, { now: () => now }, router);
    const prisma = {
      checkoutEvent: { findMany: async () => [{ eventName: "shipping_objection_detected" }] },
      merchant: { findUnique: async () => ({ name: "Test shop" }) },
    } as unknown as PrismaClient;
    const scanner = new RecoveryScannerJob(sessions, attempts,
      { getRules: async () => merchantRules({ allowFreeShipping: false }), updateRules: async () => merchantRules() },
      new InMemoryStrategyPreferencesRepository(), new InMemoryBuyerPurchaseHistoryRepository(),
      prisma, useCase, buyers);

    const scan = scanner.scan();
    context.mock.timers.tick(0);
    const result = await scan;
    assert.equal(result.scanned, 1);
    assert.equal(result.errors, 0);
    assert.equal(attempts.count(), 1);
    const attempt = attempts.getAll()[0]!;
    assert.equal(attempt.status, scenario.attemptStatus);
    assert.equal(attempt.channel, scenario.channel);
    assert.equal(attempt.sentAt?.getTime() ?? null, scenario.timeout ? null : now.getTime());
    assert.equal(whatsapp, scenario.whatsapp);
    assert.equal(email, scenario.email);
    assert.equal(bubble, 0);
    const rescan = scanner.scan();
    context.mock.timers.tick(0);
    await rescan;
    assert.equal(whatsapp, scenario.whatsapp);
    assert.equal(email, scenario.email);
  });
}

test("Prisma persists the actual channel and uncertain status on update", async () => {
  const writes: { update: { channel: string; status: string; sentAt: Date | null } }[] = [];
  const prisma = { recoveryAttempt: { upsert: async (args: typeof writes[number]) => { writes.push(args); } } } as unknown as PrismaClient;
  const repo = new PrismaRecoveryAttemptRepository(prisma);
  const attempt = new RecoveryAttempt({
    id: "attempt", merchantId: "merchant", sessionId: "session", globalUserId: "buyer",
    abandonmentReason: "unknown", abandonmentScore: 0.9, strategy: { type: "address_objection", objection: "shipping", response_template: "Help" },
    channel: "none", status: "pending", sentAt: null, recoveredAt: null, recoveredOrderId: null, createdAt: new Date(0),
  });
  await repo.save(attempt.markUnknown("whatsapp_template"));
  assert.equal(writes[0]?.update.status, "unknown");
  assert.equal(writes[0]?.update.channel, "whatsapp_template");
  assert.equal(writes[0]?.update.sentAt, null);
  await repo.save(attempt.markSent(new Date(1000), "email"));
  assert.equal(writes[1]?.update.channel, "email");
  assert.equal(writes[1]?.update.sentAt?.getTime(), 1000);
});
