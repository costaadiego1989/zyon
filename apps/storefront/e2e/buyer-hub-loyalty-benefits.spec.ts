import { test, expect, type Page } from '@playwright/test';

/**
 * Buyer Hub -> Loyalty tab benefits sections.
 *
 * A logged-in buyer opens the "Fidelidade" tab and sees the three benefits
 * sections (disponíveis / conquistados / progresso) populated from a mocked
 * GET /buyer/me/benefits response.
 *
 * Auth is client-gated: the http layer (src/lib/services/http.ts) reads the JWT
 * from localStorage["zyon_buyer_token"], decodes its payload for exp/sub, and
 * attaches it as a Bearer token. The signature is never verified in the browser
 * (only server-side, which we mock here), so a syntactically valid unexpired
 * token is enough to satisfy getValidBuyer().
 */

const STORE_SLUG = 'demo';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3009';
const GLOBAL_USER_ID = 'gu_e2e_loyalty_buyer';

// base64url encode a UTF-8 string (browser-agnostic, done in Node here).
function b64url(input: string): string {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Build an unexpired unsigned-payload JWT the client will accept.
function makeBuyerJwt(globalUserId: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = Math.floor(Date.now() / 1000) + 60 * 60; // +1h
  const payload = b64url(
    JSON.stringify({ sub: globalUserId, email: 'e2e-buyer@example.com', exp }),
  );
  return `${header}.${payload}.e2e-signature`;
}

const BENEFITS_FIXTURE = {
  available: [
    {
      id: 'ben_avail_1',
      name: 'Cupom de boas-vindas',
      description: '10% de desconto na próxima compra acima de R$ 200.',
      condition: 'Válido para pedidos acima de R$ 200',
    },
    {
      id: 'ben_avail_2',
      name: 'Frete grátis regional',
      description: 'Frete grátis para a sua região.',
      condition: 'Entrega na região Sudeste',
    },
  ],
  earned: [
    {
      id: 'ben_earned_1',
      name: 'Cliente Ouro',
      description: 'Benefício de fidelidade desbloqueado.',
      origin: 'Histórico de compras',
    },
  ],
  progress: [
    {
      id: 'ben_prog_1',
      name: 'Cliente Diamante',
      description: 'Gaste mais para desbloquear o próximo nível.',
      current_value: 600,
      target_value: 1000,
      remaining_value: 400,
    },
  ],
};

async function seedBuyerSession(page: Page): Promise<void> {
  const token = makeBuyerJwt(GLOBAL_USER_ID);
  await page.addInitScript(
    ([tkn, gid]) => {
      try {
        localStorage.setItem('zyon_buyer_token', tkn);
        localStorage.setItem(
          'zyon_buyer_session',
          JSON.stringify({ globalUserId: gid, token: tkn, email: 'e2e-buyer@example.com' }),
        );
      } catch {
        /* storage may be unavailable in some contexts */
      }
    },
    [token, GLOBAL_USER_ID] as const,
  );
}

// Fulfil the benefits endpoint (query string tolerant) with the fixture,
// and stub the sibling loyalty calls so the Loyalty tab does not render its
// empty state or spin on unrelated network failures.
async function mockBuyerApis(page: Page): Promise<void> {
  await page.route('**/buyer/me/benefits**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(BENEFITS_FIXTURE),
    });
  });

  await page.route('**/buyer/me/loyalty**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total_orders: 4,
        total_spent_cents: 60000,
        avg_order_value_cents: 15000,
        top_categories: ['Eletrônicos'],
        preferred_brands: ['Athom'],
        discount_sensitivity: 'medium',
        last_purchase_at: null,
      }),
    });
  });

  await page.route('**/buyer/me/summary**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        orders_count: 4,
        total_spent: 600,
        average_ticket: 150,
        currency: 'BRL',
      }),
    });
  });
}

async function openLoyaltyTab(page: Page): Promise<void> {
  await page.goto(`/store/${STORE_SLUG}`);

  // Enter chat mode so the full header (with the account trigger) renders.
  await page.locator('button', { hasText: 'Por chat' }).click();

  const trigger = page.locator('button[aria-label="Abrir conta"]');
  await expect(trigger).toBeVisible({ timeout: 10000 });
  await trigger.click();

  // With a valid token seeded, the panel skips the login form and shows tabs.
  const loyaltyTab = page.locator('button[role="tab"][title="Fidelidade"]');
  await expect(loyaltyTab).toBeVisible({ timeout: 10000 });
  await loyaltyTab.click();
}

test.describe('Buyer Hub - Loyalty benefits', () => {
  test.beforeEach(async ({ page }) => {
    await seedBuyerSession(page);
    await mockBuyerApis(page);
  });

  test('renders the three benefits sections populated from GET /buyer/me/benefits', async ({
    page,
  }) => {
    let benefitsRequested = false;
    page.on('request', (req) => {
      if (req.url().includes('/buyer/me/benefits')) benefitsRequested = true;
    });

    await openLoyaltyTab(page);

    const available = page.locator('[role="list"][aria-label="Descontos disponíveis para você"]');
    const earned = page.locator('[role="list"][aria-label="Benefícios conquistados"]');
    const progress = page.locator('[role="list"][aria-label="Progresso de benefícios"]');

    // Section containers are present.
    await expect(available).toBeVisible({ timeout: 10000 });
    await expect(earned).toBeVisible();
    await expect(progress).toBeVisible();

    // The mocked endpoint was actually consumed.
    expect(benefitsRequested).toBe(true);

    // Each section is populated with the fixture rows.
    await expect(available.getByRole('listitem')).toHaveCount(2);
    await expect(earned.getByRole('listitem')).toHaveCount(1);
    await expect(progress.getByRole('listitem')).toHaveCount(1);
  });

  test('shows benefit content and progress bar values', async ({ page }) => {
    await openLoyaltyTab(page);

    // Available benefit copy.
    await expect(page.getByText('Cupom de boas-vindas')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Válido para pedidos acima de R$ 200')).toBeVisible();

    // Earned benefit copy + origin.
    await expect(page.getByText('Cliente Ouro')).toBeVisible();
    await expect(page.getByText('Histórico de compras')).toBeVisible();

    // Progress section: 600/1000 -> 60% progressbar.
    const bar = page.getByRole('progressbar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('aria-valuenow', '60');
  });
});
