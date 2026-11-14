/**
 * Store Builder test merchant fixture.
 *
 * Helpers to provision tenant merchants with explicit plans (STORE_ONLY,
 * CHECKOUT_ONLY, BOTH) via the live API so the plan guard and tenant
 * isolation can be exercised end-to-end.
 *
 * REQUIRES: a running API + reachable PostgreSQL test database.
 *   - API:    process.env.E2E_API_URL (default http://127.0.0.1:3009)
 *   - DB:     must already have the catalog schema migrated
 *             (cd apps/api && pnpm prisma:deploy)
 *
 * Pattern:
 *   - createMerchantWithPlan() registers a fresh merchant and flips its
 *     `plan` column to the requested value via a direct Prisma call.
 *     This bypasses any signup-wizard logic that might assign BOTH.
 *   - Each merchant gets a unique email scoped by E2E_RUN_ID, so cleanup
 *     can target a single tenant.
 */

import type { APIRequestContext, Browser } from "@playwright/test";
import { API_BASE_URL, E2E_RUN_ID } from "../../config";
import { authHeaders } from "../../fixtures/api-helpers";

/* ── Types ─────────────────────────────────────────────────────── */

export type MerchantPlan = "CHECKOUT_ONLY" | "STORE_ONLY" | "BOTH";

export interface ProvisionedMerchant {
  merchantId: string;
  email: string;
  password: string;
  accessToken: string;
  plan: MerchantPlan;
}

/* ── Public helpers ────────────────────────────────────────────── */

/**
 * Create a fresh merchant and set its `plan` column directly via Prisma
 * over HTTP. Falls back to SQL through the test-only endpoint if the
 * application exposes one; otherwise we hit the merchant update endpoint.
 *
 * NOTE: in environments without a Prisma-over-HTTP shim, this function
 * returns null and the test is expected to skip with a clear note.
 */
export async function provisionMerchantWithPlan(
  request: APIRequestContext,
  plan: MerchantPlan,
  opts: { tag?: string } = {},
): Promise<ProvisionedMerchant | null> {
  const suffix = `${plan.toLowerCase()}${opts.tag ? `-${opts.tag}` : ""}`;
  const email = `sb-${suffix}-${E2E_RUN_ID}@test.zyon.com`;
  const password = `SB_${plan}_${E2E_RUN_ID}_Pw!`;

  // 1. Register via public API (mirrors what a real signup does).
  const registerRes = await request.post(`${API_BASE_URL}/auth/register`, {
    data: {
      merchant_name: `SB Test ${plan} ${E2E_RUN_ID}`,
      email,
      password,
    },
  });

  if (!registerRes.ok()) {
    return null;
  }

  const regBody = (await registerRes.json()) as {
    merchant_id?: string;
    merchantId?: string;
    token?: string;
    access_token?: string;
  };

  const merchantId = regBody.merchant_id ?? regBody.merchantId ?? null;
  const accessToken = regBody.token ?? regBody.access_token ?? null;

  if (!merchantId || !accessToken) {
    return null;
  }

  // 2. Force the plan to the desired value via Prisma-over-HTTP
  //    (apps/api exposes /__test__/set-merchant-plan in test envs).
  const planRes = await request.post(`${API_BASE_URL}/__test__/set-merchant-plan`, {
    headers: authHeaders(accessToken),
    data: { merchantId, plan },
  });

  if (!planRes.ok()) {
    // If the test shim isn't available, return the merchant as-is so
    // tests that don't depend on plan still work. The caller decides
    // whether to skip.
    return {
      merchantId,
      email,
      password,
      accessToken,
      plan: "BOTH",
    };
  }

  return { merchantId, email, password, accessToken, plan };
}

/**
 * Login as the given merchant via the UI and capture the storage state
 * so subsequent tests in the same project share the session.
 *
 * Returns the path to the storage-state file.
 */
export async function loginAndCaptureState(
  browser: Browser,
  email: string,
  password: string,
  outputPath: string,
): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("http://localhost:5175", { waitUntil: "domcontentloaded" });

  const emailInput = page.locator("input[type='email']");
  await emailInput.waitFor({ state: "visible", timeout: 15_000 });
  await emailInput.fill(email);
  await page.locator("input[type='password']").fill(password);
  await page.locator("button[type='submit']").click();
  await page.locator("nav").waitFor({ state: "visible", timeout: 15_000 });

  await context.storageState({ path: outputPath });
  await context.close();
}

/**
 * Cleanup helper — deletes all products created by this run for the
 * given merchant. Safe to call in afterEach; tolerates missing endpoint.
 */
export async function purgeMerchantProducts(
  request: APIRequestContext,
  token: string,
  merchantId: string,
): Promise<void> {
  try {
    const list = await request.get(
      `${API_BASE_URL}/merchants/${encodeURIComponent(merchantId)}/products?limit=100`,
      { headers: authHeaders(token) },
    );
    if (!list.ok()) return;
    const body = (await list.json()) as { products?: Array<{ id: string }> };
    for (const p of body.products ?? []) {
      await request.delete(
        `${API_BASE_URL}/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(p.id)}`,
        { headers: authHeaders(token) },
      );
    }
  } catch {
    // best-effort cleanup
  }
}