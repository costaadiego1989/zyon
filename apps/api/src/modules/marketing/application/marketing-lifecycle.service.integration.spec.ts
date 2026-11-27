import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { marketingHttpFixture } from "../marketing-http.fixture.js";
import { marketingTestFixture } from "../marketing-test-fixture.js";
import { MarketingConversationsService } from "./marketing-conversations.service.js";
import {
  MARKETING_CLOCK,
  type MarketingClock,
} from "../domain/marketing-context.port.js";
import { MarketingLifecycleService } from "./marketing-lifecycle.service.js";
import { MarketingCampaignsService } from "./marketing-campaigns.service.js";
import {
  MARKETING_CONTEXT,
  type MarketingContext,
} from "../domain/marketing-context.port.js";
import { MERCHANT_MARKETING_MESSAGING } from "../../../shared/contracts/marketing.js";
import { CampaignContactConsentService } from "../../campaign-consent/campaign-contact-consent.service.js";
import { MARKETING_RELATIONSHIP } from "../../../shared/contracts/marketing.js";
import {
  marketingBrowserFixture,
  expect,
} from "../../../../../dashboard/tests/marketing-browser.fixture.mjs";

const old = "2026-10-01T12:00:00.000Z";

test("MKT-06/6 verified identity merges preserve reservations on both original contacts", async () => {
  const f = await marketingHttpFixture();
  const buyerId = `merge-quota-${randomUUID()}`;
  const phoneNumber = randomInt(100000000, 999999998);
  const phoneA = `5511${phoneNumber}`,
    phoneB = `5511${phoneNumber + 1}`;
  const at = "2026-11-27T16:37:00.000Z";
  try {
    f.app.get<MarketingClock>(MARKETING_CLOCK).now = () => new Date(at);
    await f.db.buyerAccount.create({
      data: {
        globalUserId: buyerId,
        email: `${buyerId}@local.test`,
        displayName: "Comprador local",
      },
    });
    await f.db.buyerVerifiedPhone.create({
      data: { phone: phoneA, buyerId, verificationId: randomUUID() },
    });
    await f.app
      .get(MarketingCampaignsService)
      .configure(f.merchantId, "owner", {
        timezone: "UTC",
        startHour: 0,
        endHour: 24,
        minIntervalHours: 8,
        maxMessagesPerDay: 3,
        retentionDays: 7,
      });
    const original = await f.contacts.inbound({
      merchantId: f.merchantId,
      channel: "whatsapp",
      conversationKey: "phone-a",
      messageId: "phone-a",
      text: "quero receber",
      verifiedPhone: phoneA,
      receivedAt: at,
    });
    const phoneOnly = await f.contacts.inbound({
      merchantId: f.merchantId,
      channel: "whatsapp",
      conversationKey: "phone-b",
      messageId: "phone-b",
      text: "quero receber",
      verifiedPhone: phoneB,
      receivedAt: at,
    });
    assert.notEqual(original.contactId, phoneOnly.contactId);
    const source = (await f.contacts.detail(f.merchantId, original.contactId!))
      .contact;
    const target = (await f.contacts.detail(f.merchantId, phoneOnly.contactId!))
      .contact;
    assert.equal(
      await f.contacts.reserveCommercial(
        f.merchantId,
        buyerId,
        "recovery:before-merge"
      ),
      true
    );
    assert.equal(
      await f.repository.transaction(f.merchantId, "earlier-target", (tx) =>
        tx.reserveCommercial(
          target.identityKey,
          "campaign:before-merge",
          "2026-11-27T06:37:00.000Z",
          8,
          3
        )
      ),
      true
    );
    await f.db.buyerVerifiedPhone.delete({ where: { phone: phoneA } });
    await f.db.buyerVerifiedPhone.create({
      data: { phone: phoneB, buyerId, verificationId: randomUUID() },
    });
    const merged = await f.contacts.identify(f.merchantId, buyerId);
    assert.equal(merged.id, target.id);
    const histories = await f.repository.transaction(
      f.merchantId,
      "history-after-merge",
      async (tx) => ({
        source: await tx.commercialHistory(source.identityKey),
        target: await tx.commercialHistory(merged.identityKey),
      })
    );
    assert.equal(histories.source.length, 0);
    assert.equal(histories.target.length, 2);
    assert.equal(
      await f.contacts.reserveCommercial(
        f.merchantId,
        buyerId,
        "post-sale:after-merge"
      ),
      false
    );
    const rows = await f.db.$queryRawUnsafe<
      Array<{ contact_key: string; dispatch_key: string }>
    >(
      "SELECT contact_key,dispatch_key FROM marketing_commercial_dispatches WHERE merchant_id=$1 ORDER BY dispatch_key",
      f.merchantId
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.contact_key === merged.identityKey));
    assert.equal(
      rows.some((row) => row.dispatch_key === "post-sale:after-merge"),
      false
    );
  } finally {
    await f.db.buyerVerifiedPhone.deleteMany({ where: { buyerId } });
    await f.db.buyerAccount.deleteMany({ where: { globalUserId: buyerId } });
    await f.cleanup();
  }
});

