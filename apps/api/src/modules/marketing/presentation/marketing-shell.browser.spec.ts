import { test } from "node:test";
import assert from "node:assert/strict";
import { marketingHttpFixture } from "../marketing-http.fixture.js";
import {
  marketingBrowserFixture,
  expect,
} from "../../../../../dashboard/tests/marketing-browser.fixture.mjs";
import { mkdir } from "node:fs/promises";

test("MKT-10/3 complete dashboard navigation exposes loading empty failure retry and access denial at every supported width", async () => {
  const f = await marketingHttpFixture();
  try {
    const browser = await marketingBrowserFixture(f, {
      entry: "marketing-shell-entry.tsx",
    });
    browser.page.on("pageerror", (error) => console.error(error.stack));
    try {
      let failContacts = false;
      let delay = true;
      await browser.page.route("**/v1/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.includes("/marketing/")) {
          if (path.endsWith("/contacts") && failContacts)
            return route.fulfill({
              status: 503,
              json: {
                message: "marketing_unavailable",
                code: "marketing_unavailable",
              },
            });
          if (path.endsWith("/contacts") && delay) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            delay = false;
          }
          return route.continue();
        }
        return route.fulfill({
          status: 200,
          json:
            path.endsWith("/domains") || path.endsWith("/notifications")
              ? []
              : {
                  plan: "growth",
                  planKey: "growth",
                  plan_key: "growth",
                  status: "active",
                  data: [],
                  stores: [],
                  items: [],
                  total: 0,
                },
        });
      });
      await browser.page.goto(
        `${browser.url}&user=${f.users.owner.id}#marketing`
      );
      await expect(
        browser.page.getByText("Carregando contatos…", { exact: true })
      ).toBeVisible();
      await expect(
        browser.page.getByText("Nenhum contato neste filtro", { exact: true })
      ).toBeVisible();
      await mkdir(".specs/features/marketing-conversations-crm/screens", {
        recursive: true,
      });
      for (const width of [1440, 390, 320]) {
        await browser.page.setViewportSize({ width, height: 1000 });
        if (width < 600)
          await browser.page
            .getByLabel("Navegar no dashboard")
            .selectOption("conversations");
        else
          await browser.page
            .getByRole("button", { name: "Conversas", exact: true })
            .click();
        await expect(
          browser.page.getByText("Nenhuma conversa neste filtro", {
            exact: true,
          })
        ).toBeVisible();
        for (const control of await browser.page
          .locator(".ui-filter-select")
          .all()) {
          const bounds = await control.boundingBox();
          assert.ok(
            bounds && bounds.x >= 0 && bounds.x + bounds.width <= width,
            `fully visible conversation filter at ${width}px`
          );
        }
        assert.equal(
          await browser.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          true,
          `conversations ${width}`
        );
        await browser.page.screenshot({
          path: `.specs/features/marketing-conversations-crm/screens/conversations-${width}.png`,
          fullPage: true,
        });
        if (width < 600)
          await browser.page
            .getByLabel("Navegar no dashboard")
            .selectOption("marketing");
        else
          await browser.page
            .getByRole("button", { name: "Marketing", exact: true })
            .click();
        await expect(
          browser.page.getByText("Nenhum contato neste filtro", { exact: true })
        ).toBeVisible();
        assert.equal(
          await browser.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          true,
          `marketing ${width}`
        );
        await browser.page.screenshot({
          path: `.specs/features/marketing-conversations-crm/screens/marketing-${width}.png`,
          fullPage: true,
        });
      }
      failContacts = true;
      await browser.page.reload();
      await expect(browser.page.getByRole("alert")).toBeVisible();
      failContacts = false;
      await browser.page
        .getByRole("button", { name: "Tentar novamente", exact: true })
        .click();
      await expect(
        browser.page.getByText("Nenhum contato neste filtro", { exact: true })
      ).toBeVisible();
      await f.db.merchantBillingSubscription.update({
        where: { merchantId: f.merchantId },
        data: { planKey: "starter179" },
      });
      await browser.page.reload();
      await expect(
        browser.page.getByText("Disponível a partir do plano Growth", {
          exact: true,
        })
      ).toBeVisible();
      assert.deepEqual(browser.errors, []);
    } catch (error) {
      console.error(
        "marketing_shell_failure",
        browser.errors,
        await browser.page.locator("body").innerText()
      );
      throw error;
    } finally {
      await browser.close();
    }
  } finally {
    await f.cleanup();
  }
});
