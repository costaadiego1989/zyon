/**
 * Staff Role Access E2E — validates the role-based UI gating end-to-end.
 *
 * Verifies:
 * - OWNER session has full sidebar (regression sanity).
 * - STAFF session shows only the 6-7 allowed items.
 * - Deep-link to a blocked tab triggers the "Acesso restrito" modal.
 * - Modal "Ir para início" navigates to #overview and closes.
 * - Account settings page is accessible to STAFF.
 *
 * Prerequisite: run `pnpm tsx prisma/seeds/staff-test-user.ts` once before
 * this spec to seed a STAFF user attached to the first merchant.
 */

import { test, expect, type Page } from "@playwright/test";
import { TIMEOUTS } from "./config";

const STAFF_EMAIL = process.env.STAFF_TEST_EMAIL ?? "staff+e2e@zyon.test";
const STAFF_PASSWORD = process.env.STAFF_TEST_PASSWORD ?? "StaffPass1!";

test.describe("@staff-role-access — STAFF UI gating", () => {
  test("OWNER session sees the full (plan-filtered) sidebar", async ({ page }) => {
    // Inherits storageState from auth-setup (logged in as the test owner)
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("aside nav").waitFor({ state: "visible", timeout: TIMEOUTS.auth });

    // These items should be visible to an OWNER
    await expect(page.locator("aside nav").getByText("Visão Geral", { exact: true })).toBeVisible();
    await expect(page.locator("aside nav").getByText("Pedidos & Envios", { exact: true })).toBeVisible();
    await expect(page.locator("aside nav").getByText("Produtos", { exact: true })).toBeVisible();
    await expect(page.locator("aside nav").getByText("Equipe", { exact: true })).toBeVisible();
  });

  test("STAFF session shows only allowed nav items", async ({ page }) => {
    // Login fresh as STAFF (skip storageState from auth-setup)
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("input[type='email']").waitFor({ state: "visible", timeout: TIMEOUTS.auth });

    await page.locator("input[type='email']").fill(STAFF_EMAIL);
    await page.locator("input[type='password']").fill(STAFF_PASSWORD);
    await page.locator("button[type='submit']").click();

    // Wait for shell to appear
    await page.locator("aside nav").waitFor({ state: "visible", timeout: TIMEOUTS.auth });

    // ALLOWED for STAFF (visible at plan STORE_ONLY / BOTH)
    const allowed = [
      "Visão Geral",
      "Pedidos & Envios",
      "Clientes",
      "Atendimento",
      "Conta",
    ];
    for (const label of allowed) {
      await expect(
        page.locator("aside nav").getByText(label, { exact: true })
      ).toBeVisible({ timeout: TIMEOUTS.element });
    }

    // HIDDEN from STAFF (not in permission matrix)
    const blocked = ["Produtos", "Equipe", "Cupons", "Categorias", "Estoque", "Frete & Entregas"];
    for (const label of blocked) {
      const count = await page.locator("aside nav").getByText(label, { exact: true }).count();
      expect(count, `Sidebar should NOT contain "${label}" for STAFF`).toBe(0);
    }
  });

  test("Deep-link to a blocked tab triggers the restricted-access modal", async ({ page }) => {
    // Login as STAFF
    await loginAsStaff(page);

    // Navigate to a blocked page via hash
    await page.evaluate(() => {
      window.location.hash = "catalog";
    });

    // Modal should appear
    const dialog = page.getByRole("dialog", { name: /acesso restrito/i });
    await expect(dialog).toBeVisible({ timeout: TIMEOUTS.element });
    await expect(
      dialog.getByText(/Você não tem permissão para acessar esta página/i)
    ).toBeVisible();

    // The catalog page content should NOT render in sidebar
    await expect(
      page.locator("aside nav").getByText("Produtos", { exact: true })
    ).toHaveCount(0);

    // URL should remain at #catalog (modal does NOT redirect)
    expect(page.url()).toContain("#catalog");

    // "Ir para início" navigates to #overview and closes the modal
    await dialog.getByRole("button", { name: /ir para início/i }).click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUTS.element });
    expect(page.url()).toMatch(/#overview$/);

    // Back on the overview page
    await expect(
      page.locator("aside nav").getByText("Visão Geral", { exact: true })
    ).toBeVisible();
  });

  test("ESC closes the restricted-access modal", async ({ page }) => {
    await loginAsStaff(page);

    await page.evaluate(() => {
      window.location.hash = "team";
    });

    const dialog = page.getByRole("dialog", { name: /acesso restrito/i });
    await expect(dialog).toBeVisible({ timeout: TIMEOUTS.element });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: TIMEOUTS.element });
  });

  test("Account settings page is accessible to STAFF", async ({ page }) => {
    await loginAsStaff(page);

    // Navigate to account-settings via hash
    await page.evaluate(() => {
      window.location.hash = "account-settings";
    });

    // Should render the page (no modal)
    await expect(
      page.getByRole("dialog", { name: /acesso restrito/i })
    ).toHaveCount(0);

    // Confirm we are on the correct hash (URL preserved)
    await expect(page).toHaveURL(/#account-settings$/);
  });
});

/**
 * Helper: ensure the page is authenticated as STAFF.
 * Clears storage and re-logs in if not already on the dashboard shell.
 */
async function loginAsStaff(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside nav");
  if (await shell.isVisible({ timeout: 1_500 }).catch(() => false)) {
    // Verify it's a STAFF session (sanity check)
    const hasCatalog = await page
      .locator("aside nav")
      .getByText("Produtos", { exact: true })
      .count();
    if (hasCatalog === 0 && await page.getByRole("button", { name: /sair/i }).isVisible({ timeout: 1_000 }).catch(() => false)) {
      return; // already STAFF
    }
  }
  // Fresh login
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("input[type='email']").waitFor({ state: "visible", timeout: TIMEOUTS.auth });
  await page.locator("input[type='email']").fill(STAFF_EMAIL);
  await page.locator("input[type='password']").fill(STAFF_PASSWORD);
  await page.locator("button[type='submit']").click();
  await page.locator("aside nav").waitFor({ state: "visible", timeout: TIMEOUTS.auth });
}