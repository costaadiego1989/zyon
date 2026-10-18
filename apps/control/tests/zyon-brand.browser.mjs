import { chromium } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";

const output = path.resolve("../../.audit/billing-promotions-preview");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "pt-BR" });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
let externalRequests = 0;
await page.route("**/*", async route => {
  const request = route.request(); const url = new URL(request.url());
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) { externalRequests++; return route.abort(); }
  if (url.pathname.startsWith("/v1")) {
    if (url.pathname.endsWith("/auth/me")) return route.fulfill({ status: 200, json: { id: "merchant-preview", name: "Loja demonstrativa", email: "preview@example.test", phone: "", role: "OWNER", plan: "BOTH" } });
    if (url.pathname.includes("/billing/") || url.pathname.endsWith("/billing")) return route.fulfill({ status: 200, json: { status: "active", plan: "growth", planKey: "growth", subscription: { status: "active", planKey: "growth" } } });
    return route.fulfill({ status: 503, json: { message: "Fonte fora da prévia local" } });
  }
  return route.continue();
});
await page.goto("http://127.0.0.1:5180/e2e/fixtures/zyon-brand-preview.html");
const logo = page.locator('.merchant-console aside img[src="/zyon-z.png"]');
await logo.waitFor();
await page.getByRole("heading", { name: "Minha conta", exact: true }).waitFor();
await page.getByLabel("Nome completo", { exact: true }).waitFor();
await logo.evaluate(image => image.decode());
assert.ok(await logo.evaluate(image => image.naturalWidth > 0 && image.naturalHeight > 0));
assert.equal(await logo.getAttribute("alt"), "Zyon");
await page.evaluate(() => {
  const marker = document.createElement("div"); marker.textContent = "PRÉVIA LOCAL · DADOS DEMONSTRATIVOS";
  marker.style.cssText = "position:fixed;right:12px;bottom:12px;background:#fff;color:#17251d;padding:8px;border:1px solid #aaa;font:10px Arial;z-index:50";
  document.body.append(marker);
});
await page.screenshot({ path: path.join(output, "dashboard-logo-desktop.png") });
await page.goto("http://127.0.0.1:5176/");
await page.locator(".control-brand img").evaluate(image => image.decode());
assert.equal(await page.locator(".control-brand img").getAttribute("src"), "/zyon-z.png");
await page.screenshot({ path: path.join(output, "admin-login-logo.png") });
assert.deepEqual(errors, []);
await browser.close();
console.log(JSON.stringify({ passed: ["dashboard-real-component-logo", "asset-decodes", "accessible-brand", "admin-login-logo", "no-page-errors"], providerWrites: 0, blockedExternalRequests: externalRequests, proof: "local_fixture_only" }));
