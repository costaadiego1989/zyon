import { test, expect, type Page } from "@playwright/test";

const enabled = process.env.RUN_LIVE_ERP_TESTS === "1";
const storageState = process.env.ERP_LIVE_STORAGE_STATE;
const requestedProviders = (process.env.ERP_LIVE_PROVIDERS ?? "omie,tiny,bling")
  .split(",")
  .map((provider) => provider.trim().toLowerCase())
  .filter((provider): provider is "omie" | "tiny" | "bling" => ["omie", "tiny", "bling"].includes(provider));

test.skip(!enabled, "Set RUN_LIVE_ERP_TESTS=1 to allow calls to real ERP accounts.");
test.skip(!storageState, "Set ERP_LIVE_STORAGE_STATE to a locally captured authenticated dashboard session.");

async function openErpPage(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("aside").first()).toBeVisible({ timeout: 20_000 });
  await page.getByText("Estoque", { exact: true }).first().click();
  await page.getByText("Conectores ERP", { exact: true }).click();
}

async function syncAndAssert(page: Page, provider: "omie" | "tiny" | "bling"): Promise<void> {
  const card = page.getByTestId(`erp-card-${provider}`);
  await expect(card.getByText("Conectado", { exact: true })).toBeVisible();

  const syncResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/erp-connections/") && response.url().endsWith("/sync"),
  );
  await card.getByTestId(`erp-sync-${provider}`).click();
  expect((await syncResponse).ok()).toBe(true);

  await expect.poll(async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Conectores ERP", { exact: true }).click();
    return card.getByText(/Última sync:/).count();
  }, { timeout: 120_000, intervals: [2_000, 5_000, 10_000] }).toBeGreaterThan(0);
}

test.describe("live ERP connections", () => {
  test.describe.configure({ mode: "serial" });

  test("Omie connects with locally supplied credentials and finishes a stock snapshot", async ({ page }) => {
    test.skip(!requestedProviders.includes("omie"), "Omie not selected in ERP_LIVE_PROVIDERS.");
    await openErpPage(page);
    const card = page.getByTestId("erp-card-omie");

    if (await card.getByText("Não conectado", { exact: true }).isVisible()) {
      test.skip(!process.env.ERP_LIVE_OMIE_APP_KEY || !process.env.ERP_LIVE_OMIE_APP_SECRET, "Set Omie credentials in the local environment.");
      await card.getByTestId("erp-connect-omie").click();
      await page.getByTestId("erp-omie-app-key").fill(process.env.ERP_LIVE_OMIE_APP_KEY!);
      await page.getByTestId("erp-omie-app-secret").fill(process.env.ERP_LIVE_OMIE_APP_SECRET!);
      const response = page.waitForResponse((item) => item.request().method() === "POST" && item.url().endsWith("/erp-connections/omie/connect"));
      await page.getByTestId("erp-credential-submit-omie").click();
      expect((await response).ok()).toBe(true);
    }

    await syncAndAssert(page, "omie");
  });

  test("Tiny/Olist connects with a locally supplied API token and finishes a stock snapshot", async ({ page }) => {
    test.skip(!requestedProviders.includes("tiny"), "Tiny/Olist not selected in ERP_LIVE_PROVIDERS.");
    await openErpPage(page);
    const card = page.getByTestId("erp-card-tiny");

    if (await card.getByText("Não conectado", { exact: true }).isVisible()) {
      test.skip(!process.env.ERP_LIVE_TINY_API_TOKEN, "Set the Tiny/Olist API token in the local environment.");
      await card.getByTestId("erp-connect-tiny").click();
      await page.getByTestId("erp-tiny-api-token").fill(process.env.ERP_LIVE_TINY_API_TOKEN!);
      const response = page.waitForResponse((item) => item.request().method() === "POST" && item.url().endsWith("/erp-connections/tiny/connect"));
      await page.getByTestId("erp-credential-submit-tiny").click();
      expect((await response).ok()).toBe(true);
    }

    await syncAndAssert(page, "tiny");
  });

  test("Bling stock snapshot is verified after its interactive OAuth consent", async ({ page }) => {
    test.skip(!requestedProviders.includes("bling"), "Bling not selected in ERP_LIVE_PROVIDERS.");
    await openErpPage(page);
    const card = page.getByTestId("erp-card-bling");
    test.skip(await card.getByText("Não conectado", { exact: true }).isVisible(), "Complete the Bling OAuth consent in the dashboard, then rerun this test.");
    await syncAndAssert(page, "bling");
  });
});