test("MKT-06/6 rolling daily quota blocks after the minimum interval has elapsed and releases only at its boundary", async () => {
  const f = marketingTestFixture();
  try {
    const reserve = (key: string, at: string) =>
      f.repository.transaction(f.merchantId, key, (tx) =>
        tx.reserveCommercial("daily-contact", key, at, 1, 2)
      );
    assert.equal(
      await reserve("daily-first", "2026-11-27T06:00:00.000Z"),
      true
    );
    assert.equal(
      await reserve("daily-second", "2026-11-27T08:00:00.000Z"),
      true
    );
    assert.equal(
      await reserve("daily-rejected", "2026-11-27T10:00:00.000Z"),
      false
    );
    assert.equal(
      (
        await f.repository.transaction(f.merchantId, "daily-read", (tx) =>
          tx.commercialHistory("daily-contact")
        )
      ).length,
      2
    );
    assert.equal(
      await reserve("daily-next-window", "2026-11-28T06:00:00.000Z"),
      true
    );
    assert.equal(
      (
        await f.repository.transaction(f.merchantId, "daily-read", (tx) =>
          tx.commercialHistory("daily-contact")
        )
      ).length,
      3
    );
  } finally {
    await f.cleanup();
  }
});

for (const kind of ["ai", "opening", "agent", "expired-sending"] as const)
  test(`MKT-09/3 retention keeps an unresolved ${kind} attempt for reconciliation`, async () => {
    const f = await marketingHttpFixture();
    let at = new Date("2026-11-17T16:37:00.000Z");
    let attempts = 0;
    try {
      f.app.get<MarketingClock>(MARKETING_CLOCK).now = () => at;
      await f.app
        .get(MarketingCampaignsService)
        .configure(f.merchantId, "owner", {
          timezone: "UTC",
          startHour: 0,
          endHour: 24,
          minIntervalHours: 1,
          maxMessagesPerDay: 2,
          retentionDays: 7,
        });
      const conversations = f.app.get(MarketingConversationsService);
      const input = await f.contacts.inbound({
        merchantId: f.merchantId,
        channel: "whatsapp",
        conversationKey: `retention-${kind}`,
        messageId: `retention-${kind}`,
        text: kind === "opening" ? "Olá" : "Agora não",
        verifiedPhone: "5511971234563",
        receivedAt: at.toISOString(),
      });
      const unknown = async () => {
        attempts++;
        return { status: "unknown" as const };
      };
      if (kind === "opening")
        await conversations.opening(
          f.merchantId,
          input.conversationId,
          unknown
        );
      else if (kind === "agent") {
        const messaging = f.app.get(MERCHANT_MARKETING_MESSAGING);
        messaging.sendFreeform = unknown;
        let conversation = (
          await conversations.detail(f.merchantId, input.conversationId)
        ).conversation;
        conversation = await conversations.ownership(
          f.merchantId,
          input.conversationId,
          f.users.owner.id,
          "claim",
          conversation.version
        );
        await conversations.reply(
          f.merchantId,
          input.conversationId,
          f.users.owner.id,
          "Resposta local incerta",
          "retention-agent",
          conversation.version
        );
        conversation = (
          await conversations.detail(f.merchantId, input.conversationId)
        ).conversation;
        await conversations.ownership(
          f.merchantId,
          input.conversationId,
          f.users.owner.id,
          "release",
          conversation.version
        );
      } else
        await conversations.aiReply(
          f.merchantId,
          input.conversationId,
          "retention-ai",
          "Resposta local incerta",
          unknown
        );
      const message = await f.repository.transaction(
        f.merchantId,
        "uncertain-read",
        async (tx) => {
          const value = (await tx.messages(input.conversationId)).find(
            (message) =>
              message.role ===
              (kind === "opening"
                ? "system"
                : kind === "agent"
                ? "agent"
                : "ai")
          )!;
          assert.equal(value.status, "unknown");
          if (kind === "expired-sending") {
            value.status = "sending";
            await tx.saveMessage(value);
          }
          return value;
        }
      );
      assert.equal(attempts, 1);
      at = new Date("2026-11-27T16:37:00.000Z");
      const lifecycle = f.app.get(MarketingLifecycleService);
      assert.equal(
        (await lifecycle.retentionPreview(f.merchantId)).eligible,
        0
      );
      assert.equal((await lifecycle.retain(f.merchantId)).removed, 0);
      const after = await f.repository.transaction(
        f.merchantId,
        "uncertain-after",
        async (tx) => ({
          message: await tx.messageByKey(message.dedupKey),
          conversation: await tx.conversation(input.conversationId),
        })
      );
      assert.equal(after.message?.id, message.id);
      assert.equal(
        after.message?.status,
        kind === "expired-sending" ? "sending" : "unknown"
      );
      assert.equal(after.conversation?.mode, "ai");
      assert.equal(attempts, 1);
    } finally {
      await f.cleanup();
    }
  });
