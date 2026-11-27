import { test } from "node:test";
import assert from "node:assert/strict";
import { marketingHttpFixture } from "../marketing-http.fixture.js";
import { marketingBrowserFixture, expect } from "../../../../../dashboard/tests/marketing-browser.fixture.mjs";
import { GetMerchantProfileUseCase } from "../../merchant/application/merchant.use-cases.js";
import { PrismaMerchantRepository } from "../../merchant/infrastructure/prisma-merchant.repository.js";

test("MKT-03/4 staff enters the actual dashboard without reading administrative bootstrap settings", async () => {
  const api = await marketingHttpFixture();
  try {
    const profile = await new GetMerchantProfileUseCase(new PrismaMerchantRepository(api.db)).execute(api.merchantId, {
      kind: "human", tenantId: api.merchantId, userId: api.users.staff.id, email: "staff@qa.invalid", role: "staff",
    });
    const browser = await marketingBrowserFixture(api, { role: "staff", entry: "../src/main.tsx" });
    try {
      let administrativeReads = 0;
      await browser.page.route("**/v1/merchants/me", route => route.fulfill({ json: profile }));
      await browser.page.route("**/v1/merchants/me/store-settings", route => {
        administrativeReads++;
        return route.fulfill({ status: 403, json: { message: "staff_operation_not_permitted" } });
      });
      await browser.page.goto(browser.url + "#marketing");
      await expect(browser.page.getByRole("heading", { name: "Marketing", exact: true })).toBeVisible({ timeout: 15000 });
      await expect(browser.page.getByRole("tab", { name: "Contatos e funil", exact: true })).toBeVisible();
      await expect(browser.page.getByRole("tab", { name: "Campanhas", exact: true })).toHaveCount(0);
      await expect(browser.page.getByRole("tab", { name: "Configurações", exact: true })).toHaveCount(0);
      assert.equal(administrativeReads, 0);
    } finally { await browser.close(); }
  } finally { await api.cleanup(); }
});
