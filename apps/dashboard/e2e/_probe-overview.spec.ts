import { test } from "@playwright/test";
import { gotoTab } from "./utils/nav";

test("@probe dump overview content", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("nav").first().waitFor({ state: "visible", timeout: 15_000 });
  await gotoTab(page, "Visão Geral");
  await page.waitForTimeout(2500);

  const info = await page.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    const h1 = Array.from(main.querySelectorAll("h1,h2,h3")).map((e) => (e.textContent || "").trim()).filter(Boolean).slice(0, 20);
    // uppercase metric labels
    const upper = Array.from(main.querySelectorAll("*"))
      .map((e) => (e.childElementCount === 0 ? (e.textContent || "").trim() : ""))
      .filter((t) => t && t === t.toUpperCase() && /[A-ZÀ-Ú]/.test(t) && t.length < 40)
      .slice(0, 40);
    const rMatch = (main.textContent || "").match(/R\$[\s ]?[\d.,]+/g) || [];
    return { headings: h1, upperLabels: Array.from(new Set(upper)), currencySamples: rMatch.slice(0, 10), bodyLen: (main.textContent || "").length };
  });
  console.log("OVW_START" + JSON.stringify(info) + "OVW_END");
});
