import test, { afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { TwilioContentTemplateAdapter } from "./twilio-content-template.adapter.js";
import type { WhatsAppChannelConfigEntity, WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";

describe("Twilio Content submission isolation and uncertain outcomes", () => {
  const originalFetch = globalThis.fetch;
  const originalAccount = process.env.TWILIO_ACCOUNT_SID;
  const originalToken = process.env.TWILIO_AUTH_TOKEN;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalAccount === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    else process.env.TWILIO_ACCOUNT_SID = originalAccount;
    if (originalToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = originalToken;
  });
  const sid = `HX${"a".repeat(32)}`;
  const input = {
    merchantId: "m1", friendlyName: "recovery_v1", language: "pt_BR", metaBody: "Olá {{1}}",
    sampleVariables: { "1": "Ana" }, category: "MARKETING",
  };
  const config: WhatsAppChannelConfigEntity = {
    id: "connection", merchantId: "m1", provider: "TWILIO", enabled: true, status: "ACTIVE",
    whatsappNumber: "+5511999990000",
    credentials: { accountSid: "AC-tenant", authToken: "test-secret", senderId: "whatsapp:+5511999990000" },
    createdAt: new Date(0), updatedAt: new Date(0),
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  function harness(options: {
    config?: Partial<WhatsAppChannelConfigEntity> | null;
    configError?: boolean; noRepo?: boolean; revokeAfterCreate?: boolean;
    responses?: (Response | Error)[];
  } = {}) {
    process.env.TWILIO_ACCOUNT_SID = "AC-global";
    process.env.TWILIO_AUTH_TOKEN = "global-secret";
    const calls: { url: string; init?: RequestInit }[] = [];
    const responses = options.responses ?? [json({ sid }, 201), json({ status: "received" }, 201)];
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init });
      const response = responses[calls.length - 1];
      if (response instanceof Error) throw response;
      assert.ok(response, "unexpected request");
      return response;
    }) as typeof fetch;
    const repo = {
      async findByMerchantId(merchantId: string) {
        assert.equal(merchantId, "m1");
        if (options.configError) throw new Error("storage unavailable");
        if (options.revokeAfterCreate && calls.length) return null;
        return options.config === null ? null : { ...config, ...options.config };
      },
    } as WhatsAppConfigRepository;
    return { adapter: new TwilioContentTemplateAdapter(options.noRepo ? undefined : repo), calls };
  }

  test("creates and requests approval using connected tenant auth, bounded requests and exact content", async () => {
    const h = harness();
    assert.deepEqual(await h.adapter.createAndSubmit(input), { contentSid: sid, status: "submitted" });
    assert.deepEqual(h.calls.map((call) => call.url), [
      "https://content.twilio.com/v1/Content",
      `https://content.twilio.com/v1/Content/${sid}/ApprovalRequests/whatsapp`,
    ]);
    for (const call of h.calls) {
      assert.equal(new Headers(call.init?.headers).get("Authorization"), `Basic ${Buffer.from("AC-tenant:test-secret").toString("base64")}`);
      assert.ok(call.init?.signal instanceof AbortSignal);
      assert.equal(call.init?.redirect, "error");
    }
    assert.deepEqual(JSON.parse(String(h.calls[0]?.init?.body)), {
      friendly_name: input.friendlyName, language: input.language, variables: input.sampleVariables,
      types: { "twilio/text": { body: input.metaBody } },
    });
    assert.deepEqual(JSON.parse(String(h.calls[1]?.init?.body)), { name: "recovery_v1", category: "MARKETING" });
  });

  const invalidConfigs: [string, Partial<WhatsAppChannelConfigEntity> | null][] = [
    ["missing", null], ["cross tenant", { merchantId: "m2" }], ["disconnected", { status: "DISCONNECTED" }],
    ["disabled", { enabled: false }], ["pending", { status: "PENDING_VERIFICATION" }],
    ["wrong provider", { provider: "META_CLOUD" }], ["empty credentials", { credentials: {} }],
    ["wrong sender", { credentials: { ...config.credentials, senderId: "whatsapp:+5511999991111" } }],
  ];
  for (const [name, invalid] of invalidConfigs) {
    test(`${name} connection never uses environment credentials for create or sync`, async () => {
      const h = harness({ config: invalid });
      assert.equal((await h.adapter.createAndSubmit(input)).status, "draft");
      assert.equal((await h.adapter.syncStatus("m1", sid)).status, "unknown");
      assert.equal(h.calls.length, 0);
    });
  }
  for (const options of [{ noRepo: true }, { configError: true }]) {
    test(`unavailable config repository ${JSON.stringify(options)} cannot submit or downgrade sync to draft`, async () => {
      const h = harness(options);
      assert.equal((await h.adapter.createAndSubmit(input)).status, "draft");
      assert.equal((await h.adapter.syncStatus("m1", sid)).status, "unknown");
      assert.equal(h.calls.length, 0);
    });
  }

  for (const [label, response] of [
    ["timeout", new DOMException("fake sensitive detail", "TimeoutError")],
    ["invalid JSON", new Response("malformed", { status: 201 })],
    ["missing SID", json({}, 201)], ["non-string SID", json({ sid: 123 }, 201)],
    ["unsafe SID", json({ sid: "../../other-account" }, 201)],
    ["provider 500", json({}, 500)], ["provider 408", json({}, 408)],
  ] as const) {
    test(`create ${label} is submission_unknown without another create or approval request`, async () => {
      const h = harness({ responses: [response] });
      const result = await h.adapter.createAndSubmit(input);
      assert.equal(result.status, "submission_unknown");
      assert.equal(result.contentSid, "");
      assert.equal(h.calls.length, 1);
      assert.ok(!JSON.stringify(result).includes("fake sensitive"));
    });
  }
  test("definite create validation rejection stays draft without persisting provider body", async () => {
    const h = harness({ responses: [json({ message: "secret provider data" }, 400)] });
    assert.deepEqual(await h.adapter.createAndSubmit(input), {
      contentSid: "", status: "draft", rejectionReason: "create_failed_400",
    });
    assert.equal(h.calls.length, 1);
  });
  for (const [label, response] of [
    ["timeout", new DOMException("timeout", "TimeoutError")], ["500", json({}, 500)],
    ["400", json({}, 400)], ["malformed JSON", new Response("malformed")], ["missing status", json({})],
  ] as const) {
    test(`approval ${label} preserves the created SID for polling`, async () => {
      const h = harness({ responses: [json({ sid }, 201), response] });
      const result = await h.adapter.createAndSubmit(input);
      assert.equal(result.status, "submission_unknown");
      assert.equal(result.contentSid, sid);
      assert.equal(h.calls.length, 2);
    });
  }
  test("connection revoked after create suppresses approval and preserves SID", async () => {
    const h = harness({ revokeAfterCreate: true });
    assert.deepEqual(await h.adapter.createAndSubmit(input), {
      contentSid: sid, status: "submission_unknown", rejectionReason: "connection_changed",
    });
    assert.equal(h.calls.length, 1);
  });

  for (const [provider, expected] of [
    ["approved", "approved"], ["rejected", "rejected"], ["paused", "paused"], ["disabled", "disabled"],
    ["pending", "submitted"], ["received", "submitted"], ["APPROVED", "approved"],
    ["unsubmitted", "unknown"], ["future_status", "unknown"], [null, "unknown"],
  ] as const) {
    test(`sync maps ${provider} to ${expected}`, async () => {
      const h = harness({ responses: [json({ whatsapp: { status: provider } })] });
      assert.deepEqual(await h.adapter.syncStatus("m1", sid), { contentSid: sid, status: expected });
      assert.equal(h.calls[0]?.url, `https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`);
      assert.ok(h.calls[0]?.init?.signal instanceof AbortSignal);
    });
  }
  for (const invalidSid of ["", "HX-test", "../other", `${sid}/../../other`, `${sid}?redirect=other`]) {
    test(`invalid sync SID ${invalidSid} never enters request path`, async () => {
      const h = harness();
      assert.equal((await h.adapter.syncStatus("m1", invalidSid)).status, "unknown");
      assert.equal(h.calls.length, 0);
    });
  }
  test("sync transient errors remain unknown with stable SID", async () => {
    const h = harness({ responses: [new Error("network secret")] });
    assert.deepEqual(await h.adapter.syncStatus("m1", sid), { contentSid: sid, status: "unknown" });
  });
});
