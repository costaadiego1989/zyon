import { test } from "node:test";
import assert from "node:assert/strict";
import { marketingHttpFixture } from "../marketing-http.fixture.js";
import {
  MARKETING_RELATIONSHIP,
  type MarketingRelationshipPort,
} from "../../../shared/contracts/marketing.js";
import { MarketingConversationsService } from "../application/marketing-conversations.service.js";
import { SendStoreMessageUseCase } from "../../storefront/application/use-cases/send-store-message.use-case.js";
import { GetConversationHistoryUseCase } from "../../storefront/application/use-cases/get-conversation-history.use-case.js";
import {
  marketingBrowserFixture,
  expect,
} from "../../../../../dashboard/tests/marketing-browser.fixture.mjs";

test("MKT-02/4 actual site view model requires optional opening and polls human replies without creating an anonymous lead", async () => {
  const f = await marketingHttpFixture();
  const browser = await marketingBrowserFixture(f, {
    entry: "../../storefront/tests/marketing-conversation-entry.tsx",
  });
  try {
    const port = f.app.get<MarketingRelationshipPort>(MARKETING_RELATIONSHIP);
    const conversations = f.app.get(MarketingConversationsService);
    const seenHistory: unknown[][] = [];
    const send = new SendStoreMessageUseCase(
      {
        getProfile: async () => ({ id: f.merchantId, name: "Loja" }),
        getStoreSettings: async () => ({}),
      } as never,
      {
        reply: async (input: any) => {
          seenHistory.push(input.history);
          return {
            message: "Resposta da assistente",
            blocks: [],
            suggestedNext: [],
          };
        },
      } as never,
      f.db,
      {findForMerchant:async()=>null} as never,
      undefined,
      undefined,
      port
    );
    const getHistory = new GetConversationHistoryUseCase({} as never, port);
    const conversationId = "conv_browser_marketing";
    const capability =
      Buffer.from(
        JSON.stringify({
          aiUserId: "local",
          origin: new URL(browser.url).origin,
          expiresAt: Date.now() / 1000 + 3600,
        })
      ).toString("base64url") + ".local-browser-fixture";
    let commands = 0;
    await browser.page.route("**/api/storefront**", async (route) => {
      try {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/storefront-conversations")
          return route.fulfill({
            json: {
              merchant_id: f.merchantId,
              conversation_id: conversationId,
              conversation_token: capability,
              message: "",
            },
          });
        assert.equal(
          route.request().headers().authorization,
          `Bearer ${capability}`
        );
        if (path.endsWith("/messages")) {
          commands++;
          const body = route.request().postDataJSON();
          const result = await send.execute({
            ...body,
            merchant_id: f.merchantId,
            conversation_id: conversationId,
          });
          return route.fulfill({ json: result });
        }
        if (path.endsWith(`/conversations/${conversationId}`))
          return route.fulfill({
            json: await getHistory.execute({
              merchant_id: f.merchantId,
              conversation_id: conversationId,
            }),
          });
        return route.fulfill({
          json: { cartId: conversationId, items: [], itemCount: 0, total: 0 },
        });
      } catch (error) {
        console.error("site_route_failure", error);
        return route.fulfill({
          status: 500,
          json: { message: "local_test_failed" },
        });
      }
    });
    await browser.page.goto(browser.url);
    await expect(
      browser.page.getByRole("heading", {
        name: "Antes de começar",
        exact: true,
      })
    ).toBeVisible();
    assert.equal(commands, 0);
    await browser.page
      .getByRole("button", { name: "Agora não", exact: true })
      .click();
    await browser.page
      .getByLabel("Mensagem", { exact: true })
      .fill("Preciso de ajuda");
    await browser.page
      .getByRole("button", { name: "Enviar", exact: true })
      .click();
    await expect(
      browser.page.getByText("Resposta da assistente", { exact: true })
    ).toBeVisible();
    assert.equal(seenHistory.length, 1);
    let conversation = (await conversations.list(f.merchantId)).items[0];
    await conversations.ownership(
      f.merchantId,
      conversation.id,
      f.users.owner.id,
      "claim",
      conversation.version
    );
    await browser.page
      .getByLabel("Mensagem", { exact: true })
      .fill("Quero falar com a equipe");
    await browser.page
      .getByRole("button", { name: "Enviar", exact: true })
      .click();
    await expect(browser.page.getByRole("status")).toHaveText(
      "Atendimento humano"
    );
    assert.equal(seenHistory.length, 1);
    conversation = (await conversations.detail(f.merchantId, conversation.id))
      .conversation;
    const answer = await f.request(
      `/conversations/${conversation.id}/messages`,
      {
        method: "POST",
        body: {
          content: "Resposta humana pelo painel",
          requestId: "site-human-browser",
          version: conversation.version,
        },
      }
    );
    assert.equal(answer.status, 201);
    await expect(
      browser.page.getByText("Resposta humana pelo painel", { exact: true })
    ).toBeVisible();
    await browser.page.reload();
    await expect(
      browser.page.getByText("Resposta humana pelo painel", { exact: true })
    ).toBeVisible();
    await expect(
      browser.page.getByRole("heading", {
        name: "Antes de começar",
        exact: true,
      })
    ).toHaveCount(0);
    conversation = (await conversations.detail(f.merchantId, conversation.id))
      .conversation;
    await conversations.ownership(
      f.merchantId,
      conversation.id,
      f.users.owner.id,
      "release",
      conversation.version
    );
    await browser.page
      .getByLabel("Mensagem", { exact: true })
      .fill("Pode continuar");
    await browser.page
      .getByRole("button", { name: "Enviar", exact: true })
      .click();
    await expect(browser.page.getByRole("status")).toHaveText(
      "Assistente disponível"
    );
    assert.equal(seenHistory.length, 2);
    assert.ok(
      seenHistory[1].some(
        (message: any) => message.content === "Resposta humana pelo painel"
      )
    );
    assert.equal(
      (await f.contacts.list(f.merchantId, { limit: 100, offset: 0 })).total,
      0
    );
    assert.deepEqual(browser.errors, []);
  } finally {
    await browser.close();
    await f.cleanup();
  }
});