const settings = {
  timezone: "UTC",
  startHour: 0,
  endHour: 24,
  minIntervalHours: 24,
  maxMessagesPerDay: 1,
  retentionDays: 30,
};

test("MKT-09/1 historical import gestures process proved store sources and repeat without duplicate contacts messages or purchases", async () => {
  const f = await marketingHttpFixture();
  const buyerId = `history-${randomUUID()}`;
  const unknownId = `unknown-${randomUUID()}`;
  const phone = `55119${Date.now().toString().slice(-8)}`;
  try {
    await f.db.buyerAccount.createMany({
      data: [
        {
          globalUserId: buyerId,
          email: `${buyerId}@local.test`,
          displayName: "Ana Histórica",
        },
        {
          globalUserId: unknownId,
          email: `${unknownId}@local.test`,
          displayName: "Origem sem prova",
          phone: "5511988880000",
        },
      ],
    });
    await f.db.buyerVerifiedPhone.create({
      data: { phone, buyerId, verificationId: randomUUID() },
    });
    const legacyMessages = [
      { role: "buyer", content: "Olá, preciso de informações", createdAt: old },
      {
        role: "agent",
        content: "Como posso ajudar?",
        createdAt: "2026-10-01T12:00:01.000Z",
      },
    ];
    await f.db.checkoutSession.create({
      data: {
        merchantId: f.merchantId,
        sessionId: "historical-wa",
        conversationId: "wa-old",
        globalUserId: buyerId,
        cart: { items: [] },
        customer: { phone, phone_verified: true },
        chatHistory: legacyMessages,
        createdAt: new Date(old),
        updatedAt: new Date(old),
      },
    });
    await f.db.whatsAppSession.create({
      data: {
        merchantId: f.merchantId,
        buyerPhone: phone,
        buyerAlias: "Alias não comprovado",
        checkoutSessionId: "historical-wa",
        deviceId: "historical-device",
        createdAt: new Date(old),
        lastActivityAt: new Date(old),
      },
    });
    await f.db.buyerConversation.createMany({
      data: [
        {
          merchantId: f.merchantId,
          globalUserId: buyerId,
          sessionId: "conv_historical-site",
          messages: legacyMessages,
          startedAt: new Date(old),
          lastMessageAt: new Date(old),
        },
        {
          merchantId: f.merchantId,
          globalUserId: unknownId,
          sessionId: "legacy-source-unproven",
          messages: legacyMessages,
          startedAt: new Date(old),
          lastMessageAt: new Date(old),
        },
        {
          merchantId: `other-${f.merchantId}`,
          globalUserId: unknownId,
          sessionId: "conv_foreign",
          messages: legacyMessages,
          startedAt: new Date(old),
          lastMessageAt: new Date(old),
        },
      ],
    });
    await f.db.completedOrder.create({
      data: {
        merchantId: f.merchantId,
        sessionId: "historical-wa",
        externalOrderId: "historical-paid",
        orderTotal: "123.45",
        currency: "BRL",
        completedAt: new Date(old),
      },
    });
    await f.db.campaignContactConsent.create({
      data: {
        merchantId: f.merchantId,
        globalUserId: buyerId,
        channel: "whatsapp",
        purpose: "marketing",
        status: "granted",
        source: "storefront_consent",
        policyVersion: "storefront_privacy_2026_10_05",
        grantedAt: new Date(old),
        evidence: { decidedAt: old, recordedAt: old },
      },
    });
    const messaging = f.app.get(MERCHANT_MARKETING_MESSAGING);
    let outbound = 0;
    for (const method of [
      "sendFreeform",
      "sendOpening",
      "submitTemplate",
      "sendCampaign",
    ])
      messaging[method] = async () => {
        outbound++;
        throw new Error("import_must_never_send");
      };
    const browser = await marketingBrowserFixture(f);
    const lifecycle = f.app.get(MarketingLifecycleService);
    try {
      await browser.page.goto(`${browser.url}&view=marketing&role=owner`);
      await browser.page
        .getByRole("tab", { name: "Configurações", exact: true })
        .click();
      await browser.page
        .getByRole("button", {
          name: "Importar histórico disponível",
          exact: true,
        })
        .click();
      await expect(
        browser.page.getByText(/Na fila · 0 registros/)
      ).toBeVisible();
      for (
        let batch = 0;
        batch < 10 &&
        (await lifecycle.status(f.merchantId))?.status !== "completed";
        batch++
      )
        await lifecycle.process(f.merchantId);
      await expect(
        browser.page.getByText(
          /Concluída · 4 registros analisados · 6 mensagens adicionadas/
        )
      ).toBeVisible();
      const contacts = await f.contacts.list(f.merchantId, {
        limit: 100,
        offset: 0,
      });
      assert.equal(contacts.total, 2);
      const buyer = contacts.items.find((c) => c.accountId === buyerId)!;
      const unknown = contacts.items.find((c) => c.accountId === unknownId)!;
      assert.deepEqual([...buyer.channels].sort(), ["site", "whatsapp"]);
      assert.equal(buyer.origin, "whatsapp");
      assert.equal(buyer.purchaseCount, 1);
      assert.equal(buyer.totalSpentCents, 12345);
      assert.equal(unknown.origin, "unknown");
      assert.equal(unknown.phone, null);
      assert.deepEqual(unknown.channels, []);
      assert.equal(
        (await f.contacts.detail(f.merchantId, buyer.id)).consent?.status,
        "granted"
      );
      assert.equal(
        (await f.contacts.detail(f.merchantId, unknown.id)).consent,
        null
      );
      const conversationRows = await f.repository.transaction(
        f.merchantId,
        "read",
        (tx) => tx.conversations(100, 0)
      );
      assert.equal(conversationRows.total, 3);
      for (const conversation of conversationRows.items) {
        const messages = await f.repository.transaction(
          f.merchantId,
          "read",
          (tx) => tx.messages(conversation.id)
        );
        assert.equal(messages.length, 2);
        assert.ok(
          messages.every(
            (m) => m.status === "recorded" && m.providerMessageId === null
          )
        );
      }
      await browser.page
        .getByRole("button", {
          name: "Importar histórico novamente",
          exact: true,
        })
        .click();
      await expect(
        browser.page.getByText(/Na fila · 0 registros/)
      ).toBeVisible();
      for (
        let batch = 0;
        batch < 10 &&
        (await lifecycle.status(f.merchantId))?.status !== "completed";
        batch++
      )
        await lifecycle.process(f.merchantId);
      await expect(
        browser.page.getByText(
          /Concluída · 4 registros analisados · 0 mensagens adicionadas/
        )
      ).toBeVisible();
      const again = await f.contacts.list(f.merchantId, {
        limit: 100,
        offset: 0,
      });
      assert.equal(again.total, 2);
      assert.equal(
        again.items.find((c) => c.id === buyer.id)?.purchaseCount,
        1
      );
      assert.equal(
        again.items.find((c) => c.id === buyer.id)?.totalSpentCents,
        12345
      );
      assert.equal(outbound, 0);
      assert.deepEqual(browser.errors, []);
      assert.equal(
        (await f.request("/history", { role: "staff", method: "POST" })).status,
        403
      );
    } finally {
      await browser.close();
    }
  } finally {
    await f.db.completedOrder.deleteMany({
      where: { merchantId: f.merchantId },
    });
    await f.db.checkoutSession.deleteMany({
      where: { merchantId: f.merchantId },
    });
    await f.db.whatsAppSession.deleteMany({
      where: { merchantId: f.merchantId },
    });
    await f.db.buyerVerifiedPhone.deleteMany({ where: { buyerId } });
    await f.db.buyerAccount.deleteMany({
      where: { globalUserId: { in: [buyerId, unknownId] } },
    });
    await f.cleanup();
  }
});

