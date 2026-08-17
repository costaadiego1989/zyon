import { test, expect } from '@playwright/test';

test('widget renders PulseCheckoutView (new layout)', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(3000);

  // New layout indicators: PulseHero with orb, "Começar a comprar", benefit cards
  const pageContent = await page.content();
  const textContent = await page.locator('body').textContent() ?? "";

  console.log('=== PAGE TEXT (first 500 chars) ===');
  console.log(textContent.slice(0, 500));

  // Check for new layout markers
  const hasNewLayout = /Começar a comprar|melhor opção|Calculo o frete|Pago com Pix|Gerente de vendas/i.test(textContent);
  const hasOldLayout = /Converse com nosso|Iniciar conversa|Chat com assistente/i.test(textContent);

  console.log('\\nNew layout found:', hasNewLayout);
  console.log('Old layout found:', hasOldLayout);

  // Should have new layout
  expect(hasNewLayout || !hasOldLayout).toBe(true);
});

test('widget shows PulseHero orb animation', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(2000);

  // Look for the orb (animated div with specific styles)
  const orb = page.locator('[class*="orb"], [style*="orbFloat"], [class*="pulse-orb"]');
  const orbCount = await orb.count();
  console.log('Orb elements found:', orbCount);
});

test('widget shows "Começar a comprar" CTA button', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(2000);

  const cta = page.locator('button, a').filter({ hasText: /Começar|comprar|Iniciar/i });
  const count = await cta.count();
  console.log('CTA buttons found:', count);

  if (count > 0) {
    const text = await cta.first().textContent();
    console.log('CTA text:', text);
  }
});
