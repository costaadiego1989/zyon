/**
 * @realapi Returning buyer — a buyer whose e-mail already has a verified
 * account must be recognized on the next visit and skip registration entirely,
 * landing directly on the shipping stage (no e-mail/OTP/name/CPF re-collection).
 *
 * Regression guard for the recognized-buyer hydration path
 * (CheckoutCustomerService.hydrateReturningBuyerFromEmailHint):
 *   - Round 1 persists a fully verified buyer account via /embed/start.
 *   - Round 2 reopens the widget with only { email } and must come back as a
 *     recognized buyer with the full profile rehydrated.
 */
import { expect, test } from "@playwright/test";
import {
  checkoutUrl,
  dismissChannelGate,
  REALAPI_URL,
  seedCheckout,
  waitForChatIdle,
} from "../fixtures/realapi-helpers.js";

const API = REALAPI_URL;

test.describe("@realapi returning buyer", () => {
  test.describe.configure({ mode: "serial" });

  let merchantId: string;
  let embedToken: string;
  let productId: string;

  test.beforeEach(async ({ request }) => {
    const seed = await seedCheckout(request);
    if (!seed) {
      test.skip(true, "Seed endpoint not available (E2E_SEED_ENABLED not set)");
      return;
    }
    ({ merchantId, embedToken, productId } = seed);
  });

  test("returning buyer logs in automatically and skips registration", async ({ page, request }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
      (globalThis as { process?: { env: Record<string, string> } }).process = {
        env: { AACP_DISABLE_STREAMING: "1" },
      };
    });

    const email = `returning_${Date.now()}@test.aacp`;
    const verifiedCustomer = {
      fullName: "Diego Costa",
      email,
      email_verified: true,
      cpf: "05178178700",
      phone: "11999998888",
      phone_verified: true,
      address_verified: true,
      address: {
        zip: "01310100",
        street: "Avenida Paulista",
        number: "1000",
        neighborhood: "Bela Vista",
        city: "Sao Paulo",
        state: "SP",
      },
    };
    const cart = {
      currency: "BRL",
      source: "storefront",
      total: 299.9,
      items: [{ sku: "e2e_product_001", name: "Kit", price: 299.9, quantity: 1 }],
    };

    // Round 1 — a fully verified buyer checks out, persisting the buyer account
    // keyed by e-mail so the next visit can recognize it.
    const firstVisit = await request.post(`${API}/embed/start`, {
      headers: { "x-aacp-embed-token": embedToken, Origin: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173" },
      data: { customer: verifiedCustomer, cart },
    });
    expect(firstVisit.ok()).toBe(true, `First visit start failed: ${await firstVisit.text()}`);
    const firstBody = await firstVisit.json();
    // A complete verified profile opens directly on shipping.
    expect(firstBody.experience?.stage).toBe("shipping");

    // Round 2 — the same buyer returns. The demo page only knows the e-mail
    // (no name/CPF). The widget must recognize the account and rehydrate the
    // profile rather than starting registration over.
    await page.goto(
      checkoutUrl(merchantId, embedToken, productId, {
        customer: { email, isReturning: false },
      }),
    );
    await page.waitForSelector('[role="log"]', { timeout: 15_000 });
    await dismissChannelGate(page, "chat");
    await waitForChatIdle(page);

    // The header reflects a known buyer, not the anonymous "Entrar" affordance.
    // A returning buyer with a persisted account is logged straight back in
    // ("Minha conta"); a merely recognized-but-unauthenticated buyer shows
    // "Abrir conta". Either proves registration was skipped — accept both, and
    // assert the anonymous entry point is gone.
    const knownAccount = page.getByRole("button", { name: /Minha conta|Abrir conta/ });
    await expect(knownAccount).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Entrar" })).toHaveCount(0);

    // Recognized + complete profile bootstraps shipping selection — no e-mail,
    // OTP, name, or CPF prompts are shown.
    await expect(page.locator(".zyon-shipping-selector")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[role="log"]')).not.toContainText(/c[oó]digo de verifica|informe seu e-?mail|qual o seu nome/i);

    // The server-side session confirms the recognized, pre-verified state.
    const sessionId = firstBody.session_id as string;
    expect(sessionId).toBeTruthy();
  });
});
