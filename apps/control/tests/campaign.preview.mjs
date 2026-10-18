import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

// Local website with an explicit public-API fixture. No provider/deployment proof.
const root = path.resolve("../../../AACP-blackfriday-web-20261015/apps/web");
const output = path.resolve("../../.audit/billing-promotions-production-20261015/evidence"); await mkdir(output, { recursive: true });
const campaign = { code: "BLACKFRIDAY", name: "Black Friday", plans: ["starter179", "growth", "scale"], discountType: "percent", discountValue: 5000, duration: "repeating", durationMonths: 3, startsAt: "2026-10-01T03:00:00Z", expiresAt: "2026-12-01T03:00:00Z", firstTimeOnly: false };
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const filename = path.resolve(root, "." + new URL(req.url, "http://localhost").pathname.replace(/\/$/, "/index.html"));
  if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try { const data = await readFile(filename); res.writeHead(200, { "Content-Type": mime[path.extname(filename)] ?? "application/octet-stream" }).end(data); } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }); const checks = [];
try {
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
    await context.route("**/v1/billing/promotions/automatic", route => route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ campaigns: [campaign] }) }));
    const page = await context.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin, { waitUntil: "networkidle" }); await page.locator(".subscription-promo-top").waitFor(); await page.waitForTimeout(3500);
    assert.equal(await page.locator("[data-subscription-campaign-link]").count(), 2);
    assert.ok((await page.locator("[data-subscription-campaign-link]").first().getAttribute("href")).includes("mode=signup&plan=starter179&cycle=monthly"));
    assert.equal(await page.locator("[data-copy-subscription-coupon]").count(), 0);
    await page.screenshot({ path: path.join(output, `blackfriday-site-topo-${name}-automatico.png`) });
    await page.locator(".subscription-promo-offer").scrollIntoViewIfNeeded(); await page.waitForTimeout(1000);
    await page.locator(".subscription-promo-offer").evaluate(element => window.scrollTo({ top: scrollY + element.getBoundingClientRect().top - 200, behavior: "instant" }));
    assert.equal(await page.locator("[data-subscription-coupon-expiry]").innerText(), "30/11/2026");
    await page.screenshot({ path: path.join(output, `blackfriday-site-planos-${name}-automatico.png`) });
    if (name === "desktop") await page.locator(".subscription-promo-offer").screenshot({ path: path.join(output, "blackfriday-site-oferta-automatica.png") });
    assert.ok((await page.locator('[data-offer="starter179"] .subscription-plan-discount').innerText()).includes("89,50"));
    const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, headerTop: document.querySelector(".topbar").getBoundingClientRect().top, promoBottom: document.querySelector(".subscription-promo-top").getBoundingClientRect().bottom }));
    assert.equal(layout.overflow, false); assert.ok(layout.headerTop >= layout.promoBottom - 1);
    const broken = await page.locator("img[src]").evaluateAll(images => images.filter(image => image.complete && !image.naturalWidth).map(image => image.getAttribute("src"))); assert.deepEqual(broken, []); assert.deepEqual(errors, []);
    checks.push({ viewport: name, noCodeEntry: true, signupLink: true, promotionalPrice: true, noOverflow: true, noBrokenImages: true }); await context.close();
  }
  for (const state of ["expired", "disabled", "scheduled", "unavailable", "specific", "fixed"]) {
    const context = await browser.newContext(); const page = await context.newPage();
    const value = { ...campaign, ...(state === "expired" ? { expiresAt: "2020-01-01T00:00:00Z" } : state === "scheduled" ? { startsAt: "2099-01-01T00:00:00Z" } : state === "specific" ? { plans: ["growth"] } : state === "fixed" ? { discountType: "fixed", discountValue: 2000 } : {}) };
    await page.route("**/v1/billing/promotions/automatic", route => route.fulfill({ status: state === "unavailable" ? 503 : 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ campaigns: state === "disabled" ? [] : [value] }) }));
    await page.goto(origin, { waitUntil: "networkidle" });
    assert.equal(await page.locator(".subscription-promo-top").isVisible(), ["specific", "fixed"].includes(state));
    if (state === "specific") { assert.equal(await page.locator('[data-offer="starter179"] .subscription-plan-discount').isVisible(), false); assert.equal(await page.locator('[data-offer="growth"] .subscription-plan-discount').isVisible(), true); }
    if (state === "fixed") assert.ok((await page.locator('[data-offer="starter179"] .subscription-plan-discount').innerText()).includes("159,00"));
    checks.push({ state, passed: true }); await context.close();
  }
  await writeFile(path.join(output, "campaign-preview.json"), JSON.stringify({ proof: "local_fixture_not_published", checks }, null, 2)); console.log(JSON.stringify(checks));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