test("MKT-09/3 retention removes only inactive relationship data and preserves purchases active handoff and hashed opt-outs", async () => {
  const f = await marketingHttpFixture();
  try {
    await f.app
      .get(MarketingCampaignsService)
      .configure(f.merchantId, "owner", settings);
    const stale = f.contact({
      firstSeenAt: old,
      lastSeenAt: old,
      stageAt: old,
      phone: "5511987651111",
    });
    const buyer = f.contact({
      firstSeenAt: old,
      lastSeenAt: old,
      stageAt: old,
      phone: "5511987652222",
      purchaseCount: 1,
      totalSpentCents: 100,
    });
    const human = f.contact({
      firstSeenAt: old,
      lastSeenAt: old,
      stageAt: old,
      phone: "5511987653333",
    });
    await f.repository.transaction(f.merchantId, "seed", async (tx) => {
      for (const c of [stale, buyer, human]) await tx.saveContact(c);
      await tx.saveConsent({
        id: randomUUID(),
        merchantId: f.merchantId,
        contactId: stale.id,
        channel: "whatsapp",
        status: "revoked",
        recordedAt: old,
        version: "historical-v1",
        text: "Old text",
        source: "buyer",
        evidenceId: "old-evidence",
      });
      await tx.saveConversation({
        id: randomUUID(),
        merchantId: f.merchantId,
        contactId: human.id,
        channel: "whatsapp",
        externalId: "human-old",
        mode: "human",
        assignedUserId: "active-agent",
        version: 1,
        lastInboundAt: old,
        updatedAt: old,
        deviceId: null,
        openingChoice: "declined",
        pendingQuestion: null,
      });
    });
    const lifecycle = f.app.get(MarketingLifecycleService);
    assert.equal((await lifecycle.retentionPreview(f.merchantId)).eligible, 1);
    assert.equal((await lifecycle.retain(f.merchantId)).removed, 1);
    await assert.rejects(
      f.contacts.detail(f.merchantId, stale.id),
      /marketing_contact_not_found/
    );
    assert.equal(
      (await f.contacts.detail(f.merchantId, buyer.id)).contact.totalSpentCents,
      100
    );
    assert.equal(
      (await f.contacts.detail(f.merchantId, human.id)).activity
        .conversations[0].mode,
      "human"
    );
    const rows = await f.db.$queryRawUnsafe<
      Array<{ identity_hash: string; data: unknown }>
    >(
      "SELECT identity_hash,data FROM marketing_suppressions WHERE merchant_id=$1",
      f.merchantId
    );
    assert.equal(rows.length, 1);
    assert.match(rows[0].identity_hash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(rows).includes(stale.phone!), false);
    assert.equal(JSON.stringify(rows).includes("old-evidence"), false);
    const returning = await f.contacts.inbound({
      merchantId: f.merchantId,
      channel: "whatsapp",
      conversationKey: "returning-after-retention",
      messageId: "new-after-retention",
      text: "Olá de novo",
      verifiedPhone: stale.phone!,
      receivedAt: new Date().toISOString(),
    });
    assert.equal(returning.openingRequired, false);
    assert.equal(
      (await f.contacts.detail(f.merchantId, returning.contactId!)).consent
        ?.status,
      "revoked"
    );
    assert.equal((await lifecycle.retain(f.merchantId)).removed, 0);
  } finally {
    await f.cleanup();
  }
});

