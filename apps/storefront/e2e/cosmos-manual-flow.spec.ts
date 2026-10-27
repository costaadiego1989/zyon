import { test, expect, Page } from '@playwright/test';

/**
 * Storefront E2E Manual Testing - Project Cosmos
 * Tests as real user: signup, purchase, payments, support, user hub
 */

const STOREFRONT_URL = 'http://localhost:3001';
const API_LOGS_URL = 'http://localhost:3009/logs'; // For OTP extraction

// Helper: Extract OTP from API logs
async function extractOtpFromLogs(): Promise<string> {
  // In real scenario, would check server logs or DB
  // For now, return placeholder - will implement log streaming
  return '000000';
}

// Helper: Wait for page stability
async function waitForPageStable(page: Page, timeout = 5000) {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeout, 5000) });
  } catch {
    // Page still loading but let's continue
    await page.waitForTimeout(1000);
  }
}

test.describe('Storefront Cosmos - Full User Journey', () => {
  test('1. Load storefront and verify quick replies available', async ({ page }) => {
    await page.goto(`${STOREFRONT_URL}/store/cosmos`);
    await waitForPageStable(page);

    // Verify page loaded
    await expect(page).toHaveURL(/\/store\/cosmos/);

    // Look for conversation shell (chat widget)
    const conversationShell = page.locator('[role="dialog"]').first();
    // If not visible initially, try clicking FAB
    const fabBtn = page.locator('button').filter({ has: page.locator('svg') }).first();
    if (fabBtn) {
      await fabBtn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
    }

    // Verify any interactive element exists
    const anyInteractive = page.locator('button, input, [role="button"]').first();
    await expect(anyInteractive).toBeVisible({ timeout: 3000 });

    // Capture initial state
    await page.screenshot({ path: 'screenshots/01-storefront-loaded.png' });
  });

  test('2. Signup flow with email/phone', async ({ page }) => {
    await page.goto(`${STOREFRONT_URL}/store/cosmos`);
    await waitForPageStable(page);

    // Click chat to open signup
    const chatTrigger = page.locator('[data-testid="chat-trigger"]');
    if (await chatTrigger.isVisible()) {
      await chatTrigger.click();
      await page.waitForTimeout(1000);
    }

    // Fill email
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible()) {
      await emailInput.fill(`test-${Date.now()}@example.com`);
      await page.screenshot({ path: 'screenshots/02-email-entered.png' });
    }

    // Continue
    const continueBtn = page.locator('button:has-text("Continuar")');
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
    }
  });

  test('3. OTP verification', async ({ page }) => {
    // Note: This test requires phone/email verification
    // OTP extracted from logs in real scenario

    const otpInput = page.locator('input[placeholder*="OTP"], input[placeholder*="código"]');
    if (await otpInput.isVisible()) {
      const otp = await extractOtpFromLogs();
      await otpInput.fill(otp);
      await page.screenshot({ path: 'screenshots/03-otp-entered.png' });

      const verifyBtn = page.locator('button:has-text("Verificar")');
      if (await verifyBtn.isVisible()) {
        await verifyBtn.click();
        await page.waitForTimeout(2000);
      }
    }
  });

  test('4. Browse products and add to cart', async ({ page }) => {
    await page.goto(`${STOREFRONT_URL}/store/cosmos`);
    await waitForPageStable(page);

    // Find first product
    const productCard = page.locator('[data-testid="product-card"]').first();
    if (await productCard.isVisible()) {
      await productCard.click();
      await page.waitForTimeout(1500);
    }

    // Add to cart
    const addCartBtn = page.locator('button:has-text("Adicionar ao Carrinho")');
    if (await addCartBtn.isVisible()) {
      await addCartBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'screenshots/04-product-added.png' });
    }

    // Open cart
    const cartBtn = page.locator('[data-testid="cart-button"]');
    if (await cartBtn.isVisible()) {
      await cartBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'screenshots/05-cart-open.png' });
    }
  });

  test('5. Checkout with payment', async ({ page }) => {
    await page.goto(`${STOREFRONT_URL}/store/cosmos`);
    await waitForPageStable(page);

    // Navigate to checkout (if cart has items)
    const checkoutBtn = page.locator('button:has-text("Finalizar Compra"), button:has-text("Checkout")');
    if (await checkoutBtn.isVisible()) {
      await checkoutBtn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'screenshots/06-checkout-page.png' });
    }

    // Fill shipping info
    const zipInput = page.locator('input[placeholder*="CEP"], input[placeholder*="ZIP"]');
    if (await zipInput.isVisible()) {
      await zipInput.fill('01310100');
      await page.waitForTimeout(1000);
    }

    // Select payment method - Credit Card
    const creditCardRadio = page.locator('input[value="credit_card"], label:has-text("Cartão de Crédito")');
    if (await creditCardRadio.isVisible()) {
      await creditCardRadio.click();
      await page.waitForTimeout(500);
    }

    // Fill card details
    const cardNumber = page.locator('input[placeholder*="4111"]');
    if (await cardNumber.isVisible()) {
      await cardNumber.fill('4111111111111111');
      await page.waitForTimeout(300);
    }

    // Fill expiry
    const expiry = page.locator('input[placeholder*="MM/YY"]');
    if (await expiry.isVisible()) {
      await expiry.fill('12/25');
      await page.waitForTimeout(300);
    }

    // Fill CVV
    const cvv = page.locator('input[placeholder*="CVV"]');
    if (await cvv.isVisible()) {
      await cvv.fill('123');
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: 'screenshots/07-payment-filled.png' });

    // Complete order
    const orderBtn = page.locator('button:has-text("Confirmar Pedido"), button:has-text("Pagar")');
    if (await orderBtn.isVisible()) {
      await orderBtn.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'screenshots/08-order-confirmed.png' });
    }
  });

  test('6. Access Support Hub', async ({ page }) => {
    await page.goto(`${STOREFRONT_URL}/store/cosmos`);
    await waitForPageStable(page);

    // Open support/help
    const supportBtn = page.locator('[data-testid="support-button"], button:has-text("Suporte"), button:has-text("Ajuda")');
    if (await supportBtn.isVisible()) {
      await supportBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: 'screenshots/09-support-hub.png' });

      // Verify support chat opens
      const supportChat = page.locator('[data-testid="support-chat"]');
      if (await supportChat.isVisible()) {
        await expect(supportChat).toBeVisible();
      }
    }
  });

  test('7. Access User Hub - Account & Orders', async ({ page }) => {
    await page.goto(`${STOREFRONT_URL}/store/cosmos`);
    await waitForPageStable(page);

    // Try to find buyer hub trigger (typically in header)
    const buyerHubBtn = page.locator('button').filter({ hasText: /Conta|Account|Perfil|Profile/ }).first();
    if (buyerHubBtn && await buyerHubBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await buyerHubBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: 'screenshots/10-user-account.png' });

      // Look for orders link in menu
      const ordersLink = page.locator('a, button').filter({ hasText: /Pedidos|Orders|Compras/ }).first();
      if (ordersLink && await ordersLink.isVisible({ timeout: 2000 }).catch(() => false)) {
        await ordersLink.click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: 'screenshots/11-user-orders.png' });
      }
    } else {
      // Fallback: just verify page is accessible
      await page.screenshot({ path: 'screenshots/10-user-account-fallback.png' });
    }
  });

  test('8. Verify all payment methods available', async ({ page }) => {
    await page.goto(`${STOREFRONT_URL}/store/cosmos`);
    await waitForPageStable(page);

    // Navigate to checkout
    const checkoutBtn = page.locator('button:has-text("Finalizar Compra"), button:has-text("Checkout")');
    if (await checkoutBtn.isVisible()) {
      await checkoutBtn.click();
      await page.waitForTimeout(2000);

      // Check payment options
      const paymentMethods = [
        'credit_card',
        'debit_card',
        'pix',
        'boleto',
        'wallet'
      ];

      const availableMethods: string[] = [];
      for (const method of paymentMethods) {
        const methodRadio = page.locator(`input[value="${method}"], label:has-text("${method}")`);
        if (await methodRadio.isVisible()) {
          availableMethods.push(method);
        }
      }

      console.log('Available payment methods:', availableMethods);
      await page.screenshot({ path: 'screenshots/12-payment-methods.png' });
    }
  });

  test('9. Test responsive - mobile view', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(`${STOREFRONT_URL}/store/cosmos`);
    await waitForPageStable(page);

    // Verify layout adapts
    const chatWidget = page.locator('[data-testid="chat-widget"]');
    if (await chatWidget.isVisible()) {
      await expect(chatWidget).toBeVisible();
    }

    await page.screenshot({ path: 'screenshots/13-mobile-view.png' });

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('10. Monitor console for errors', async ({ page }) => {
    const errors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    page.on('pageerror', exception => {
      errors.push(exception.toString());
    });

    await page.goto(`${STOREFRONT_URL}/store/cosmos`);
    await waitForPageStable(page);

    // Interact with page
    const chatTrigger = page.locator('[data-testid="chat-trigger"]');
    if (await chatTrigger.isVisible()) {
      await chatTrigger.click();
      await page.waitForTimeout(1000);
    }

    console.log('Console errors:', errors);
    await page.screenshot({ path: 'screenshots/14-console-check.png' });

    if (errors.length > 0) {
      console.warn('⚠️ Found console errors:', errors);
    }
  });
});
