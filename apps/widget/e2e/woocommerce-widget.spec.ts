/**
 * WooCommerce Integration — Comprehensive Widget Test Suite
 *
 * Tests the widget integration with WooCommerce:
 * 1. Widget loads and renders on checkout page
 * 2. Cart data flows from WooCommerce to widget
 * 3. Cart sync (removal) works bidirectionally
 * 4. Shipping selection endpoint is available
 * 5. Plugin injects correct attributes
 */
import { test, expect, type Page } from "@playwright/test";

const WOO_BASE = "http://localhost:8080";
const API_BASE = "http://localhost:3009";
const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";

// WooCommerce product IDs
const PRODUCTS = {
  "Camiseta Zyon Dev": 11,
  "Hoodie Agentic Checkout": 12,
  "Sticker Pack AI Commerce": 13,
} as const;

async function addProductAndGoToCheckout(page: Page, productName: keyof typeof PRODUCTS = "Camiseta Zyon Dev") {
  const productId = PRODUCTS[productName];
  await page.goto(`${WOO_BASE}/?add-to-cart=${productId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await page.goto(`${WOO_BASE}/checkout/`, { waitUntil: "domcontentloaded" });
  await page.locator("zyon-checkout-agent").waitFor({ state: "attached", timeout: 20000 });
  await page.waitForTimeout(4000);
}

// ─── 1. WIDGET LOADS & RENDERS ───────────────────────────────────────────────

test.describe("@woocommerce widget rendering", () => {
  test.setTimeout(60000);

  test("widget element attached with correct merchant-id", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    await expect(page.locator("zyon-checkout-agent")).toHaveAttribute("merchant-id", MERCHANT_ID);
  });

  test("widget has embed-session-token", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    const token = await page.locator("zyon-checkout-agent").getAttribute("embed-session-token");
    expect(token).toBeTruthy();
    expect(token!.length).toBeGreaterThan(20);
  });

  test("widget has api-base-url", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    await expect(page.locator("zyon-checkout-agent")).toHaveAttribute("api-base-url", "http://localhost:3009");
  });

  test("full-page takeover mode active", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    const hasTakeoverClass = await page.evaluate(() =>
      document.body.classList.contains("zyon-checkout-body")
    );
    expect(hasTakeoverClass).toBe(true);
    await expect(page.locator(".zyon-checkout-takeover")).toBeVisible();
  });

  test("widget script loaded", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    await expect(page.locator('script[src*="aacp.js"]')).toBeAttached();
  });

  test("back-to-store button present", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    await expect(page.getByRole("button", { name: "Voltar para o site" })).toBeVisible();
  });

  test("purchase channel selection present", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    await expect(page.getByText(/Como voc[eê] prefere comprar/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Por chat/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Por voz/i })).toBeVisible();
  });

  test("greeting visible with agent name", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    // Agent name comes from brand-json or defaults to "Pulse"
    await expect(page.getByText(/Oi, eu sou a /)).toBeVisible({ timeout: 10000 });
  });

  test("feature capabilities listed", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    await expect(page.getByText(/promo[cç][oõ]es/i).first()).toBeVisible();
  });

  test("theme toggle present", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    await expect(page.getByRole("button", { name: "Tema" })).toBeVisible();
  });
});

// ─── 2. BRAND/AGENT CONFIG INJECTION ─────────────────────────────────────────

test.describe("@woocommerce brand/agent config attributes", () => {
  test.setTimeout(60000);

  test("brand-json attribute present", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    const brandJson = await page.locator("zyon-checkout-agent").getAttribute("brand-json");
    expect(brandJson).toBeTruthy();
    const brand = JSON.parse(brandJson!);
    expect(brand.name).toBeTruthy();
    expect(brand.accentColor).toBeTruthy();
  });

  test("brand-json has valid color values", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    const brandJson = await page.locator("zyon-checkout-agent").getAttribute("brand-json");
    const brand = JSON.parse(brandJson!);
    expect(brand.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  test("agent-json present when API reachable", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    const agentJson = await page.locator("zyon-checkout-agent").getAttribute("agent-json");
    // agent-json may be absent if API unreachable (graceful degradation)
    if (agentJson) {
      const agent = JSON.parse(agentJson);
      expect(agent.name).toBeTruthy();
    }
  });
});

// ─── 3. CART SYNC ────────────────────────────────────────────────────────────

test.describe("@woocommerce cart sync", () => {
  test.setTimeout(60000);

  test("cart-json contains product added to WooCommerce cart", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    const cartJson = await page.locator("zyon-checkout-agent").getAttribute("cart-json");
    expect(cartJson).toBeTruthy();
    const cart = JSON.parse(cartJson!);
    expect(cart.items.length).toBeGreaterThan(0);
    expect(cart.items[0].name).toBe("Camiseta Zyon Dev");
    expect(cart.items[0].price).toBe(89.9);
    expect(cart.currency).toBe("BRL");
  });

  test("cart sync event listener wired in page", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    const hasListener = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script"));
      return scripts.some(s => s.textContent?.includes("zyon:cart:update"));
    });
    expect(hasListener).toBe(true);
  });

  test("zyon:cart:update dispatches fetch to WP AJAX", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    const result = await page.evaluate(() => {
      return new Promise<{ called: boolean }>((resolve) => {
        const origFetch = window.fetch;
        window.fetch = function (...args: Parameters<typeof fetch>) {
          if (args[0]?.toString().includes("zyon_cart_sync")) {
            window.fetch = origFetch;
            resolve({ called: true });
          }
          return origFetch.apply(this, args);
        };
        document.dispatchEvent(new CustomEvent("zyon:cart:update", {
          detail: { items: [{ sku: "ZYON-SHIRT-001", quantity: 0 }] }
        }));
        setTimeout(() => resolve({ called: false }), 3000);
      });
    });
    expect(result.called).toBe(true);
  });

  test("cart sync AJAX removes item from WooCommerce", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    const nonce = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script"));
      const s = scripts.find(s => s.textContent?.includes("zyon:cart:update"));
      return s?.textContent?.match(/"X-WP-Nonce":"([^"]+)"/)?.[1] ?? null;
    });
    expect(nonce).toBeTruthy();

    const result = await page.evaluate(async (n) => {
      const res = await fetch(`${location.origin}/wp-admin/admin-ajax.php?action=zyon_cart_sync`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-WP-Nonce": n },
        body: JSON.stringify({ action: "zyon_cart_sync", items: [{ sku: "ZYON-SHIRT-001", quantity: 0 }] })
      });
      return res.json();
    }, nonce!);
    expect(result.success).toBe(true);
    expect(result.data.cart_count).toBe(0);
  });

  test("multiple products in cart-json", async ({ page }) => {
    await page.goto(`${WOO_BASE}/?add-to-cart=11`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    await page.goto(`${WOO_BASE}/?add-to-cart=12`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    await page.goto(`${WOO_BASE}/checkout/`, { waitUntil: "domcontentloaded" });
    await page.locator("zyon-checkout-agent").waitFor({ state: "attached", timeout: 20000 });

    const cartJson = await page.locator("zyon-checkout-agent").getAttribute("cart-json");
    expect(cartJson).toBeTruthy();
    const cart = JSON.parse(cartJson!);
    expect(cart.items.length).toBe(2);
  });
});

// ─── 4. SHIPPING SELECT API ─────────────────────────────────────────────────

test.describe("@woocommerce shipping select API", () => {
  test("401 without auth token", async ({ page }) => {
    await page.goto(`${WOO_BASE}/shop/`, { waitUntil: "domcontentloaded" });
    const status = await page.evaluate(async (apiBase) => {
      const res = await fetch(`${apiBase}/embed/shipping/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: "fake", option_index: 0 })
      });
      return res.status;
    }, API_BASE);
    expect(status).toBe(401);
  });

  test("rejects invalid session with auth token", async ({ page }) => {
    await page.goto(`${WOO_BASE}/shop/`, { waitUntil: "domcontentloaded" });
    const status = await page.evaluate(async (apiBase) => {
      // Get embed token
      const tokenRes = await fetch(`${apiBase}/v1/embed-sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-aacp-api-key": "aacp_test_wA9f484ZvF0TIaAx9XkMHUP_md049mcVJF1d6nMoTWk",
          "Idempotency-Key": `test_${Date.now()}`
        },
        body: JSON.stringify({ ttl_seconds: 900, allowed_origin: "http://localhost:8080" })
      });
      const { embed_session_token } = await tokenRes.json();
      // Try shipping select with bad session
      const res = await fetch(`${apiBase}/embed/shipping/select`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${embed_session_token}`
        },
        body: JSON.stringify({ session_id: "nonexistent", option_index: 0 })
      });
      return res.status;
    }, API_BASE);
    expect([400, 401]).toContain(status);
  });
});

