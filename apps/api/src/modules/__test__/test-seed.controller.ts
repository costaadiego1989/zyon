import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post } from "@nestjs/common";
import { EmbedTokenService } from "../embed/domain/embed-token.service.js";

type TestWebhookDelivery = {
  received_at: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

const webhookReceiverBuckets = new Map<string, TestWebhookDelivery[]>();

@Controller("__test__")
export class TestSeedController {
  @Post("seed")
  seed(): { merchantId: string; embedToken: string; productId: string } {
    if (process.env.NODE_ENV === "production") {
      throw new ForbiddenException("test_seed_disabled_in_production");
    }
    const merchantId = `e2e_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const tokens = new EmbedTokenService();
    const now = Math.floor(Date.now() / 1000);
    const embedToken = tokens.sign({
      typ: "aacp_embed_v1",
      merchantId,
      issuedAtUnix: now,
      expiresAtUnix: now + 3600,
      nonce: crypto.randomUUID()
    });
    return { merchantId, embedToken, productId: "e2e_product_001" };
  }

  @Post("webhook-receiver/:bucket")
  @HttpCode(204)
  receiveWebhook(
    @Param("bucket") bucket: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>
  ): void {
    assertTestOnly();
    const key = sanitizeBucket(bucket);
    const current = webhookReceiverBuckets.get(key) ?? [];
    current.push({
      received_at: new Date().toISOString(),
      headers: {
        "x-aacp-event-id": headers["x-aacp-event-id"],
        "x-aacp-event-type": headers["x-aacp-event-type"],
        "x-aacp-timestamp": headers["x-aacp-timestamp"],
        "x-aacp-signature": headers["x-aacp-signature"]
      },
      body
    });
    webhookReceiverBuckets.set(key, current.slice(-50));
  }

  @Get("webhook-receiver/:bucket")
  readWebhooks(@Param("bucket") bucket: string): { deliveries: TestWebhookDelivery[] } {
    assertTestOnly();
    return { deliveries: webhookReceiverBuckets.get(sanitizeBucket(bucket)) ?? [] };
  }
}

function assertTestOnly(): void {
  if (process.env.NODE_ENV === "production") {
    throw new ForbiddenException("test_receiver_disabled_in_production");
  }
}

function sanitizeBucket(bucket: string): string {
  return bucket.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "default";
}
