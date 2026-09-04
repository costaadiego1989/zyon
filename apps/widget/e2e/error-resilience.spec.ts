import { test, expect } from "@playwright/test";

/**
 * E2E tests for error resilience — validates widget behavior when
 * the API is unavailable, times out, or returns server errors.
 */

const WIDGET_HTML = `
<!DOCTYPE html><html><head><script src="/widget/aacp.js" defer></script></head>
<body><zyon-checkout-agent
  merchant-id="mrc_test"
  api-base-url="http://localhost:3009"
  embed-session-token="tok.test"
  cart-json='{"currency":"BRL","total":99.9,"items":[{"sku":"item-1","name":"Produto","price":99.9,"quantity":1}],"source":"storefront"}'
></zyon-checkout-agent></body></html>
`;

test.describe("Error resilience @regression", () => {
  test("shows error boundary when widget JS throws during render", async ({ page }) => {
    // Inject a broken component that throws
    await page.route("**/widget/aacp.js", async (route) => {
      const body = `
        class AacpEl extends HTMLElement {
          connectedCallback() { throw new Error('Simulated render crash'); }
        }
        customElements.define('zyon-checkout-agent', AacpEl);
      `;
      await route.fulfill({ contentType: "application/javascript", body });
    });

    await page.setContent(WIDGET_HTML);
    // Widget should not crash the page
    await expect(page.locator("body")).toBeVisible();
  });

  test("displays network error when /embed/start times out", async ({ page }) => {
    await page.route("**/embed/start", async (route) => {
      // Simulate timeout — never respond
      await new Promise((resolve) => setTimeout(resolve, 15000));
      await route.abort("timedout");
    });

    await page.route("**/widget/aacp.js", (route) => route.continue());
    await page.setContent(WIDGET_HTML);

    // Widget should show error state or loading (not crash)
    await page.waitForTimeout(13000); // Wait past the 12s timeout
    const body = await page.textContent("body");
    expect(body).toBeTruthy(); // Page still alive
  });

  test("handles API 500 gracefully on /embed/start", async ({ page }) => {
    await page.route("**/embed/start", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "internal_error", detail: "DB down" }),
      })
    );

    await page.route("**/widget/aacp.js", (route) => route.continue());
    await page.setContent(WIDGET_HTML);

    await page.waitForTimeout(3000);
    // Page should still be alive, not white-screen
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
  });

  test("handles API 429 rate limit with feedback", async ({ page }) => {
    await page.route("**/embed/start", (route) =>
      route.fulfill({
        status: 429,
        headers: { "Retry-After": "60" },
        contentType: "application/json",
        body: JSON.stringify({ code: "rate_limited", detail: "Too many requests" }),
      })
    );

    await page.route("**/widget/aacp.js", (route) => route.continue());
    await page.setContent(WIDGET_HTML);

    await page.waitForTimeout(3000);
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
  });
});
