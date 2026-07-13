import { test, expect, type Page } from "@playwright/test";

/* ── Login helper ──────────────────────────────────────────────── */

async function loginIfNeeded(page: Page) {
  const emailInput = page.locator("input[placeholder='owner@loja.com']");
  const isLoginPage = await emailInput.isVisible({ timeout: 2000 }).catch(() => false);
  if (isLoginPage) {
    await emailInput.click();
    await emailInput.pressSequentially("demo@zyon.com", { delay: 50 });
    await page.waitForTimeout(300);
    const passwordInput = page.locator("input[type='password']");
    await passwordInput.click();
    await passwordInput.pressSequentially("demo1234", { delay: 50 });
    await page.waitForTimeout(300);
    await page.locator("button[type='submit']").click();
    await page.waitForTimeout(3000);
  }
}

/* ── Navigate to Faturamento ───────────────────────────────────── */

async function navigateToBilling(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await loginIfNeeded(page);
  // Wait for nav shell to render
  await expect(page.locator("nav")).toBeVisible({ timeout: 10_000 });
  // Click Faturamento nav item
  await page.locator("text=Faturamento").first().click();
  await page.waitForTimeout(1500);
}

/* ── Tests ─────────────────────────────────────────────────────── */

test.describe("Billing Module", () => {
  test("@billing-load — Page renders with title pattern (CONTA + Faturamento + lead)", async ({ page }) => {
    await navigateToBilling(page);

    // Shell nav visible
    await expect(page.locator("nav")).toBeVisible();

    // CONTA section label
    await expect(page.locator("text=CONTA").first()).toBeVisible({ timeout: 10_000 });

    // Page title
    await expect(page.locator("h1", { hasText: "Faturamento" })).toBeVisible({ timeout: 10_000 });

    // Lead text under title
    await expect(
      page.locator("text=Gerencie sua assinatura e acompanhe o uso da plataforma")
    ).toBeVisible({ timeout: 5_000 });
  });

  test("@billing-subscription — Subscription card renders with plan info", async ({ page }) => {
    await navigateToBilling(page);

    // Wait for page to load
    await expect(page.locator("h1", { hasText: "Faturamento" })).toBeVisible({ timeout: 10_000 });

    // PLANO ATUAL stat card (always rendered in the metrics grid)
    await expect(page.locator("text=Plano Atual").first()).toBeVisible({ timeout: 10_000 });

    // Either subscription section OR no-plan message must be present
    const subscriptionSection = page.locator("[aria-label='Assinatura atual']");
    const noPlanMessage = page.locator("text=Você ainda não tem um plano ativo");

    const hasSub = await subscriptionSection.isVisible({ timeout: 5_000 }).catch(() => false);
    const hasNoPlan = await noPlanMessage.isVisible({ timeout: 3_000 }).catch(() => false);

    expect(hasSub || hasNoPlan).toBeTruthy();

    if (hasSub) {
      // Verify subscription details: Plano label and dt/dd structure
      await expect(subscriptionSection.locator("text=Plano").first()).toBeVisible();
      await expect(subscriptionSection.locator("text=Status").first()).toBeVisible();
      await expect(subscriptionSection.locator("text=Renovação").first()).toBeVisible();
    }
  });

  test("@billing-status — Status badge visible (trialing/active/etc)", async ({ page }) => {
    await navigateToBilling(page);

    // Wait for page to load
    await expect(page.locator("h1", { hasText: "Faturamento" })).toBeVisible({ timeout: 10_000 });

    // The status badge in the metrics grid uses these localized labels.
    // Wait for the page to settle (subscription fetch) before checking.
    await page.waitForTimeout(2000);

    // Possible status labels from STATUS_LABEL mapping
    const statusCandidates = [
      "Ativa",
      "Em teste",
      "Em atraso",
      "Cancelada",
      "Pendente",
      "Expirada",
      "Pagamento pendente",
      "Sem plano",
    ];

    let foundStatus: string | null = null;
    for (const label of statusCandidates) {
      const visible = await page
        .locator(`text=${label}`)
        .first()
        .isVisible({ timeout: 1_000 })
        .catch(() => false);
      if (visible) {
        foundStatus = label;
        break;
      }
    }

    // The Status stat card must always render (with at least "Sem plano" or a real status)
    const statusCard = page.locator("article").filter({ has: page.locator("text=Status") });
    const statusCardVisible = await statusCard.first().isVisible({ timeout: 3_000 }).catch(() => false);

    expect(statusCardVisible || foundStatus !== null).toBeTruthy();
  });

  test("@billing-trial-info — Trial end date visible when present", async ({ page }) => {
    await navigateToBilling(page);

    // Wait for page to load
    await expect(page.locator("h1", { hasText: "Faturamento" })).toBeVisible({ timeout: 10_000 });

    // Wait for subscription fetch
    await page.waitForTimeout(2000);

    const subscriptionSection = page.locator("[aria-label='Assinatura atual']");
    const hasSub = await subscriptionSection.isVisible({ timeout: 5_000 }).catch(() => false);

    if (hasSub) {
      // Fim do teste label is conditionally rendered when subscription.trial_end exists
      const trialLabel = subscriptionSection.locator("text=Fim do teste");
      const trialVisible = await trialLabel.isVisible({ timeout: 3_000 }).catch(() => false);

      // If subscription exists, at least the "Renovação" date should be visible
      const renewalLabel = subscriptionSection.locator("text=Renovação");
      await expect(renewalLabel).toBeVisible({ timeout: 5_000 });

      // Trial end may or may not be present depending on subscription state — just ensure it doesn't crash
      // If visible, verify a date string follows
      if (trialVisible) {
        const ddValue = await trialLabel.locator("xpath=following-sibling::dd").first().textContent();
        expect(ddValue).toBeTruthy();
      }
    } else {
      // No subscription: trial info not expected; this test still passes (graceful skip)
      // but verify the "no plan" message is rendered
      await expect(page.locator("text=Você ainda não tem um plano ativo")).toBeVisible({ timeout: 3_000 });
    }
  });

  test("@billing-no-js-errors — No critical JS errors during interaction", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Ignore known benign errors
        if (
          text.includes("favicon") ||
          text.includes("net::ERR_") ||
          text.includes("Failed to load resource")
        ) {
          return;
        }
        errors.push(text);
      }
    });

    page.on("pageerror", (err) => {
      errors.push(`PAGE ERROR: ${err.message}`);
    });

    await navigateToBilling(page);

    // Wait for page to settle
    await expect(page.locator("h1", { hasText: "Faturamento" })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2000);

    // Interact: click refresh button if present
    const refreshBtn = page.locator("button").filter({ hasText: "Atualizar" });
    if (await refreshBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await refreshBtn.click();
      await page.waitForTimeout(2000);
    }

    // No critical JS errors should have been recorded
    expect(errors).toEqual([]);
  });
});
