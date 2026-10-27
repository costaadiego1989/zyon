import { test, expect } from '@playwright/test';

const STORE_URL = 'http://localhost:3001/store/cosmos';

test.describe('Cosmos Store — Full Funnel Test', () => {
  test.setTimeout(180_000);

  test('Traverse funnel: conversation → cart → checkout → purchase', async ({ page }) => {
    const log: string[] = [];
    const stamp = (msg: string) => {
      const t = new Date().toISOString().split('T')[1].slice(0, 8);
      log.push(`[${t}] ${msg}`);
      console.log(`[${t}] ${msg}`);
    };

    // Track network requests to backend
    const apiCalls: { url: string; status?: number; body?: any }[] = [];
    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('localhost:3009') || url.includes('/api/')) {
        apiCalls.push({ url, status: res.status() });
      }
    });

    // === STAGE 1: Enter Store ===
    stamp('=== STAGE 1: Opening Cosmos store ===');
    const response = await page.goto(STORE_URL, { waitUntil: 'domcontentloaded' });
    stamp(`Store loaded: HTTP ${response?.status()}`);

    // Wait for page to render
    await page.waitForTimeout(5000);

    // Screenshot initial state
    await page.screenshot({ path: 'test-results/cosmos-01-landing.png', fullPage: true });
    stamp('Screenshot: landing page');

    // Check what we see
    const title = await page.title();
    stamp(`Page title: ${title}`);

    const bodyText = await page.locator('body').textContent();
    const hasStorefront = bodyText?.includes('cosmos') || bodyText?.includes('Cosmos') || false;
    stamp(`Has 'cosmos' in body: ${hasStorefront}`);

    // === STAGE 2: Find Chat Input ===
    stamp('=== STAGE 2: Looking for chat input ===');
    const inputSelectors = [
      'input[type="text"]',
      'input[placeholder*="mensagem"]',
      'input[placeholder*="Mensagem"]',
      'input[placeholder*="Escreva"]',
      'textarea',
    ];

    let chatInput: any = null;
    for (const sel of inputSelectors) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
        chatInput = loc;
        stamp(`Found input via: ${sel}`);
        break;
      }
    }

    if (!chatInput) {
      stamp('No chat input found — checking if intro/landing page');
      await page.screenshot({ path: 'test-results/cosmos-02-no-input.png', fullPage: true });

      // Look for "Por chat" or "iniciar conversa" buttons
      const introBtns = await page.locator('button, a').allTextContents();
      stamp(`Available buttons/links: ${introBtns.slice(0, 10).join(' | ')}`);

      const startBtn = page.locator('text=/(Por chat|Iniciar|Conversar|Comprar)/i').first();
      if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        stamp(`Clicking intro button: ${await startBtn.textContent()}`);
        await startBtn.click();
        await page.waitForTimeout(3000);

        for (const sel of inputSelectors) {
          const loc = page.locator(sel).first();
          if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
            chatInput = loc;
            stamp(`Found input after intro: ${sel}`);
            break;
          }
        }
      }
    }

    await page.screenshot({ path: 'test-results/cosmos-03-after-intro.png', fullPage: true });

    // === STAGE 3: Send first message (conversation_started) ===
    if (chatInput) {
      stamp('=== STAGE 3: Send first message ===');
      await chatInput.fill('Oi, quero ver produtos');
      await chatInput.press('Enter');
      stamp('Message sent, waiting for response');
      await page.waitForTimeout(15000); // LLM response

      await page.screenshot({ path: 'test-results/cosmos-04-conversation.png', fullPage: true });
    } else {
      stamp('SKIP STAGE 3: No chat input available');
    }

    // === STAGE 4: Ask for product recommendation ===
    if (chatInput) {
      stamp('=== STAGE 4: Ask for products ===');
      await chatInput.fill('Quero comprar um produto, o que você recomenda?');
      await chatInput.press('Enter');
      await page.waitForTimeout(20000);

      await page.screenshot({ path: 'test-results/cosmos-05-recommendation.png', fullPage: true });
    }

    // === STAGE 5: Try to add to cart ===
    if (chatInput) {
      stamp('=== STAGE 5: Try add to cart ===');
      await chatInput.fill('Adicione esse produto ao meu carrinho');
      await chatInput.press('Enter');
      await page.waitForTimeout(20000);

      await page.screenshot({ path: 'test-results/cosmos-06-add-cart.png', fullPage: true });

      // Check if cart appears
      const cartVisible = await page.locator('[class*="cart"], [data-testid="cart"]').first()
        .isVisible({ timeout: 2000 }).catch(() => false);
      stamp(`Cart UI visible: ${cartVisible}`);

      const fabVisible = await page.locator('[class*="fab"], [class*="Fab"]').first()
        .isVisible({ timeout: 2000 }).catch(() => false);
      stamp(`FAB visible: ${fabVisible}`);
    }

    // === STAGE 6: Open cart drawer ===
    stamp('=== STAGE 6: Look for cart drawer trigger ===');
    const cartTriggers = [
      'button:has-text("Carrinho")',
      'button:has-text("Cart")',
      '[class*="cart-button"]',
      '[data-testid="cart-button"]',
    ];

    let cartOpened = false;
    for (const sel of cartTriggers) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
        await loc.click();
        await page.waitForTimeout(2000);
        stamp(`Opened cart via: ${sel}`);
        cartOpened = true;
        break;
      }
    }

    await page.screenshot({ path: 'test-results/cosmos-07-cart-drawer.png', fullPage: true });

    // === STAGE 7: Try checkout ===
    stamp('=== STAGE 7: Try checkout ===');
    if (chatInput) {
      await chatInput.fill('Quero finalizar a compra');
      await chatInput.press('Enter');
      await page.waitForTimeout(20000);

      await page.screenshot({ path: 'test-results/cosmos-08-checkout.png', fullPage: true });
    }

    // === STAGE 8: Check for payment/checkout flow ===
    stamp('=== STAGE 8: Look for payment UI ===');
    const paymentSignals = [
      'input[name="cardNumber"]',
      'input[placeholder*="CEP"]',
      'text=/Finalizar|Pagar|Checkout/i',
      '[class*="checkout"]',
    ];

    for (const sel of paymentSignals) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
        const txt = await loc.textContent().catch(() => 'unknown');
        stamp(`Found checkout signal: ${sel} → ${txt?.slice(0, 30)}`);
        break;
      }
    }

    await page.screenshot({ path: 'test-results/cosmos-09-final.png', fullPage: true });

    // === SUMMARY ===
    stamp('=== SUMMARY ===');
    stamp(`Total API calls captured: ${apiCalls.length}`);
    const uniqueUrls = [...new Set(apiCalls.map(c => c.url.replace(/^https?:\/\/[^/]+/, '')))];
    stamp(`Unique API endpoints hit: ${uniqueUrls.length}`);
    uniqueUrls.forEach(u => stamp(`  → ${u}`));

    const errors = apiCalls.filter(c => c.status && c.status >= 400);
    stamp(`API errors (4xx/5xx): ${errors.length}`);
    errors.forEach(e => stamp(`  ❌ ${e.status} ${e.url}`));

    // Log network events for analysis
    console.log('\n\n=== FULL LOG ===\n' + log.join('\n'));
  });
});
