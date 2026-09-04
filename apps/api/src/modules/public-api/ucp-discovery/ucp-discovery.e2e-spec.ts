import test from "node:test";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../../app.module.js";

async function httpFetch(
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    token?: string;
  }
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options?.headers,
  };
  if (options?.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  const res = await fetch(url, {
    method: options?.method || "GET",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const contentType = res.headers.get("content-type");
  const data = contentType?.includes("application/json") ? await res.json() : null;
  return { status: res.status, data };
}

test.describe("UCP Discovery E2E", async () => {
  let app: INestApplication;
  let baseUrl: string;

  test.before(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  test.after(async () => {
    await app.close();
  });

  test("GET /.well-known/ucp returns 200 with discovery metadata (no auth required)", async () => {
    const res = await httpFetch(`${baseUrl}/.well-known/ucp`);

    assert.equal(res.status, 200, `Expected 200; got ${res.status}`);
    assert(res.data, "Response body missing");

    const data = res.data;
    assert.equal(data.version, "1.0");
    assert.equal(data.name, "AACP");
    assert(data.merchant_id);
    assert(Array.isArray(data.capabilities));
    assert(data.capabilities.length > 0);
    assert(Array.isArray(data.supported_protocols));
    assert(data.supported_protocols.length > 0);
    assert(data.checkout_sessions_endpoint);
    assert(data.feed_endpoint);
    assert(data.webhook_endpoint);
    assert(data.created_at);
  });

  test("GET /.well-known/ucp response shape matches canonical spec", async () => {
    const res = await httpFetch(`${baseUrl}/.well-known/ucp`);

    assert.equal(res.status, 200);
    assert(res.data);

    const data = res.data;
    const requiredFields = [
      "version",
      "name",
      "merchant_id",
      "capabilities",
      "supported_protocols",
      "checkout_sessions_endpoint",
      "feed_endpoint",
      "webhook_endpoint",
      "created_at",
    ];

    for (const field of requiredFields) {
      assert(
        field in data,
        `Missing required field in response: ${field}`
      );
      assert(
        data[field] !== undefined && data[field] !== null,
        `Field ${field} should not be null or undefined`
      );
    }
  });

  test("GET /.well-known/ucp is accessible without API key or tenant context", async () => {
    const resWithoutAuth = await httpFetch(`${baseUrl}/.well-known/ucp`);
    assert.equal(resWithoutAuth.status, 200, "Discovery endpoint should be public");

    const resWithAuth = await httpFetch(`${baseUrl}/.well-known/ucp`, {
      token: "invalid_key",
    });
    assert.equal(resWithAuth.status, 200, "Discovery endpoint should work with or without auth");
  });

  test("GET /.well-known/ucp returns valid ISO 8601 timestamp", async () => {
    const res = await httpFetch(`${baseUrl}/.well-known/ucp`);

    assert.equal(res.status, 200);
    const data = res.data;
    const timestamp = new Date(data.created_at);
    assert(!isNaN(timestamp.getTime()), `created_at is not a valid ISO 8601 timestamp: ${data.created_at}`);
  });
});
