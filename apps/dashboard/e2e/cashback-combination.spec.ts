import { expect, test, type Page } from "@playwright/test";
import type { CashbackProgramView, CashbackRules } from "@zyon/shared-types";

const baseRules: CashbackRules = { earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null, buyerMonthlyEarnLimitCents: null,
  monthlyBudgetCents: 100000, releaseTrigger: "payment_confirmed", releaseDelayDays: 0, expiryDays: null,
  minimumRedeemOrderCents: 0, maximumRedeemBps: 2000, maximumRedeemCents: null, allowWithDiscounts: true,
  terms: "Crédito promocional para novas compras nesta loja. Consulte validade e condições antes de usar." };

async function fixture(page: Page, legacy = false, generalCap: number | null = 2000) {
  let program: CashbackProgramView = { merchantId: "cashback-store", status: legacy ? "active" : "disabled", draft: legacy ? baseRules : null,
    published: legacy ? baseRules : null, version: legacy ? 1 : 0, updatedAt: null, generalDiscountCapBps: generalCap };
  const writes: Array<{ path: string; method: string; body: { rules?: Partial<CashbackRules> } | undefined }> = [];
  await page.route("**/cashback-test-api/v1/dashboard/cashback/**", async route => {
    const request = route.request(); const path = new URL(request.url()).pathname.split("/dashboard/cashback/")[1];
    const body = request.postData() ? request.postDataJSON() : undefined;
    writes.push({ path, method: request.method(), body });
    if (path === "program") {
      if (request.method() === "PATCH") program = { ...program, draft: body.rules, updatedAt: new Date().toISOString() };
      return route.fulfill({ json: program });
    }
    if (path === "program/publish") {
      expect(program.draft?.combination).toBeDefined();
      program = { ...program, status: "active", published: program.draft as CashbackRules, version: program.version + 1, updatedAt: new Date().toISOString() };
      return route.fulfill({ json: program });
    }
    if (path === "metrics") return route.fulfill({ json: { from: "2026-11-01T03:00:00Z", to: "2026-11-15T02:59:59Z", asOf: "2026-11-14T12:00:00Z",
      grantedCents: 0, releasedCents: 0, redeemedCents: 0, restoredCents: 0, expiredCents: 0, reversedCents: 0, lossCents: 0,
      pendingCents: 0, availableCents: 0, reservedCents: 0, buyersGranted: 0, buyersRedeemed: 0, ordersWithCashback: 0,
      associatedRevenueCents: 0, budgetCommittedCents: 0, budgetIssuedCents: 0, budgetLimitCents: null } });
    return route.fulfill({ status: 404, json: { message: "unexpected_test_route" } });
  });
  await page.goto("/e2e/fixtures/cashback.html");
  await expect(page.getByRole("heading", { name: "Cashback", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Configuração", exact: true }).click();
  return { program: () => program, writes };
}

async function fillBase(page: Page) {
  await page.getByLabel("Percentual de cashback (%)", { exact: true }).fill("5");
  await page.getByLabel("Compra mínima para ganhar (R$)", { exact: true }).fill("0");
  await page.getByLabel("Ganho máximo por pedido", { exact: true }).selectOption("unlimited");
  await page.getByLabel("Ganho máximo por cliente no mês", { exact: true }).selectOption("unlimited");
  await page.getByLabel("Orçamento mensal da loja", { exact: true }).selectOption("limited");
  await page.getByLabel("Orçamento mensal da loja — valor em R$", { exact: true }).fill("1000");
  await page.getByLabel("Marco de liberação", { exact: true }).selectOption("payment_confirmed");
  await page.getByLabel("Carência após o marco (dias)", { exact: true }).fill("0");
  await page.getByLabel("Validade do crédito", { exact: true }).selectOption("unlimited");
  await page.getByLabel("Compra mínima para usar (R$)", { exact: true }).fill("0");
  await page.getByLabel("Limite de uso por compra (%)", { exact: true }).fill("20");
  await page.getByLabel("Valor máximo de uso por compra", { exact: true }).selectOption("unlimited");
  await page.getByLabel("Condições do cashback", { exact: true }).fill(baseRules.terms);
}
async function fillCombination(page: Page, mode = "cashback_specific") {
  await page.getByLabel("Combinar cashback com cupons", { exact: true }).selectOption("yes");
  await page.getByLabel("Combinar cashback com regras avançadas", { exact: true }).selectOption("yes");
  await page.getByLabel("Qual teto deve prevalecer?", { exact: true }).selectOption(mode);
  await page.getByLabel("Teto conjunto em percentual", { exact: true }).selectOption("limited");
  await page.getByLabel("Teto conjunto dos benefícios (%)", { exact: true }).fill("30");
  await page.getByLabel("Teto conjunto em reais", { exact: true }).selectOption("unlimited");
}
async function simulate(page: Page) {
  await page.getByLabel("Valor dos produtos para simular (R$)", { exact: true }).fill("100");
  await page.getByLabel("Desconto efetivo do cupom (R$)", { exact: true }).fill("10");
  await page.getByLabel("Desconto efetivo da regra avançada (R$)", { exact: true }).fill("5");
}
const result = (page: Page) => page.getByRole("status").filter({ hasText: "Cashback máximo nesta compra:" });
async function capture(page: Page, name: string) {
  if (await result(page).count()) { await result(page).scrollIntoViewIfNeeded(); await expect(result(page)).toBeInViewport(); }
  else if (await page.getByRole("alert").count()) await page.getByRole("alert").last().scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `../../.specs/features/cashback-stacking/evidence/dashboard-combination-${name}-${test.info().project.name}.png`, fullPage: true });
}

test("CS-01 CS-08 independent permissions and explicit bounded caps block incomplete publication", async ({ page }) => {
  const app = await fixture(page); await fillBase(page);
  for (const label of ["Combinar cashback com cupons", "Combinar cashback com regras avançadas", "Qual teto deve prevalecer?", "Teto conjunto em percentual", "Teto conjunto em reais"]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
  }
  await page.getByRole("button", { name: "Revisar e publicar" }).click();
  await expect(page.getByRole("alert")).toHaveCount(5);
  expect(app.writes.filter(item => item.path === "program/publish")).toHaveLength(0);
  await fillCombination(page); await page.getByLabel("Teto conjunto em percentual", { exact: true }).selectOption("unlimited");
  await page.getByRole("button", { name: "Revisar e publicar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Defina pelo menos um teto: percentual, valor em reais ou ambos.");
  await page.getByLabel("Teto conjunto em percentual", { exact: true }).selectOption("limited");
  await page.getByLabel("Teto conjunto dos benefícios (%)", { exact: true }).fill("100,01");
  await page.getByRole("button", { name: "Revisar e publicar" }).click();
  await expect(page.getByRole("alert")).toContainText("até 100%");
  await capture(page, "validation");
});

test("CS-03 CS-08 merchant reviews the exact combined total and publishes independent settings", async ({ page }) => {
  const app = await fixture(page); await fillBase(page); await fillCombination(page);
  await page.getByRole("button", { name: "Revisar e publicar" }).click();
  await expect(page.getByRole("heading", { name: "Confira antes de ativar" })).toBeInViewport();
  await expect(page.getByRole("term").filter({ hasText: "Cashback com cupons" })).toBeVisible();
  await simulate(page);
  await expect(result(page)).toContainText("R$ 15,00"); await expect(result(page)).toContainText("R$ 70,00"); await expect(result(page)).toContainText("R$ 3,50");
  await capture(page, "specific-review");
  expect(app.writes.filter(item => item.path === "program/publish")).toHaveLength(0);
  await page.getByRole("button", { name: "Publicar e ativar", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cashback publicado" })).toBeVisible();
  expect(app.program().published?.combination).toEqual({ allowCoupons: true, allowAdvancedRules: true, limitMode: "cashback_specific", maximumCombinedDiscountBps: 3000, maximumCombinedDiscountCents: null });
  expect(app.program().published?.allowWithDiscounts).toBe(true);
  await page.reload(); await page.getByRole("button", { name: "Configuração", exact: true }).click();
  await expect(page.getByLabel("Combinar cashback com cupons", { exact: true })).toHaveValue("yes");
  await expect(page.getByLabel("Teto conjunto dos benefícios (%)", { exact: true })).toHaveValue("30,00");
});

test("CS-02 CS-04 CS-08 the general cap and disallowed benefit remain explicit in simulation", async ({ page }) => {
  await fixture(page); await fillBase(page); await fillCombination(page, "respect_general");
  await expect(page.getByText("Teto geral atual: 20%. Prevalece o menor teto aplicável.")).toBeVisible();
  await page.getByRole("button", { name: "Revisar e publicar" }).click(); await simulate(page);
  await expect(result(page)).toContainText("R$ 5,00"); await expect(result(page)).toContainText("R$ 80,00");
  await capture(page, "general-review");
  await page.getByRole("button", { name: "Voltar às regras", exact: true }).click();
  await page.getByLabel("Combinar cashback com cupons", { exact: true }).selectOption("no");
  await page.getByRole("button", { name: "Revisar e publicar" }).click();
  await expect(page.getByRole("alert")).toContainText("combinação com cupons não é permitida"); await expect(result(page)).toHaveCount(0);
});

test("CS-07 CS-08 a legacy program requires fresh combination choices and unknown general cap is not fabricated", async ({ page }) => {
  const app = await fixture(page, true, null);
  await expect(page.getByText("Estas regras ainda usam a configuração anterior.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Combinar cashback com cupons", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Revisar e publicar" }).click(); await expect(page.getByRole("alert")).toHaveCount(5);
  expect(app.writes.filter(item => item.path === "program/publish")).toHaveLength(0);
  await fillCombination(page, "respect_general"); await page.getByRole("button", { name: "Revisar e publicar" }).click(); await simulate(page);
  await expect(page.getByRole("alert")).toContainText("O teto geral da loja ainda não está disponível"); await expect(result(page)).toHaveCount(0);
  await capture(page, "legacy-general-unavailable");
});
