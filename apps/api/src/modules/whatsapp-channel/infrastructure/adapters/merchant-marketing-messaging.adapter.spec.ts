import { test } from "node:test";
import assert from "node:assert/strict";
import { MerchantMarketingMessagingAdapter } from "./merchant-marketing-messaging.adapter.js";
import type {
  WhatsAppConfigRepository,
  WhatsAppChannelConfigEntity,
} from "../../domain/ports/whatsapp-config-repository.port.js";
import type { TemplateSubmissionPort } from "../../../whatsapp-templates/public-api.js";

function setup() {
  const now = new Date();
  const config: WhatsAppChannelConfigEntity = {
    id: "config",
    merchantId: "store",
    enabled: true,
    provider: "META_CLOUD",
    status: "ACTIVE",
    credentials: {
      accessToken: "test-only",
      wabaId: "123456",
      phoneNumberId: "654321",
    },
    createdAt: now,
    updatedAt: now,
  };
  const configs: WhatsAppConfigRepository = {
    findByMerchantId: async () => config,
    findById: async () => config,
    findByDeviceId: async () => config,
    findByWhatsAppNumber: async () => config,
    findByMetaPhoneNumberId: async () => config,
    upsert: async () => config,
  };
  let templateApproved = true;
  const verified: Array<unknown> = [];
  const templates: TemplateSubmissionPort = {
    createAndSubmit: async () => ({
      contentSid: "campaign_template",
      status: "submitted",
    }),
    syncStatus: async (_m, n, expected) => {
      verified.push(expected);
      return {
        contentSid: n,
        status: templateApproved ? "approved" : "paused",
      };
    },
  };
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let response: () => Promise<Response> = async () =>
    new Response(JSON.stringify({ messages: [{ id: "wamid-test" }] }), {
      status: 200,
    });
  const fetcher: typeof fetch = async (url, init) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return response();
  };
  const adapter = new MerchantMarketingMessagingAdapter(
    configs,
    templates,
    fetcher
  );
  return {
    adapter,
    config,
    requests,
    verified,
    setApproved: (v: boolean) => {
      templateApproved = v;
    },
    setResponse: (v: () => Promise<Response>) => {
      response = v;
    },
  };
}
test("MKT-02/1 opening sends the two explicit native WhatsApp reply buttons", async () => {
  const f = setup();
  const result = await f.adapter.sendOpening({
    merchantId: "store",
    phone: "5511999991234",
    deviceId: "META_CLOUD:config",
    text: "Quer receber?",
  });
  assert.equal(result.status, "accepted");
  assert.equal(f.requests[0].url.endsWith("/654321/messages"), true);
  assert.deepEqual(f.requests[0].body.interactive, {
    type: "button",
    body: { text: "Quer receber?" },
    action: {
      buttons: [
        {
          type: "reply",
          reply: { id: "marketing_accept_v1", title: "Quero receber" },
        },
        {
          type: "reply",
          reply: { id: "marketing_decline_v1", title: "Agora não" },
        },
      ],
    },
  });
});
test("MKT-06/2 wrong merchant WABA or unapproved template blocks transport", async () => {
  const f = setup();
  const input = {
    merchantId: "store",
    phone: "5511999991234",
    templateName: "campaign_template",
    body: "Novidades",
    language: "pt_BR",
    wabaId: "000000",
  };
  assert.equal((await f.adapter.sendCampaign(input)).status, "suppressed");
  f.setApproved(false);
  assert.equal(
    (await f.adapter.sendCampaign({ ...input, wabaId: "123456" })).status,
    "suppressed"
  );
  assert.equal(f.requests.length, 0);
});
test("MKT-06/3 a provider message id means accepted and never delivered", async () => {
  const f = setup();
  const result = await f.adapter.sendCampaign({
    merchantId: "store",
    phone: "5511999991234",
    templateName: "campaign_template",
    body: "Novidades",
    language: "pt_BR",
    wabaId: "123456",
  });
  assert.deepEqual(result, { status: "accepted", messageId: "wamid-test" });
  assert.deepEqual(f.verified[0], {
    body: "Novidades",
    language: "pt_BR",
    category: "MARKETING",
  });
  assert.deepEqual(f.requests[0].body.template, {
    name: "campaign_template",
    language: { code: "pt_BR" },
  });
});
test("MKT-06/4 timeout server failure and malformed acceptance stay unknown", async () => {
  const f = setup();
  for (const response of [
    async () => {
      throw new Error("timeout");
    },
    async () => new Response("down", { status: 503 }),
    async () => new Response("{}", { status: 200 }),
  ]) {
    f.setResponse(response);
    const result = await f.adapter.sendFreeform({
      merchantId: "store",
      phone: "5511999991234",
      deviceId: "META_CLOUD:config",
      text: "Olá",
    });
    assert.equal(result.status, "unknown");
    assert.equal(result.messageId, undefined);
  }
});
test("MKT-08/5 a config belonging to another merchant never reaches Graph", async () => {
  const f = setup();
  const result = await f.adapter.sendFreeform({
    merchantId: "other",
    phone: "5511999991234",
    deviceId: "META_CLOUD:config",
    text: "Olá",
  });
  assert.equal(result.status, "suppressed");
  assert.equal(f.requests.length, 0);
});
test("MKT-06/4 template reconciliation binds the exact body language category and current WABA without sending", async () => {
  const f = setup();
  const result = await f.adapter.inspectTemplate({
    merchantId: "store",
    name: "campaign_v1",
    body: "Mensagem aprovada",
    language: "pt_BR",
    wabaId: null,
  });
  assert.deepEqual(result, {
    name: "campaign_v1",
    status: "approved",
    wabaId: "123456",
  });
  assert.deepEqual(f.verified, [
    { body: "Mensagem aprovada", language: "pt_BR", category: "MARKETING" },
  ]);
  assert.equal(f.requests.length, 0);
  const wrong = await f.adapter.inspectTemplate({
    merchantId: "store",
    name: "campaign_v1",
    body: "Mensagem aprovada",
    language: "pt_BR",
    wabaId: "other",
  });
  assert.equal(wrong.status, "connection_unavailable");
  assert.equal(f.verified.length, 1);
});