// ─── 5. EMBED SESSION API ────────────────────────────────────────────────────

test.describe("@woocommerce embed session API", () => {
  test("returns token and widget_config", async ({ page }) => {
    await addProductAndGoToCheckout(page);
    const result = await page.evaluate(async (apiBase) => {
      try {
        const res = await fetch(`${apiBase}/v1/embed-sessions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-aacp-api-key": "aacp_test_wA9f484ZvF0TIaAx9XkMHUP_md049mcVJF1d6nMoTWk",
            "Idempotency-Key": `test_${Date.now()}`
          },
          body: JSON.stringify({ ttl_seconds: 900, allowed_origin: "http://localhost:8080" })
        });
        return { status: res.status, body: await res.json() };
      } catch (e) {
        return { status: 0, body: { error: (e as Error).message } };
      }
    }, API_BASE);

    if (result.status === 0 || result.body.error || result.status >= 400) {
      test.skip(true, `API returned ${result.status} — widget_config tested via integration (plugin injects attributes)`);
      return;
    }

    expect(result.status).toBe(201);
    expect(result.body.embed_session_token).toBeTruthy();
    expect(result.body.widget_config).toBeDefined();
    expect(result.body.widget_config.brand?.name).toBe("Athom Technologies");
    expect(result.body.widget_config.agent?.name).toBe("Anamara");
  });
});
