import { test, expect } from "@playwright/test";

// RTP audit probe: load the live cosmos storefront, capture what renders.
const SF = "http://localhost:3001";

test("@rtp storefront cosmos renders", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedReqs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
  page.on("requestfailed", (r) => failedReqs.push(`${r.method()} ${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.status() >= 400) failedReqs.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });

  const resp = await page.goto(`${SF}/store/cosmos`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(3500);

  const info = await page.evaluate(() => {
    const txt = (document.body.textContent || "").replace(/\s+/g, " ").trim();
    const productCards = document.querySelectorAll("[data-testid*='product'], [class*='product'], a[href*='/store/']").length;
    const headings = Array.from(document.querySelectorAll("h1,h2,h3")).map((e) => (e.textContent || "").trim()).filter(Boolean).slice(0, 15);
    const imgs = document.querySelectorAll("img").length;
    const buttons = Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 20);
    const priceHits = (txt.match(/R\$\s?[\d.,]+/g) || []).slice(0, 12);
    return { bodyLen: txt.length, headings, productCards, imgs, buttons, priceHits, title: document.title };
  });

  console.log("SF_PROBE_START" + JSON.stringify({
    status: resp?.status(),
    ...info,
    consoleErrors: consoleErrors.slice(0, 12),
    failedReqs: failedReqs.slice(0, 12),
  }) + "SF_PROBE_END");

  expect(resp?.status(), "storefront should not 404/500").toBeLessThan(400);
});
