import assert from "node:assert/strict";
import test from "node:test";
import { HttpClientService } from "../../../shared/http/http-client.service.js";
import type {
  CommerceConnectionPort,
  MerchantCommerceConnection,
  MerchantCommerceCredentials,
  SaveMerchantCommerceCredentialsInput,
} from "../domain/ports/commerce-connection.port.js";
import {
  NUVEMSHOP_WEBHOOK_EVENTS,
  RegisterNuvemshopWebhooksUseCase,
} from "./register-nuvemshop-webhooks.use-case.js";

class StubConnections implements CommerceConnectionPort {
  constructor(private readonly credentials?: MerchantCommerceCredentials) {}
  async getCredentials(): Promise<MerchantCommerceCredentials | undefined> { return this.credentials; }
  async getConnection(): Promise<MerchantCommerceConnection | undefined> { return undefined; }
  async saveCredentials(_input: SaveMerchantCommerceCredentialsInput): Promise<void> {}
  async updateHealth(): Promise<void> {}
  async disconnect(): Promise<void> {}
}

test("RegisterNuvemshopWebhooksUseCase registers canonical webhooks", async () => {
  const seen: Array<{ url: string; body: unknown; token?: string; userAgent?: string }> = [];
  const http = new HttpClientService({
    fetchFn: async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({
        url,
        body: JSON.parse(String(init?.body ?? "{}")) as unknown,
        token: headers.Authorization,
        userAgent: headers["User-Agent"],
      });
      return Response.json({ id: 1 });
    },
  });
  const useCase = new RegisterNuvemshopWebhooksUseCase(
    new StubConnections({
      merchantId: "mrc_1",
      provider: "nuvemshop",
      storeId: "1234567",
      accessToken: "nuvemshop_access_token_1234567890",
      userAgent: "AACP Test",
    }),
    http,
  );

  const result = await useCase.execute({
    merchantId: "mrc_1",
    callbackUrl: "https://api.zyon.com/webhooks/nuvemshop/mrc_1",
  });

  assert.deepEqual(result, { registered: NUVEMSHOP_WEBHOOK_EVENTS.length, skipped: 0 });
  assert.equal(seen.length, NUVEMSHOP_WEBHOOK_EVENTS.length);
  assert.equal(seen[0].url, "https://api.tiendanube.com/2025-03/1234567/webhooks");
  assert.deepEqual(seen[0].body, {
    event: NUVEMSHOP_WEBHOOK_EVENTS[0],
    url: "https://api.zyon.com/webhooks/nuvemshop/mrc_1",
  });
  assert.equal(seen[0].token, "Bearer nuvemshop_access_token_1234567890");
  assert.equal(seen[0].userAgent, "AACP Test");
});

test("RegisterNuvemshopWebhooksUseCase skips non-HTTPS callback URL", async () => {
  let called = false;
  const http = new HttpClientService({
    fetchFn: async () => {
      called = true;
      return Response.json({});
    },
  });
  const useCase = new RegisterNuvemshopWebhooksUseCase(
    new StubConnections({
      merchantId: "mrc_1",
      provider: "nuvemshop",
      storeId: "1234567",
      accessToken: "nuvemshop_access_token_1234567890",
    }),
    http,
  );

  const result = await useCase.execute({
    merchantId: "mrc_1",
    callbackUrl: "http://api.zyon.com/webhooks/nuvemshop/mrc_1",
  });

  assert.deepEqual(result, { registered: 0, skipped: NUVEMSHOP_WEBHOOK_EVENTS.length });
  assert.equal(called, false);
});
