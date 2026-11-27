import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { marketingHttpFixture } from "../marketing-http.fixture.js";
import {
  MARKETING_RELATIONSHIP,
  type MarketingRelationshipPort,
} from "../../../shared/contracts/marketing.js";
import { MarketingConversationsService } from "../application/marketing-conversations.service.js";
import { SendStoreMessageUseCase } from "../../storefront/application/use-cases/send-store-message.use-case.js";
import { GetConversationHistoryUseCase } from "../../storefront/application/use-cases/get-conversation-history.use-case.js";

async function setup() {
  const f = await marketingHttpFixture();
  const port = f.app.get<MarketingRelationshipPort>(MARKETING_RELATIONSHIP);
  const conversations = f.app.get(MarketingConversationsService);
  const calls: Array<{ history: Array<{ role: string; content: string }> }> =
    [];
  const engine = {
    reply: async (input: (typeof calls)[number]) => {
      calls.push(input);
      return { message: "Como posso ajudar?", blocks: [], suggestedNext: [] };
    },
  };
  const useCase = new SendStoreMessageUseCase(
    {
      getProfile: async () => ({ id: f.merchantId, name: "Loja" }),
      getStoreSettings: async () => ({}),
    } as never,
    engine as never,
    f.db,
    {findForMerchant:async()=>null} as never,
    undefined,
    undefined,
    port
  );
  const getHistory = new GetConversationHistoryUseCase({} as never, port);
  const send = (text: string, overrides = {}) =>
    useCase.execute({
      merchant_id: f.merchantId,
      conversation_id: "site-thread",
      user_message: text,
      message_id: randomUUID(),
      ...overrides,
    });
  return {
    ...f,
    port,
    conversations,
    calls,
    engine,
    useCase,
    getHistory,
    send,
    cleanup: async () => {
      await f.cleanup();
    },
  };
}

test("MKT-03/4 site human mode persists anonymous messages, delivers agent replies and resumes AI with context", async () => {
  const f = await setup();
  try {
    await f.send("Olá", { marketing_consent: "declined" });
    assert.equal(
      (await f.contacts.list(f.merchantId, { limit: 10, offset: 0 })).total,
      0
    );
    let c = (await f.conversations.list(f.merchantId)).items[0];
    await f.conversations.ownership(
      f.merchantId,
      c.id,
      "agent",
      "claim",
      c.version
    );
    const waiting = await f.send("Preciso de ajuda humana");
    assert.equal(waiting.handoff, true);
    assert.equal(waiting.message, "");
    assert.equal(f.calls.length, 1);
    c = (await f.conversations.detail(f.merchantId, c.id)).conversation;
    const replied = await f.conversations.reply(
      f.merchantId,
      c.id,
      "agent",
      "Você pode trocar em até 30 dias",
      "agent-site-reply",
      c.version
    );
    const visible = await f.getHistory.execute({
      merchant_id: f.merchantId,
      conversation_id: "site-thread",
    });
    assert.equal(visible.handoff, true);
    assert.deepEqual(
      visible.messages.map((m) => m.content),
      [
        "Olá",
        "Como posso ajudar?",
        "Preciso de ajuda humana",
        "Você pode trocar em até 30 dias",
      ]
    );
    await f.conversations.ownership(
      f.merchantId,
      c.id,
      "agent",
      "release",
      replied.conversation.version
    );
    await f.send("Entendi, pode continuar");
    assert.ok(
      f.calls[1].history.some(
        (m) =>
          m.role === "assistant" &&
          m.content === "Você pode trocar em até 30 dias"
      )
    );
    assert.equal(
      (
        await f.getHistory.execute({
          merchant_id: f.merchantId,
          conversation_id: "site-thread",
        })
      ).handoff,
      false
    );
  } finally {
    await f.cleanup();
  }
});

test("MKT-01/2 authenticated site identification creates a lead without inventing a verified phone or consent", async () => {
  const f = await setup();
  const accountId = `buyer-${randomUUID()}`;
  try {
    await f.send("Quero ver produtos", { marketing_consent: "granted" });
    await f.db.buyerAccount.create({
      data: {
        globalUserId: accountId,
        email: `${randomUUID()}@marketing.local`,
        displayName: "Ana Local",
        phone: "5511988881234",
      },
    });
    await f.port.identified(f.merchantId, accountId, "site-thread");
    await f.port.identified(f.merchantId, accountId, "site-thread");
    const page = await f.contacts.list(f.merchantId, { limit: 10, offset: 0 });
    assert.equal(page.total, 1);
    const detail = await f.contacts.detail(f.merchantId, page.items[0].id);
    assert.equal(detail.contact.accountId, accountId);
    assert.equal(detail.contact.name, "Ana Local");
    assert.equal(detail.contact.phone, null);
    assert.equal(detail.consent, null);
    assert.equal(
      (await f.conversations.list(f.merchantId)).items[0].contactId,
      detail.contact.id
    );
  } finally {
    await f.db.buyerAccount.deleteMany({ where: { globalUserId: accountId } });
    await f.cleanup();
  }
});

test("MKT-01/4 an authenticated site account cannot take another account's existing thread", async () => {
  const f = await setup();
  const accounts = [`buyer-${randomUUID()}`, `buyer-${randomUUID()}`];
  try {
    for (const id of accounts)
      await f.db.buyerAccount.create({
        data: {
          globalUserId: id,
          email: `${id}@marketing.local`,
          displayName: id,
        },
      });
    await f.send("Primeira pessoa", { global_user_id: accounts[0] });
    await assert.rejects(
      f.send("Outra pessoa", { global_user_id: accounts[1] }),
      /marketing_conversation_identity_changed/
    );
    const contacts = await f.contacts.list(f.merchantId, {
      limit: 10,
      offset: 0,
    });
    assert.equal(contacts.total, 1);
    assert.equal(contacts.items[0].accountId, accounts[0]);
    assert.equal(
      (
        await f.getHistory.execute({
          merchant_id: f.merchantId,
          conversation_id: "site-thread",
        })
      ).messages.some((m) => m.content === "Outra pessoa"),
      false
    );
  } finally {
    await f.db.buyerAccount.deleteMany({
      where: { globalUserId: { in: accounts } },
    });
    await f.cleanup();
  }
});

test("MKT-03/2 takeover during site generation suppresses the late reply and its commerce blocks", async () => {
  const f = await setup();
  try {
    let started!: () => void, release!: () => void;
    const generating = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.engine.reply = async (input) => {
      f.calls.push(input);
      started();
      await pause;
      return { message: "Resposta atrasada", blocks: [], suggestedNext: [] };
    };
    const pending = f.send("Preciso falar");
    await generating;
    const c = (await f.conversations.list(f.merchantId)).items[0];
    await f.conversations.ownership(
      f.merchantId,
      c.id,
      "agent",
      "claim",
      c.version
    );
    release();
    const result = await pending;
    assert.equal(result.handoff, true);
    assert.equal(result.message, "");
    assert.deepEqual(result.blocks, []);
    assert.equal(
      (await f.port.history(f.merchantId, "site", "site-thread"))?.some(
        (m) => m.content === "Resposta atrasada"
      ),
      false
    );
  } finally {
    await f.cleanup();
  }
});
