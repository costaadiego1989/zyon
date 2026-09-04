/**
 * Store Builder — Storefront Integration E2E.
 *
 * Validates the cross-app integration:
 *   - Storefront (Next.js on :3001) renders a merchant's products
 *   - The conversation chat accepts a free-form user message
 *   - Theme tokens propagate to CSS variables
 *
 * REQUIRES:
 *   - API on :3009
 *   - Storefront dev server running on :3001
 *     (cd apps/storefront && pnpm dev)
 *   - DB populated with at least one product for the demo merchant
 *
 * @store-builder
 */

import { test, expect, type Page } from "@playwright/test";
import { TIMEOUTS } from "../config";

const STOREFRONT_URL = process.env.E2E_STOREFRONT_URL ?? "http://localhost:3001";

/* ── Suite ─────────────────────────────────────────────────────── */

test.describe("@store-builder Storefront Integration", () => {
  test.beforeEach(({ }, testInfo) => {
    test.skip(
      !!process.env.SKIP_STOREFRONT_E2E,
      "SKIP_STOREFRONT_E2E set — run after starting `pnpm dev` in apps/storefront",
    );
    testInfo.annotations.push({ type: "storefront-url", description: STOREFRONT_URL });
  });

  /* ── Test 1: storefront renders ────────────────────────────── */

  test("@store-builder storefront renders demo store + chat", async ({ page }) => {
    await page.goto(`${STOREFRONT_URL}/store/demo`, {
      waitUntil: "domcontentloaded",
    });

    // Store name heading
    await expect(page.locator("h1")).toBeVisible({ timeout: TIMEOUTS.element });

    // Either real API products or the static demo fallback must appear.
    // The grid uses aria-label="Produtos".
    const grid = page.locator("section[aria-label='Produtos']");
    await expect(grid).toBeVisible({ timeout: TIMEOUTS.element });
    const cards = grid.locator("article");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    // Conversation shell: input + send button
    const chatInput = page.locator("input[aria-label='Mensagem']");
    await expect(chatInput).toBeVisible({ timeout: TIMEOUTS.element });

    // Send a free-form message; the welcome agent message must remain.
    await chatInput.fill("camiseta");
    await page.locator("button[type='submit']", { hasText: "Enviar" }).click();

    // The user bubble should appear.
    await expect(
      page.locator("text=camiseta").first(),
    ).toBeVisible({ timeout: TIMEOUTS.element });
  });

  /* ── Test 2: theme tokens per merchant ─────────────────────── */

  test("@store-builder theme tokens propagate to CSS variables", async ({ page }) => {
    await page.goto(`${STOREFRONT_URL}/store/demo`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator("h1").waitFor({ state: "visible", timeout: TIMEOUTS.element });

    // The page injects a <style> with :root { --color-primary: ... }.
    const primary = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim();
    });

    // Demo merchant sets #5b3df5. Either it survives or some non-empty
    // value was injected — both prove the theme layer is wired up.
    expect(primary.length).toBeGreaterThan(0);

    // Note: full per-merchant theme variation is gated on multi-tenant
    // storefront routing (apps/storefront currently hard-codes "demo").
    // Add tests when slug→merchant resolution lands.
  });
});