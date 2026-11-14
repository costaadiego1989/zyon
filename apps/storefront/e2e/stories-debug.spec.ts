import { test, expect } from '@playwright/test';

test('count story category buttons in DOM', async ({ page }) => {
  let storeUrl = 'http://localhost:3001/store/demo';
  try {
    const res = await page.request.get('http://localhost:3009/storefront/index');
    if (res.ok()) {
      const data = await res.json();
      if (data.stores?.[0]?.slug) storeUrl = `http://localhost:3001/store/${data.stores[0].slug}`;
    }
  } catch {}

  await page.goto(storeUrl);
  await page.waitForTimeout(2000);

  // Enter chat
  const chatBtn = page.locator('text=Por chat').first();
  if (await chatBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await chatBtn.click();
    await page.waitForTimeout(3000);
  }

  // Check for Stories text
  const storiesText = await page.locator('text=STORIES').count();
  console.log('STORIES text elements:', storiesText);

  // Check all buttons with aria-label containing "stories"
  const storyBtns = await page.locator('button[aria-label*="stories"]').count();
  console.log('Story buttons (aria-label):', storyBtns);

  // Check listitem buttons
  const listItems = await page.locator('[role="listitem"]').count();
  console.log('role=listitem elements:', listItems);

  // Get all text content in stories container area
  const allText = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Stories"]');
    return el ? { innerHTML: el.innerHTML.substring(0, 500), childCount: el.children.length } : null;
  });
  console.log('Stories container:', JSON.stringify(allText));

  expect(listItems).toBeGreaterThanOrEqual(2);
});
