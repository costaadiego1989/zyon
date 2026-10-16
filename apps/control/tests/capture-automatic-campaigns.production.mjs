import { chromium } from 'playwright';
import path from 'node:path';
const output = path.resolve('../../.audit/automatic-campaigns-release-20261016/evidence');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'pt-BR', reducedMotion: 'reduce' });
  await page.goto('https://www.zyon-payments.com.br');
  await page.locator('.subscription-promo-top:not([hidden])').waitFor();
  await page.locator('#planos').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(output, 'production-web-plans-final-1440.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-offer="starter179"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(output, 'production-web-starter-390.png') });
  console.log(JSON.stringify({ proof: 'read_only_screenshots_of_public_production_website', paymentExecuted: false }));
} finally { await browser.close(); }
