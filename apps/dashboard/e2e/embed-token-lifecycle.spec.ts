import { test, expect } from "@playwright/test";

test.describe("Embed Token Lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  async function apiLogin(page: any) {
    return page.evaluate(async () => {
      const res = await fetch('http://localhost:3009/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'demo@zyon.com', password: 'demo1234' })
      });
      return res.json();
    });
  }

  async function issueToken(page: any, accessToken: string) {
    return page.evaluate(async (token: string) => {
      const res = await fetch('http://localhost:3009/v1/embed/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Idempotency-Key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`
        },
        body: JSON.stringify({ scopes: ['checkout:start', 'checkout:chat', 'checkout:track', 'offers:apply'] })
      });
      return { status: res.status, body: await res.json() };
    }, accessToken);
  }

  test("@embed-token-generate POST /embed/sessions returns 201 with token", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    const auth = await apiLogin(page);
    expect(auth.access_token).toBeTruthy();

    const result = await issueToken(page, auth.access_token);
    expect(result.status).toBe(201);
    expect(result.body.embed_session_token).toBeTruthy();
    expect(result.body.expires_at_unix).toBeGreaterThan(0);
  });

  test("@embed-token-valid token payload has correct structure", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    const auth = await apiLogin(page);
    const result = await issueToken(page, auth.access_token);
    const token = result.body.embed_session_token;

    // Decode payload (base64url before the dot)
    const payloadB64 = token.split('.')[0];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

    expect(payload.typ).toBe("aacp_embed_v1");
    expect(payload.merchantId).toBeTruthy();
    expect(typeof payload.merchantId).toBe("string");
    expect(payload.expiresAtUnix).toBeGreaterThan(0);
    expect(payload.issuedAtUnix).toBeGreaterThan(0);
    expect(payload.nonce).toBeTruthy();
    expect(Array.isArray(payload.scopes)).toBe(true);
    expect(payload.scopes.length).toBeGreaterThan(0);
    expect(payload.scopes).toContain("checkout:start");
  });

  test("@embed-token-expiry token expires in ~15 minutes", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    const auth = await apiLogin(page);
    const result = await issueToken(page, auth.access_token);

    const nowUnix = Math.floor(Date.now() / 1000);
    const expiresAt = result.body.expires_at_unix;
    const ttl = expiresAt - nowUnix;

    // Should be between 800-960 seconds (13-16 min tolerance)
    expect(ttl).toBeGreaterThan(800);
    expect(ttl).toBeLessThan(960);
  });

  test("@embed-token-unique each call generates unique nonce", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    const auth = await apiLogin(page);
    const result1 = await issueToken(page, auth.access_token);
    const result2 = await issueToken(page, auth.access_token);

    // Tokens should be different (different nonces)
    expect(result1.body.embed_session_token).not.toBe(result2.body.embed_session_token);
  });

  test("@embed-token-scopes token contains requested scopes", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    const auth = await apiLogin(page);
    const result = await issueToken(page, auth.access_token);
    const token = result.body.embed_session_token;

    const payloadB64 = token.split('.')[0];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

    expect(payload.scopes).toContain("checkout:start");
    expect(payload.scopes).toContain("checkout:chat");
    expect(payload.scopes).toContain("checkout:track");
    expect(payload.scopes).toContain("offers:apply");
  });

  test("@embed-token-merchant token merchantId matches logged-in merchant", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    const auth = await apiLogin(page);
    const result = await issueToken(page, auth.access_token);
    const token = result.body.embed_session_token;

    const payloadB64 = token.split('.')[0];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

    expect(payload.merchantId).toBe(auth.merchant_id);
  });

  test("@embed-snippet-static embed code snippet is static HTML", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    // Login via UI
    const emailInput = page.locator("input[placeholder='owner@loja.com']");
    if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await emailInput.click();
      await emailInput.pressSequentially('demo@zyon.com', { delay: 50 });
      await page.waitForTimeout(300);
      await page.locator("input[type='password']").click();
      await page.locator("input[type='password']").pressSequentially('demo1234', { delay: 50 });
      await page.waitForTimeout(300);
      await page.locator("button[type='submit']").click();
      await page.waitForTimeout(3000);
    }

    // Navigate to Embed
    await page.locator('text=Embed').first().click();
    await page.waitForTimeout(2000);

    // Snippet should be visible with static structure
    const codeBlock = page.locator("pre code").first();
    await expect(codeBlock).toBeVisible({ timeout: 8000 });
    const snippet = (await codeBlock.textContent()) ?? "";

    // Static parts that never change:
    expect(snippet).toContain("<script");
    expect(snippet).toContain("/widget/aacp.js");
    expect(snippet).toContain("data-aacp-token");
  });

  test("@embed-token-no-errors no API errors during token flow", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    const auth = await apiLogin(page);

    // Issue 3 tokens rapidly — no 429/500 errors
    for (let i = 0; i < 3; i++) {
      const result = await issueToken(page, auth.access_token);
      expect(result.status).toBe(201);
    }
  });
});
