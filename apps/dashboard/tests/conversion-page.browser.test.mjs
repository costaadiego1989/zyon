import { test } from "node:test";
import assert from "node:assert/strict";
import {
  marketingBrowserFixture,
  expect,
} from "./marketing-browser.fixture.mjs";

test("conversion page keeps all period, segment and comparison controls inside the available content width", async () => {
  const fixture = await marketingBrowserFixture(
    {
      base: "http://127.0.0.1:39999/marketing",
      merchantId: "conversion-page-only",
      users: { owner: { token: "local-only" } },
    },
    { entry: "conversion-page-entry.tsx" }
  );
  try {
    const { page } = fixture,
      requests = [];
    await page.route("http://127.0.0.1:39999/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      requests.push(url);
      const body = url.pathname.endsWith("/sessions")
        ? { sessions: [], total: 0, status: "all" }
        : {
            steps: [
              {
                name: "checkout_started",
                label: "Checkout iniciado",
                count: 100,
                percentage: 100,
              },
              {
                name: "shipping_calculated",
                label: "Frete selecionado",
                count: 60,
                percentage: 60,
              },
              {
                name: "payment_method_selected",
                label: "Pagamento selecionado",
                count: 40,
                percentage: 40,
              },
              {
                name: "order_completed",
                label: "Pagamento concluído",
                count: 20,
                percentage: 20,
              },
              {
                name: "coupon_applied",
                label: "Cupom aplicado",
                count: 10,
                percentage: 10,
              },
              {
                name: "payment_failed",
                label: "Pagamento falhado",
                count: 5,
                percentage: 5,
              },
            ],
            transitions: [],
            bottleneck: null,
            period: { from: "2026-11-20", to: "2026-11-27" },
            totalSessions: 100,
            overallConversion: 20,
          };
      await route.fulfill({
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": new URL(fixture.url).origin,
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "content-type,authorization",
        },
        body: JSON.stringify(body),
      });
    });
    await page.goto(fixture.url);
    await page
      .getByRole("tab", { name: "Jornada do checkout", exact: true })
      .click();
    await expect(
      page.locator(".funnel-diagram__stages [data-funnel-stage]")
    ).toHaveCount(4);
    await page
      .getByRole("checkbox", {
        name: "Comparar com o período anterior",
        exact: true,
      })
      .check();
    await expect
      .poll(() =>
        requests.some((url) => url.searchParams.get("compare") === "true")
      )
      .toBe(true);
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const clipped = await page
        .locator(".funnel-query")
        .evaluate((container) => {
          const edge = container.getBoundingClientRect();
          return [...container.querySelectorAll("button,input,select,label")]
            .filter((el) => {
              const rect = el.getBoundingClientRect();
              return (
                rect.width &&
                (rect.left < edge.left - 1 || rect.right > edge.right + 1)
              );
            })
            .map((el) => el.textContent || el.getAttribute("aria-label"));
        });
      assert.deepEqual(clipped, [], `clipped controls at ${width}`);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      );
    }
    assert.deepEqual(fixture.errors, []);
  } finally {
    await fixture.close();
  }
});
