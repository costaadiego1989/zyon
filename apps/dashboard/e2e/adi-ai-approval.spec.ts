import { test, expect } from "@playwright/test";
import { TIMEOUTS } from "./config";

/**
 * E2E: AI Suggestions Panel — Overview Page
 *
 * Scenario:
 * - Merchant logs in (uses auth state)
 * - Navigates to Overview (Visão Geral)
 * - AI Suggestions Panel renders with pending hypotheses
 * - Merchant clicks "Aprovar (aplicar direto)" on a candidate
 * - Card disappears and success toast appears
 *
 * Network mocking:
 * - GET /revenue-manager/hypotheses?status=pending_review → returns 1 candidate
 * - POST /revenue-manager/hypotheses/:id/approve → responds with 200
 */

const MOCK_HYPOTHESES = [
  {
    id: "hyp_test_001",
    hypothesis_text: "Ofereça 15% de desconto para carrinho acima de R$200",
    reasoning: "Estudos mostram que descontos segmentados aumentam conversão em 8%",
    expected_lift_percent: 8,
    risk_level: "low" as const,
    status: "pending_review" as const,
    created_at: new Date().toISOString(),
    template: {
      hypothesis_type: "discount_optimization",
      discount_rule_json: {
        id: "rule_001",
        name: "Desconto 15% acima R$200",
        enabled: true,
        priority: 1,
        conditions: [
          {
            field: "cart_total",
            operator: "gte",
            value: 200,
          },
        ],
        action: {
          type: "offer_discount",
          params: {
            percent: 15,
            maxDiscountReais: 100,
          },
        },
      },
    },
  },
];

test.describe("AI Suggestions Panel @ Overview", () => {
  test("@ai-approval — Merchant approves AI hypothesis; card disappears + toast shows", async ({
    page,
  }) => {
    // ── Setup: Mock network routes ────────────────────────────────────
    await page.route(`**/revenue-manager/hypotheses*`, (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_HYPOTHESES),
        });
      }
    });

    await page.route(
      "**/revenue-manager/hypotheses/hyp_test_001/approve",
      (route) => {
        if (route.request().method() === "POST") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({}),
          });
        }
      }
    );

    // ── Navigate to Overview ──────────────────────────────────────────
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // ── Wait for page shell to stabilize ──────────────────────────────
    await expect(page.locator("aside")).toBeVisible({
      timeout: TIMEOUTS.navigation,
    });

    // ── Verify AI Suggestions Panel renders ───────────────────────────
    await expect(
      page.locator("h3", { hasText: "Sugestões de IA" })
    ).toBeVisible({
      timeout: TIMEOUTS.element,
    });

    // Verify candidate card content
    await expect(
      page.locator(
        "text=Ofereça 15% de desconto para carrinho acima de R$200"
      )
    ).toBeVisible();

    // Verify expected lift badge
    await expect(page.locator("text=+8%")).toBeVisible();

    // Verify rule summary renders (SE + ENTÃO)
    await expect(page.locator("text=Valor do carrinho ≥ 200")).toBeVisible();
    await expect(
      page.locator("text=Oferecer 15% (cap R$100)")
    ).toBeVisible();

    // ── Click "Aprovar (aplicar direto)" button ───────────────────────
    const approveBtn = page.locator(
      "button:has-text('Aprovar (aplicar direto)')"
    );
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    // ── Verify success toast appears ──────────────────────────────────
    await expect(
      page.locator(
        "text=Sugestão aprovada — regra aplicada imediatamente"
      )
    ).toBeVisible({
      timeout: TIMEOUTS.element,
    });

    // ── Verify card disappears (removed from DOM) ─────────────────────
    await expect(
      page.locator(
        "text=Ofereça 15% de desconto para carrinho acima de R$200"
      )
    ).not.toBeVisible({
      timeout: TIMEOUTS.element,
    });

    // ── Verify AI Suggestions Panel self-hides (no candidates left) ────
    await expect(
      page.locator("h3", { hasText: "Sugestões de IA" })
    ).not.toBeVisible({
      timeout: TIMEOUTS.element,
    });
  });

  test("@ai-reject — Merchant rejects AI hypothesis; card disappears + toast shows", async ({
    page,
  }) => {
    // ── Setup: Mock network routes ────────────────────────────────────
    await page.route(`**/revenue-manager/hypotheses*`, (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_HYPOTHESES),
        });
      }
    });

    await page.route(
      "**/revenue-manager/hypotheses/hyp_test_001/reject",
      (route) => {
        if (route.request().method() === "POST") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({}),
          });
        }
      }
    );

    // ── Navigate to Overview ──────────────────────────────────────────
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // ── Wait for page shell to stabilize ──────────────────────────────
    await expect(page.locator("aside")).toBeVisible({
      timeout: TIMEOUTS.navigation,
    });

    // ── Verify AI Suggestions Panel renders ───────────────────────────
    await expect(
      page.locator("h3", { hasText: "Sugestões de IA" })
    ).toBeVisible({
      timeout: TIMEOUTS.element,
    });

    // ── Click "Rejeitar" button ───────────────────────────────────────
    const rejectBtn = page.locator("button:has-text('Rejeitar')").last();
    await expect(rejectBtn).toBeVisible();
    await rejectBtn.click();

    // ── Verify success toast appears ──────────────────────────────────
    await expect(
      page.locator("text=Sugestão rejeitada")
    ).toBeVisible({
      timeout: TIMEOUTS.element,
    });

    // ── Verify card disappears ────────────────────────────────────────
    await expect(
      page.locator(
        "text=Ofereça 15% de desconto para carrinho acima de R$200"
      )
    ).not.toBeVisible({
      timeout: TIMEOUTS.element,
    });

    // ── Verify AI Suggestions Panel self-hides ────────────────────────
    await expect(
      page.locator("h3", { hasText: "Sugestões de IA" })
    ).not.toBeVisible({
      timeout: TIMEOUTS.element,
    });
  });

  test("@ai-no-suggestions — No pending hypotheses; panel does not render", async ({
    page,
  }) => {
    // ── Setup: Mock network route to return empty ─────────────────────
    await page.route(`**/revenue-manager/hypotheses*`, (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      }
    });

    // ── Navigate to Overview ──────────────────────────────────────────
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // ── Wait for page shell to stabilize ──────────────────────────────
    await expect(page.locator("aside")).toBeVisible({
      timeout: TIMEOUTS.navigation,
    });

    // ── Verify AI Suggestions Panel is NOT rendered ───────────────────
    const suggestionHeading = page.locator("h3", {
      hasText: "Sugestões de IA",
    });
    await expect(suggestionHeading).not.toBeVisible({
      timeout: TIMEOUTS.element,
    });
  });
});
