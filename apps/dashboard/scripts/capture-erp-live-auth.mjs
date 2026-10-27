import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const dashboardUrl = process.env.PLAYWRIGHT_BASE_URL ?? "https://app.zyon-payments.com.br";
const dashboardOrigin = new URL(dashboardUrl).origin;
const storagePath = resolve(process.env.ERP_LIVE_STORAGE_STATE ?? "e2e/.auth/erp-live-production.json");
const debugPort = Number(process.env.ERP_LIVE_CHROME_DEBUG_PORT ?? 9222);
const defaultProfilePath = resolve(process.env.LOCALAPPDATA ?? process.cwd(), "Zyon/erp-live-chrome");
const profilePath = resolve(process.env.ERP_LIVE_CHROME_PROFILE ?? defaultProfilePath);
const chromeExecutable = process.env.ERP_LIVE_CHROME_EXECUTABLE ?? [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
].find((candidate) => existsSync(candidate));

if (!chromeExecutable) {
  throw new Error("Google Chrome was not found. Set ERP_LIVE_CHROME_EXECUTABLE to its chrome.exe path.");
}

mkdirSync(dirname(storagePath), { recursive: true });
mkdirSync(profilePath, { recursive: true });

spawn(chromeExecutable, [
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profilePath}`,
  "--new-window",
  dashboardUrl,
], { detached: true, stdio: "ignore" }).unref();

console.log(`Opened regular Google Chrome at ${dashboardUrl}.`);
console.log("Complete dashboard sign-in, CAPTCHA, or two-factor verification in that window. This script never controls the Google sign-in page.");

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const deadline = Date.now() + 10 * 60_000;
let browser;

while (Date.now() < deadline) {
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    break;
  } catch {
    await sleep(500);
  }
}

if (!browser) {
  throw new Error("Could not connect to the regular Chrome window within 10 minutes.");
}

const context = browser.contexts()[0];
let dashboardPage;

while (Date.now() < deadline) {
  dashboardPage = context.pages().find((page) => page.url().startsWith(dashboardOrigin));
  if (dashboardPage) break;
  await sleep(500);
}

if (!dashboardPage) {
  throw new Error("Dashboard was not reached after authentication.");
}

await dashboardPage.locator("aside").first().waitFor({ state: "visible", timeout: Math.max(1, deadline - Date.now()) });
await context.storageState({ path: storagePath });
console.log(`Authenticated storage state saved to ${storagePath}`);
console.log("Google Chrome remains open. You can close it when you are finished.");