test("MKT-06/6 recovery post-sale and campaigns share one tenant quota and a different store opt-out does not block this store", async () => {
  const f = await marketingHttpFixture();
  const accountId = `shared-${randomUUID()}`;
  const phone = `55119${Date.now().toString().slice(-8)}`;
  const otherId = `other-${f.merchantId}`;
  try {
    await f.db.buyerAccount.create({
      data: {
        globalUserId: accountId,
        email: `${accountId}@test.local`,
        displayName: "Comprador",
      },
    });
    await f.db.buyerVerifiedPhone.create({
      data: { phone, buyerId: accountId, verificationId: randomUUID() },
    });
    const first = await f.contacts.inbound({
      merchantId: f.merchantId,
      channel: "whatsapp",
      conversationKey: "shared-conversation",
      messageId: "shared-consent",
      text: "quero receber",
      verifiedPhone: phone,
      receivedAt: old,
    });
    await f.app
      .get(MarketingCampaignsService)
      .configure(f.merchantId, "owner", settings);
    const bridge = new CampaignContactConsentService(
      f.db,
      f.app.get(MARKETING_RELATIONSHIP)
    );
    assert.equal(
      await bridge.canContact({
        merchantId: f.merchantId,
        globalUserId: accountId,
        channel: "whatsapp",
      }),
      true
    );
    assert.equal(
      await bridge.reserveCommercial({
        merchantId: f.merchantId,
        globalUserId: accountId,
        dispatchKey: "recovery:test",
      }),
      true
    );
    assert.equal(
      await bridge.reserveCommercial({
        merchantId: f.merchantId,
        globalUserId: accountId,
        dispatchKey: "post-sale:test",
      }),
      false
    );
    const allowed = await f.repository.transaction(
      f.merchantId,
      "test-quota",
      (tx) =>
        tx.reserveCommercial(
          `account:${accountId}`,
          "campaign:test",
          new Date().toISOString(),
          24,
          1
        )
    );
    assert.equal(allowed, false);
    await f.db.merchant.create({ data: { id: otherId, name: "Outra loja" } });
    await f.db.campaignContactConsent.create({
      data: {
        merchantId: otherId,
        globalUserId: accountId,
        channel: "whatsapp",
        purpose: "marketing",
        status: "revoked",
        revokedAt: new Date(),
        policyVersion: "v1",
        source: "buyer",
        evidence: {},
      },
    });
    assert.equal(
      await bridge.canContact({
        merchantId: f.merchantId,
        globalUserId: accountId,
        channel: "whatsapp",
      }),
      true
    );
    await f.db.campaignContactConsent.create({
      data: {
        merchantId: f.merchantId,
        globalUserId: accountId,
        channel: "whatsapp",
        purpose: "marketing",
        status: "revoked",
        revokedAt: new Date(),
        policyVersion: "v1",
        source: "buyer",
        evidence: {},
      },
    });
    assert.equal(
      await bridge.canContact({
        merchantId: f.merchantId,
        globalUserId: accountId,
        channel: "whatsapp",
      }),
      false
    );
    const context = f.app.get<MarketingContext>(MARKETING_CONTEXT);
    assert.deepEqual(
      [
        ...(await context.blockedAccounts!(
          [{ accountId, consentAt: old }],
          f.merchantId
        )),
      ],
      [accountId]
    );
    assert.equal(
      (await f.contacts.detail(f.merchantId, first.contactId!)).contact.phone,
      phone
    );
  } finally {
    await f.db.merchant.deleteMany({ where: { id: otherId } });
    await f.db.buyerVerifiedPhone.deleteMany({ where: { buyerId: accountId } });
    await f.db.buyerAccount.deleteMany({ where: { globalUserId: accountId } });
    await f.cleanup();
  }
});
