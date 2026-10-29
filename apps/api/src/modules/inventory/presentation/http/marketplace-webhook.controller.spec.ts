import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { MarketplaceWebhookController } from "./marketplace-webhook.controller.js";

test("Bling validates the signed event and queues a routed snapshot", async (t) => {
  const previousSecret = process.env.BLING_CLIENT_SECRET;
  process.env.BLING_CLIENT_SECRET = "test-bling-secret";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.BLING_CLIENT_SECRET;
    else process.env.BLING_CLIENT_SECRET = previousSecret;
  });

  const body = { eventId: "event_1", event: "stock.updated", companyId: "company_1" };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = `sha256=${createHmac("sha256", process.env.BLING_CLIENT_SECRET).update(rawBody).digest("hex")}`;
  const queued: any[] = [];
  const controller = new MarketplaceWebhookController({
    erpWebhookRoute: {
      findUnique: async () => ({ merchantId: "merchant_1", connectionId: "connection_1" }),
    },
  } as never, {
    enqueueWebhookFull: async (...input: any[]) => { queued.push(input); return { id: "job_1" }; },
  } as never);

  assert.deepEqual(await controller.handleWebhook("bling", body, { rawBody } as never, signature), { received: true });
  assert.deepEqual(queued, [["merchant_1", "connection_1", "event_1"]]);
});

test("Bling rejects an unsigned webhook", async (t) => {
  const previousSecret = process.env.BLING_CLIENT_SECRET;
  process.env.BLING_CLIENT_SECRET = "test-bling-secret";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.BLING_CLIENT_SECRET;
    else process.env.BLING_CLIENT_SECRET = previousSecret;
  });

  const controller = new MarketplaceWebhookController({ erpWebhookRoute: {} } as never, {} as never);
  await assert.rejects(
    () => controller.handleWebhook("bling", { eventId: "event_1", event: "stock.updated", companyId: "company_1" }, { rawBody: Buffer.from("{}") } as never, "sha256=invalid"),
    UnauthorizedException,
  );
});
