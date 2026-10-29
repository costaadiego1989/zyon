import test from "node:test";
import assert from "node:assert/strict";
import { TestSeedController } from "./test-seed.controller.js";
import type { AuthRepository } from "../auth/domain/ports/auth-repository.port.js";
import type { JwtService } from "../auth/domain/services/jwt.service.js";
import type { PasswordHasher } from "../auth/domain/services/password-hasher.service.js";

function buildController(): TestSeedController {
  const authRepo: Pick<AuthRepository, "createMerchantWithOwner"> = {
    async createMerchantWithOwner(input) {
      return {
        merchant: { id: input.merchantId, name: input.merchantName },
        user: {
          id: `usr_${crypto.randomUUID().slice(0, 8)}`,
          merchantId: input.merchantId,
          email: input.email,
          passwordHash: input.passwordHash,
          role: "owner",
        },
      };
    },
  };
  const jwt: Pick<JwtService, "sign"> = {
    sign: () => `jwt_${crypto.randomUUID()}`,
  };
  const hasher: Pick<PasswordHasher, "hash"> = {
    hash: async (pwd: string) => `hashed_${pwd}`,
  };
  return new TestSeedController(
    authRepo as AuthRepository,
    jwt as JwtService,
    hasher as PasswordHasher
  );
}

test("TestSeedController.seed: returns merchantId with e2e_ prefix, embedToken, accessToken, and productId", async () => {
  const controller = buildController();
  const result = await controller.seed();
  assert.ok(result.merchantId.startsWith("e2e_"), "merchantId must have e2e_ prefix");
  assert.ok(typeof result.embedToken === "string" && result.embedToken.length > 10, "embedToken must be non-empty");
  assert.ok(typeof result.accessToken === "string" && result.accessToken.length > 0, "accessToken must be non-empty");
  assert.equal(result.productId, "e2e_product_001");
});

test("TestSeedController.seed: each call returns a unique merchantId", async () => {
  const controller = buildController();
  const r1 = await controller.seed();
  const r2 = await controller.seed();
  assert.notEqual(r1.merchantId, r2.merchantId, "merchantId must be unique per call");
  assert.notEqual(r1.embedToken, r2.embedToken, "embedToken must be unique per call");
});

test("TestSeedController.seed: throws when NODE_ENV=production", async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const controller = buildController();
    await assert.rejects(() => controller.seed());
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test("TestSeedController webhook receiver stores E2E deliveries by bucket", () => {
  const controller = buildController();
  const bucket = `bucket_${crypto.randomUUID().slice(0, 8)}`;

  controller.receiveWebhook(
    bucket,
    { event_type: "order.approved" },
    {
      "x-aacp-event-id": "evt_1",
      "x-aacp-event-type": "order.approved",
      "x-aacp-signature": "v1=test"
    }
  );

  const received = controller.readWebhooks(bucket);
  assert.equal(received.deliveries.length, 1);
  assert.equal(received.deliveries[0]?.headers["x-aacp-event-type"], "order.approved");
  assert.deepEqual(received.deliveries[0]?.body, { event_type: "order.approved" });
});
