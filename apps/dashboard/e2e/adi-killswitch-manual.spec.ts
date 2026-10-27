import { test, expect, type Page, type Route } from "@playwright/test";
import type { CheckoutSettings, MerchantRules } from "@zyon/shared-types";

/**
 * Autonomous-engine kill switch + manual advanced-rule authoring.
 *
 * Fully mocked with route.fulfill — no real API/seed required. Every dashboard
 * bootstrap and page-level request is intercepted so the two flows are
 * deterministic and assert only on the request bodies the UI emits.
 *
 * Flow 1: toggle the autonomous engine on the Regras page and confirm the
 *         PUT /merchants/me/rules body flips `autonomousEngineEnabled`.
 * Flow 2: open the advanced-rule editor on the Checkout page, author one rule,
 *         save, and confirm the PUT /checkout-settings body carries it.
 */

const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";

const BASE_RULES: MerchantRules = {
  maxDiscountPercent: 10,
  minimumMarginPercent: 38,
  allowFreeShipping: true,
  allowShippingDiscount: true,
  allowBonusItem: false,
  allowStackDiscountAndFreeShipping: false,
  freeShippingMinCartValue: 250,
  maxShippingSubsidy: 45,
  maxPartialShippingDiscount: 20,
  offerExpirationMinutes: 15,
  blockedRegions: [],
  brandVoice: "consultative",
  couponBoxEnabled: true,
  autonomousEngineEnabled: true,
  originZip: "01310-100",
};

const BASE_SETTINGS: CheckoutSettings = {
  merchantId: MERCHANT_ID,
  mode: "silent_until_trigger",
  widgetBehavior: {
    openWidgetOnTrigger: true,
    startMinimized: true,
    position: "bottom_right",
    initialDelaySeconds: 3,
    presentationMode: "fab",
    fabColor: "#3b82f6",
    inviteText: "Posso ajudar?",
    showCartBadge: true,
  },
  interventionPolicy: {
    minimumAbandonmentScore: 40,
    cooldownSeconds: 60,
    maxInterventionsPerSession: 3,
    progressiveDiscount: {
      enabled: false,
      mode: "progressive_only",
      maxProgressivePercent: 20,
      stages: { initial_coupon: 5, exit_intent: 8, abandoned_cart: 10, payment_nudge: 12 },
    },
  },
  triggerRules: [
    { trigger: "shipping_objection_detected", enabled: true, priority: 1 },
    { trigger: "coupon_field_clicked", enabled: true, priority: 2 },
    { trigger: "payment_failed", enabled: true, priority: 3 },
    { trigger: "exit_intent_detected", enabled: true, priority: 4 },
    { trigger: "idle_30_seconds", enabled: false, priority: 5 },
  ],
  suppressionRules: {
    suppressedSteps: [],
    blockedRegions: [],
    minimumCartValue: 0,
    suppressAfterOfferAccepted: true,
    respectBuyerOptOut: true,
  },
  handoff: { enabled: false, message: "", channels: [] },
  advancedRules: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function json(route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { etag: '"mock-etag"', ...headers },
    body: JSON.stringify(body),
  });
}

/** Common bootstrap mocks so the shell renders without a live API. */
async function mockBootstrap(page: Page) {
  await page.route("**/merchants/me", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return json(route, { id: MERCHANT_ID, name: "Athom Technologies", plan: "BOTH" });
  });
  await page.route("**/onboarding", (route) => json(route, { completed: true, steps: {} }));
  await page.route("**/agent-rules", (route) => {
    if (route.request().method() === "PUT") return json(route, route.request().postDataJSON());
    return json(route, { identity: {}, capabilities: {}, guardrails: {} });
  });
  await page.route("**/merchant/coupons", (route) => json(route, []));
}

