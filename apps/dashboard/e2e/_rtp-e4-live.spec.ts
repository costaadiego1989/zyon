import { test, expect } from "@playwright/test";
import { gotoTab } from "./utils/nav";

/**
 * RTP E4 — real browser navigation, real inspection.
 * Navigates the dashboard as a user, screenshots each tab, captures rendered
 * content + console/network errors for inspection.
 */

const TABS = [
  "Visão Geral",
  "Pedidos & Envios",
  "Clientes",
  "Produtos",
  "Cupons",
  "Estoque",
];

test("@rtp-e4 navigate dashboard tabs live", async ({ page }) => {
  const consoleErrors: string[] = [];
  const httpErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 140)); });
  page.on("response", (r) => { if (r.status() >= 400) httpErrors.push(`HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 90)}`); });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("nav").first().waitFor({ state: "visible", timeout: 15_000 });

  const perTab: Record<string, unknown> = {};

  for (const tab of TABS) {
    consoleErrors.length = 0;
    httpErrors.length = 0;
    await gotoTab(page, tab);
    await page.waitForTimeout(1800);

    const safe = tab.replace(/[^a-zA-Z0-9]/g, "-");
    await page.screenshot({ path: `test-results/rtp/${safe}.png`, fullPage: false });

    const snap = await page.evaluate(() => {
      const main = document.querySelector("main") || document.body;
      const text = (main.textContent || "").replace(/\s+/g, " ").trim();
      const headings = Array.from(main.querySelectorAll("h1,h2,h3")).map((e) => (e.textContent || "").trim()).filter(Boolean).slice(0, 8);
      const tables = main.querySelectorAll("table").length;
      const rows = main.querySelectorAll("table tbody tr, [role='row']").length;
      const emptyStateHit = /nenhum|vazio|sem dados|não há|no data|empty/i.test(text);
      const currency = (text.match(/R\$\s?[\d.,]+/g) || []).slice(0, 6);
      const btns = Array.from(main.querySelectorAll("button")).map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 12);
      return { headings, tables, rows, emptyStateHit, currency, buttonSample: btns, bodyLen: text.length };
    });

    perTab[tab] = { ...snap, consoleErrors: [...consoleErrors].slice(0, 5), httpErrors: [...httpErrors].slice(0, 5) };
  }

  console.log("RTP_E4_LIVE_START" + JSON.stringify(perTab) + "RTP_E4_LIVE_END");
});
