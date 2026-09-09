import test, { afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { MetaCloudTemplateAdapter } from "./meta-cloud-template.adapter.js";
import type { WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";

describe("Meta Cloud template submission", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });
  const input = {
    merchantId: "merchant-1", friendlyName: "merchant-1_cart_recovery", language: "pt_BR", category: "MARKETING",
    metaBody: "Olá {{1}}, retome em {{2}}", sampleVariables: { "1": "Ana", "2": "https://store.test/recover" },
  };
  const configs = {
    async findByMerchantId() {
      return {
        id: "cfg", merchantId: input.merchantId, enabled: true, provider: "META_CLOUD", status: "ACTIVE",
        credentials: { accessToken: "merchant-token", wabaId: "123456789", phoneNumberId: "987654321" },
        createdAt: new Date(), updatedAt: new Date(),
      };
    },
  } as unknown as WhatsAppConfigRepository;

  test("submits a deterministic Meta template name with positional body examples", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ id: "template-id", status: "PENDING" });
    }) as typeof fetch;
    const result = await new MetaCloudTemplateAdapter(configs).createAndSubmit(input);
    assert.equal(result.status, "submitted");
    assert.match(result.contentSid, /^zyon_merchant_1_cart_recovery_[a-f0-9]{10}$/);
    assert.equal(requests[0]?.url, "https://graph.facebook.com/v23.0/123456789/message_templates");
    assert.equal(new Headers(requests[0]?.init?.headers).get("Authorization"), "Bearer merchant-token");
    const body = JSON.parse(String(requests[0]?.init?.body));
    assert.equal(body.name, result.contentSid);
    assert.deepEqual(body.components, [{ type: "BODY", text: input.metaBody, example: { body_text: [["Ana", "https://store.test/recover"]] } }]);
  });

  test("polls an exact name and maps Meta approval states", async () => {
    globalThis.fetch = (async () => Response.json({ data: [{ name: "zyon_test", status: "APPROVED" }] })) as typeof fetch;
    assert.deepEqual(await new MetaCloudTemplateAdapter(configs).syncStatus(input.merchantId, "zyon_test"), {
      contentSid: "zyon_test", status: "approved",
    });
  });

  test("an uncertain create keeps its deterministic identifier for reconciliation", async () => {
    globalThis.fetch = (async () => { throw new Error("timeout"); }) as typeof fetch;
    const result = await new MetaCloudTemplateAdapter(configs).createAndSubmit(input);
    assert.equal(result.status, "submission_unknown");
    assert.match(result.contentSid, /^zyon_/);
  });
});
