import { test } from "@playwright/test";

// Probe: what does GET /orders return for the dashboard cookie session?
test("@rtp orders endpoint from dashboard session", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("nav").first().waitFor({ state: "visible", timeout: 15_000 });

  const out = await page.evaluate(async () => {
    const API = "http://127.0.0.1:3009";
    async function probe(path: string) {
      try {
        const r = await fetch(`${API}${path}`, { credentials: "include" });
        const t = await r.text();
        return { path, status: r.status, len: t.length, snippet: t.slice(0, 200) };
      } catch (e) { return { path, error: String(e) }; }
    }
    return {
      orders: await probe("/orders?limit=25"),
      ordersNoLimit: await probe("/orders"),
    };
  });
  console.log("RTP_ORDERS_PROBE_START" + JSON.stringify(out) + "RTP_ORDERS_PROBE_END");
});
