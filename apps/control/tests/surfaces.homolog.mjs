import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";

const output = path.resolve("../../.audit/billing-promotions-homolog"); await mkdir(output, { recursive: true });
const approvedLogo = await readFile("../dashboard/public/zyon-z.png");
const dashboard = "https://dashboard-sandbox-59d9.up.railway.app";
const logo = await fetch(`${dashboard}/zyon-z.png`); assert.equal(logo.status, 200);
const bytes = Buffer.from(await logo.arrayBuffer()); assert.ok(bytes.equals(approvedLogo));
const html = await (await fetch(dashboard)).text();
const script = html.match(/src="([^"]+\.js)"/)?.[1]; assert.ok(script);
const bundle = await (await fetch(dashboard + script)).text();
assert.ok(bundle.includes("https://api-sandbox-8146.up.railway.app"));
assert.ok(bundle.includes("/zyon-z.png"));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "pt-BR" });
const page = await context.newPage(); const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
await page.goto(dashboard, { waitUntil: "domcontentloaded" });
await page.getByText("Comece no Free por 7 dias.", { exact: true }).waitFor();
assert.ok(!(await page.locator("body").innerText()).includes("14 dias"));
await page.screenshot({ path: path.join(output, "dashboard-homolog-cadastro.png"), timeout: 10000 });
await page.goto(`${dashboard}/?mode=login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').first().waitFor();
await page.screenshot({ path: path.join(output, "dashboard-homolog-acesso.png") });
const cli = path.join(process.env.APPDATA, "npm/node_modules/vercel/dist/index.js");
const issued = spawnSync(process.execPath, [cli, "project", "token", "zyon-control", "--scope", "diegos-projects-b6fd2a25"], { encoding: "utf8" });
const token = issued.stdout.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0]; assert.ok(token);
const admin = "https://zyon-control-84mfslcp8-diegos-projects-b6fd2a25.vercel.app";
await page.route(`${admin}/**`, route => route.continue({ headers: { ...route.request().headers(), "x-vercel-trusted-oidc-idp-token": token } }));
await page.goto(admin); await page.getByRole("heading", { name: "Entrar no Control", exact: true }).waitFor();
await page.locator(".control-mark").evaluate(image => image.decode());
const adminLogo = await page.request.get(`${admin}/zyon-z.png`, { headers: { "x-vercel-trusted-oidc-idp-token": token } });
assert.ok((await adminLogo.body()).equals(approvedLogo));
await page.screenshot({ path: path.join(output, "admin-homolog-acesso.png") });
assert.deepEqual(errors, []); await browser.close();
const result = { proof: "deployed_static_assets_and_public_login_pages", dashboard, admin,
  logoSha256: createHash("sha256").update(bytes).digest("hex"), dashboardBundle: script,
  sandboxApiEmbedded: true, freeTrialDays: 7, dashboardLoginRendered: true, adminLoginRendered: true, logoMatchesApprovedAsset: true,
  merchantLoginTested: false };
await writeFile(path.join(output, "surfaces-result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: path.join(output, "surfaces-failure.png") }).catch(() => {});
  console.log(JSON.stringify({ surfaceErrors: errors, pageText: (await page.locator("body").innerText()).slice(0, 1200) }));
  throw error;
} finally { await browser.close(); }
