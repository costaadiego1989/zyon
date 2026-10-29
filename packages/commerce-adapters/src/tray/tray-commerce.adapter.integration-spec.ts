/**
 * REAL Tray Commerce API integration tests.
 *
 * Required environment variables:
 *   TRAY_API_ADDRESS     e.g. https://loja.exemplo.com.br/web_api
 *   TRAY_ACCESS_TOKEN    current access token
 *   TRAY_REFRESH_TOKEN   refresh token (used to mint a new pair)
 *   TRAY_CONSUMER_KEY    app consumer key
 *   TRAY_CONSUMER_SECRET app consumer secret
 *
 * Run:
 *   TRAY_API_ADDRESS=... TRAY_ACCESS_TOKEN=... TRAY_REFRESH_TOKEN=... \
 *   TRAY_CONSUMER_KEY=... TRAY_CONSUMER_SECRET=... \
 *     pnpm --filter @zyon/commerce-adapters test
 *
 * Verifies:
 *   - testConnection via GET /info
 *   - searchCatalog: products endpoint, currency code round-trip.
 *   - TrayOAuthService.refresh() flow: response includes new access_token AND
 *     a new refresh_token (per Tray contract).
 *
 * Refs:
 *   - https://developers.tray.com.br/
 *   - https://developers.tray.com.br/v3/reference
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { TrayCommerceAdapter } from "./tray-commerce.adapter.js";
import { TrayOAuthService } from "./tray-oauth.service.js";

const REQUIRED_ENV = [
  "TRAY_API_ADDRESS",
  "TRAY_ACCESS_TOKEN",
  "TRAY_REFRESH_TOKEN",
  "TRAY_CONSUMER_KEY",
  "TRAY_CONSUMER_SECRET",
] as const;

function hasEnv(env: readonly string[]): boolean {
  return env.every((k) => Boolean(process.env[k] && process.env[k]!.trim()));
}

function buildCredentials() {
  return {
    merchantId: "mrc_integration",
    provider: "tray" as const,
    apiAddress: process.env.TRAY_API_ADDRESS!,
    accessToken: process.env.TRAY_ACCESS_TOKEN!,
    refreshToken: process.env.TRAY_REFRESH_TOKEN!,
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    consumerKey: process.env.TRAY_CONSUMER_KEY!,
    consumerSecret: process.env.TRAY_CONSUMER_SECRET!,
  };
}

describe("Tray Commerce Adapter — REAL API", {
  skip: !hasEnv(REQUIRED_ENV),
}, () => {
  test("testConnection returns store metadata from /info", async () => {
    const adapter = new TrayCommerceAdapter(buildCredentials());
    const health = await adapter.testConnection();
    assert.equal(health.provider, "tray");
    assert.ok(health.storeName.length > 0, "storeName populated");
    assert.match(health.storeUrl, /^https:\/\//, "storeUrl is https");
    assert.equal(health.currency.length, 3, "ISO-4217 currency code");
  });

  test("searchCatalog returns Tray products with default-variant mapping", async () => {
    const adapter = new TrayCommerceAdapter(buildCredentials());
    const page = await adapter.searchCatalog({
      merchantId: "mrc_integration",
      limit: 5,
    });
    assert.ok(Array.isArray(page.products));
    for (const product of page.products) {
      assert.ok(product.id.length > 0, "product id present");
      // Tray exposes single-variant products; adapter normalizes to one
      // synthetic "Default" variant per product.
      assert.equal(product.variants.length, 1);
      assert.equal(product.variants[0]!.title, "Default");
      assert.equal(product.variants[0]!.currency, "BRL");
    }
  });

  test("OAuth refresh returns access_token + refresh_token + expiry (per task)", async () => {
    const credentials = buildCredentials();
    const oauth = new TrayOAuthService(credentials);
    const result = await oauth.refresh();
    assert.ok(result.access_token.length > 0, "new access_token present");
    assert.ok(result.refresh_token.length > 0, "new refresh_token present");
    assert.ok(
      result.date_expiration_access_token > Math.floor(Date.now() / 1000),
      "expiry is in the future",
    );
  });
});

describe("Tray adapter construction validation", () => {
  test("rejects missing api address", () => {
    assert.throws(
      () =>
        new TrayCommerceAdapter({
          merchantId: "x",
          provider: "tray",
          apiAddress: "",
          accessToken: "a",
          refreshToken: "r",
          accessTokenExpiresAt: 0,
          consumerKey: "ck",
          consumerSecret: "cs",
        }),
      /tray_api_address_required/,
    );
  });

  test("rejects missing access token", () => {
    assert.throws(
      () =>
        new TrayCommerceAdapter({
          merchantId: "x",
          provider: "tray",
          apiAddress: "https://shop.example/web_api",
          accessToken: "",
          refreshToken: "r",
          accessTokenExpiresAt: 0,
          consumerKey: "ck",
          consumerSecret: "cs",
        }),
      /tray_access_token_required/,
    );
  });

  test("rejects missing refresh token", () => {
    assert.throws(
      () =>
        new TrayCommerceAdapter({
          merchantId: "x",
          provider: "tray",
          apiAddress: "https://shop.example/web_api",
          accessToken: "a",
          refreshToken: "",
          accessTokenExpiresAt: 0,
          consumerKey: "ck",
          consumerSecret: "cs",
        }),
      /tray_refresh_token_required/,
    );
  });

  test("OAuth service rejects missing consumer key/secret", () => {
    assert.throws(
      () =>
        new TrayOAuthService({
          merchantId: "x",
          provider: "tray",
          apiAddress: "https://shop.example/web_api",
          accessToken: "a",
          refreshToken: "r",
          accessTokenExpiresAt: 0,
          consumerKey: "",
          consumerSecret: "cs",
        }),
      /tray_consumer_key_required/,
    );
    assert.throws(
      () =>
        new TrayOAuthService({
          merchantId: "x",
          provider: "tray",
          apiAddress: "https://shop.example/web_api",
          accessToken: "a",
          refreshToken: "r",
          accessTokenExpiresAt: 0,
          consumerKey: "ck",
          consumerSecret: "",
        }),
      /tray_consumer_secret_required/,
    );
  });

  test("OAuth isExpired detects expiry within 5-minute buffer", () => {
    const now = Math.floor(Date.now() / 1000);
    const soon = now + 60; // 60s ahead, within 5-minute buffer
    const oauth = new TrayOAuthService({
      merchantId: "x",
      provider: "tray",
      apiAddress: "https://shop.example/web_api",
      accessToken: "a",
      refreshToken: "r",
      accessTokenExpiresAt: soon,
      consumerKey: "ck",
      consumerSecret: "cs",
    });
    assert.equal(oauth.isExpired(), true, "expires within buffer → considered expired");
  });
});