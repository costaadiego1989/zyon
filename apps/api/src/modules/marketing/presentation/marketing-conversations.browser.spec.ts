import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { marketingHttpFixture } from "../marketing-http.fixture.js";
import {
  marketingBrowserFixture,
  expect,
} from "../../../../../dashboard/tests/marketing-browser.fixture.mjs";
import { MarketingConversationsService } from "../application/marketing-conversations.service.js";

test("MKT-07/1 inbox filters and assignment counts run over the full tenant base", async () => {
  const api = await marketingHttpFixture();
  try {
    const first = await api.contacts.inbound({
      merchantId: api.merchantId,
      channel: "whatsapp",
      conversationKey: "wa-filter",
      messageId: "wa-filter",
      text: "Olá",
      verifiedPhone: "5511988881234",
      receivedAt: new Date().toISOString(),
    });
    const conversations = api.app.get(MarketingConversationsService);
    const before = await conversations.detail(
      api.merchantId,
      first.conversationId
    );
    await conversations.ownership(
      api.merchantId,
      first.conversationId,
      api.users.owner.id,
      "claim",
      before.conversation.version
    );
    for (let index = 0; index < 30; index++)
      await api.contacts.inbound({
        merchantId: api.merchantId,
        channel: "site",
        conversationKey: `site-filter-${index}`,
        messageId: `filter-${index}`,
        text: "Olá",
        receivedAt: new Date().toISOString(),
      });
    const mine = await (
      await api.request("/conversations?assignment=mine&limit=1")
    ).json();
    assert.equal(mine.total, 1);
    assert.equal(mine.items[0].id, first.conversationId);
    const staff = await (
      await api.request("/conversations?assignment=mine", { role: "staff" })
    ).json();
    assert.equal(staff.total, 0);
    const site = await (
      await api.request(
        "/conversations?channel=site&assignment=unassigned&limit=5&offset=20"
      )
    ).json();
    assert.equal(site.total, 30);
    assert.equal(site.items.length, 5);
    assert.ok(
      site.items.every(
        (c: { channel: string; mode: string }) =>
          c.channel === "site" && c.mode === "ai"
      )
    );
    const phone = await (
      await api.request("/conversations?search=88881234")
    ).json();
    assert.equal(phone.total, 1);
    assert.equal(phone.items[0].id, first.conversationId);
  } finally {
    await api.cleanup();
  }
});

test("MKT-03/4 inbox gestures claim, reply and release an anonymous site conversation through the authenticated API", async () => {
  const api = await marketingHttpFixture();
  try {
    const decision = await api.contacts.inbound({
      merchantId: api.merchantId,
      channel: "site",
      conversationKey: "site-inbox",
      messageId: "buyer-first",
      text: "Preciso de ajuda com os tamanhos",
      receivedAt: new Date().toISOString(),
    });
    const browser = await marketingBrowserFixture(api);
    try {
      await browser.page.goto(
        `${browser.url}&view=conversations&user=${api.users.owner.id}`
      );
      await browser.page
        .getByRole("button", { name: /Sessão anônima do site/ })
        .click();
      await expect(browser.page.getByRole("log")).toContainText(
        "Preciso de ajuda com os tamanhos"
      );
      await expect(
        browser.page.getByLabel("Responder ao cliente")
      ).toBeDisabled();
      await browser.page
        .getByRole("button", { name: "Assumir conversa", exact: true })
        .click();
      await expect(
        browser.page.getByText("Site · Atendimento com você", { exact: true })
      ).toBeVisible();
      await browser.page
        .getByLabel("Responder ao cliente")
        .fill("O tamanho disponível é 38. Posso ajudar a escolher.");
      await browser.page
        .getByRole("button", { name: "Enviar resposta", exact: true })
        .click();
      await expect(browser.page.getByRole("log")).toContainText(
        "O tamanho disponível é 38. Posso ajudar a escolher."
      );
      await expect(browser.page.getByRole("status")).toHaveText(
        "Resposta publicada no site."
      );
      const service = api.app.get(MarketingConversationsService);
      let detail = await service.detail(
        api.merchantId,
        decision.conversationId
      );
      assert.equal(detail.conversation.mode, "human");
      assert.equal(
        detail.messages.find((m) => m.role === "agent")?.authorId,
        api.users.owner.id
      );
      assert.equal(
        detail.messages.find((m) => m.role === "agent")?.status,
        "accepted"
      );
      await browser.page
        .getByRole("button", { name: "Finalizar atendimento", exact: true })
        .click();
      await expect(
        browser.page.getByText("Site · IA ativa", { exact: true })
      ).toBeVisible();
      detail = await service.detail(api.merchantId, decision.conversationId);
      assert.equal(detail.conversation.mode, "ai");
      assert.equal(detail.conversation.assignedUserId, null);
      await browser.page.setViewportSize({ width: 320, height: 800 });
      await browser.page
        .getByRole("button", { name: "Voltar à lista", exact: true })
        .click();
      await expect(
        browser.page.getByRole("button", { name: /Sessão anônima do site/ })
      ).toBeVisible();
      assert.equal(
        await browser.page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        ),
        false
      );
      assert.deepEqual(browser.errors, []);
    } finally {
      await browser.close();
    }
  } finally {
    await api.cleanup();
  }
});

test("MKT-03/1 message cursors preserve every same-timestamp message without duplicates across older pages", async () => {
  const api = await marketingHttpFixture();
  try {
    const decision = await api.contacts.inbound({
      merchantId: api.merchantId,
      channel: "site",
      conversationKey: "long-thread",
      messageId: "first",
      text: "Mensagem 0",
      receivedAt: api.now,
    });
    await api.repository.transaction(api.merchantId, "seed", async (tx) => {
      for (let index = 1; index <= 102; index++)
        await tx.appendMessage({
          id: randomUUID(),
          merchantId: api.merchantId,
          conversationId: decision.conversationId,
          dedupKey: `long:${index}`,
          role: "buyer",
          content: `Mensagem ${index}`,
          createdAt: api.now,
          status: "accepted",
          providerMessageId: null,
          authorId: null,
          campaignId: null,
        });
    });
    const firstResponse = await api.request(
      `/conversations/${decision.conversationId}`
    );
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.messages.length, 50);
    assert.equal(first.messages[0].content, "Mensagem 53");
    assert.equal(first.hasMore, true);
    const second = await (
      await api.request(
        `/conversations/${decision.conversationId}?before=${first.before}`
      )
    ).json();
    assert.equal(second.messages[0].content, "Mensagem 3");
    assert.equal(second.messages.at(-1).content, "Mensagem 52");
    assert.equal(second.hasMore, true);
    const third = await (
      await api.request(
        `/conversations/${decision.conversationId}?before=${second.before}`
      )
    ).json();
    assert.equal(third.messages.length, 3);
    assert.equal(third.hasMore, false);
    assert.equal(third.before, null);
    const messages = [...third.messages, ...second.messages, ...first.messages];
    assert.deepEqual(
      messages.map((m) => m.content),
      Array.from({ length: 103 }, (_, i) => `Mensagem ${i}`)
    );
    assert.equal(new Set(messages.map((m) => m.id)).size, 103);
    assert.equal(
      (
        await api.request(
          `/conversations/${decision.conversationId}?before=malformed`
        )
      ).status,
      400
    );
  } finally {
    await api.cleanup();
  }
});
