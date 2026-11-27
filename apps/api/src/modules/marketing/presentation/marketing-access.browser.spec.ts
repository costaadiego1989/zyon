import { test } from "node:test";
import assert from "node:assert/strict";
import { marketingHttpFixture } from "../marketing-http.fixture.js";
import {
  marketingBrowserFixture,
  expect,
} from "../../../../../dashboard/tests/marketing-browser.fixture.mjs";

test("MKT-08/1 staff accesses Growth contacts without billing access and downgrade renders the plan gate", async () => {
  const api = await marketingHttpFixture();
  try {
    const c = api.contact();
    await api.repository.transaction(api.merchantId, "seed", (tx) =>
      tx.saveContact(c)
    );
    const browser = await marketingBrowserFixture(api, { role: "staff" });
    try {
      const url = `${browser.url}&view=marketing&role=staff&gated=true&user=${api.users.staff.id}`;
      await browser.page.goto(url);
      await expect(
        browser.page.getByRole("heading", {
          name: "Funil de relacionamento",
          exact: true,
        })
      ).toBeVisible();
      await expect(
        browser.page.getByRole("tab", { name: "Campanhas", exact: true })
      ).toHaveCount(0);
      await expect(
        browser.page.getByRole("tab", { name: "Configurações", exact: true })
      ).toHaveCount(0);
      assert.equal(
        (await api.request("/campaigns", { role: "staff" })).status,
        403
      );
      await api.db.merchantBillingSubscription.update({
        where: { merchantId: api.merchantId },
        data: { planKey: "starter179" },
      });
      const paths: string[] = [];
      browser.page.on("request", (request) => {
        if (request.url().includes("/marketing/"))
          paths.push(new URL(request.url()).pathname);
      });
      await browser.page.reload();
      await expect(
        browser.page.getByText("Disponível a partir do plano Growth", {
          exact: true,
        })
      ).toBeVisible();
      await expect(
        browser.page.getByRole("heading", {
          name: "Funil de relacionamento",
          exact: true,
        })
      ).toHaveCount(0);
      assert.equal(
        paths.some(
          (path) =>
            path.endsWith("/contacts") ||
            path.endsWith("/funnel") ||
            path.endsWith("/campaigns")
        ),
        false
      );
      assert.equal(
        (await api.request("/contacts", { role: "staff" })).status,
        403
      );
      assert.equal(
        (
          await api.repository.transaction(api.merchantId, "read", (tx) =>
            tx.contact(c.id)
          )
        )?.id,
        c.id
      );
      const probe = await api.request("/access", { role: "staff" });
      assert.equal(probe.status, 200);
      assert.deepEqual(await probe.json(), {
        enabled: false,
        minimumPlan: "growth",
      });
      assert.equal((await api.request("/access", { role: null })).status, 401);
      assert.deepEqual(browser.errors, []);
    } finally {
      await browser.close();
    }
  } finally {
    await api.cleanup();
  }
});