async function gotoTab(page: Page, hash: string) {
  await page.goto(`/#${hash}`, { waitUntil: "domcontentloaded" });
  // Shell only mounts the tab after the mocked /merchants/me resolves.
  await expect(page.locator("aside")).toBeVisible({ timeout: 15_000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow 1 — autonomous engine kill switch
// ─────────────────────────────────────────────────────────────────────────────

test("@adi-killswitch autonomous engine toggle persists the flipped state via PUT", async ({ page }) => {
  test.setTimeout(60_000);
  await mockBootstrap(page);

  let putBody: MerchantRules | null = null;
  await page.route("**/merchants/me/rules", (route) => {
    if (route.request().method() === "PUT") {
      putBody = route.request().postDataJSON() as MerchantRules;
      return json(route, putBody);
    }
    return json(route, BASE_RULES);
  });

  await gotoTab(page, "rules");

  const toggle = page.locator("#autonomous-engine-toggle");
  await expect(toggle).toBeVisible({ timeout: 15_000 });

  // Starts enabled per BASE_RULES.
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  // Flip it off.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  // "Alterações não salvas" badge confirms the change marked the form dirty.
  await expect(page.locator(".badge-unsaved")).toBeVisible({ timeout: 10_000 });

  // Save (header "Salvar regras" enables once dirty).
  const saveBtn = page.getByRole("button", { name: /Salvar regras/i }).first();
  await expect(saveBtn).toBeEnabled({ timeout: 10_000 });

  const putPromise = page.waitForRequest(
    (r) => r.url().includes("/merchants/me/rules") && r.method() === "PUT",
  );
  await saveBtn.click();
  await putPromise;

  // The mutation body carried the flipped value.
  expect(putBody).not.toBeNull();
  expect(putBody!.autonomousEngineEnabled).toBe(false);

  // Toggle back on and confirm the switch responds (no save needed).
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 2 — manual advanced-rule authoring still works
// ─────────────────────────────────────────────────────────────────────────────

test("@adi-manual-rule adding an advanced rule saves it via PUT /checkout-settings", async ({ page }) => {
  test.setTimeout(60_000);
  await mockBootstrap(page);

  let putBody: CheckoutSettings | null = null;
  await page.route("**/checkout-settings", (route) => {
    // patchCheckoutSettings does a GET (ETag) then PUT; both hit this path.
    if (route.request().method() === "PUT") {
      putBody = route.request().postDataJSON() as CheckoutSettings;
      return json(route, { ...BASE_SETTINGS, ...putBody });
    }
    return json(route, BASE_SETTINGS);
  });

  await gotoTab(page, "settings");

  // Page renders.
  await expect(page.locator(".cfg-page h1")).toBeVisible({ timeout: 15_000 });

  // Switch to the "Regras" tab (advanced rules editor lives here).
  // Use role=tab to disambiguate from other "Regras" text on the page.
  await page.getByRole("tab", { name: /^Regras$/ }).click();

  // Open the rule editor (empty state or list both expose "Adicionar regra").
  await page.getByRole("button", { name: /Adicionar regra/i }).first().click();

  // Editor side-panel opens.
  const nameInput = page.locator("#rule-name");
  await expect(nameInput).toBeVisible({ timeout: 10_000 });

  // Author a rule: name + a discount condition/action.
  await nameInput.fill("Desconto carrinho alto");

  // Editor opens with zero conditions — add one first ("+ Condição").
  await page.getByRole("button", { name: /Condição/i }).first().click();

  // First condition value (SE cart_total > <value>).
  const condValue = page.locator(".cfg-rule-condition-row input[type='text']").first();
  await expect(condValue).toBeVisible({ timeout: 10_000 });
  await condValue.fill("300");

  // Action defaults to "offer_discount" → set the percent.
  const percentInput = page.locator(".cfg-rule-param input[type='number']").first();
  await expect(percentInput).toBeVisible();
  await percentInput.fill("15");

  // Create the rule (footer button reads "Criar regra" for a new rule).
  await page.getByRole("button", { name: /Criar regra/i }).click();

  // Editor closes; rule now appears in the list.
  await expect(nameInput).toHaveCount(0);
  await expect(page.getByText("Desconto carrinho alto")).toBeVisible();

  // Save the settings (header "Salvar").
  const saveBtn = page.locator("button.cfg-save").first();
  await expect(saveBtn).toBeEnabled({ timeout: 10_000 });

  // Register the PUT wait BEFORE clicking to avoid a race.
  const putPromise = page.waitForRequest(
    (r) => r.url().includes("/checkout-settings") && r.method() === "PUT",
    { timeout: 15_000 },
  );
  await saveBtn.click();
  await putPromise;

  // The persisted patch carries the authored rule.
  expect(putBody).not.toBeNull();
  expect(Array.isArray(putBody!.advancedRules)).toBe(true);
  const authored = putBody!.advancedRules.find((r) => r.name === "Desconto carrinho alto");
  expect(authored).toBeTruthy();
  expect(authored!.action.type).toBe("offer_discount");
  expect(String(authored!.action.params.percent)).toBe("15");
});
