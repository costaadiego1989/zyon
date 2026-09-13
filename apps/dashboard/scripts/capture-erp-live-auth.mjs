import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const dashboardUrl = process.env.PLAYWRIGHT_BASE_URL ?? "https://app.zyon-payments.com.br";
const storagePath = resolve(process.env.ERP_LIVE_STORAGE_STATE ?? "e2e/.auth/erp-live-production.json");

await mkdir(dirname(storagePath), { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

console.log(`Open browser: authenticate at ${dashboardUrl}.`);
console.log("Complete CAPTCHA or two-factor verification in the visible browser. Credentials are never read from this script.");

try {
  await page.goto(dashboardUrl, { waitUntil: "domcontentloaded" });
  await page.locator("aside").first().waitFor({ state: "visible", timeout: 10 * 60_000 });
  await context.storageState({ path: storagePath });
  console.log(`Authenticated storage state saved to ${storagePath}`);
} finally {
  await browser.close();
}
