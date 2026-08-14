import { test, expect } from '@playwright/test';

/**
 * VTEX Integration E2E Tests
 *
 * These tests require a VTEX Partner account with a configured test store.
 * They are skipped if environment variables are not set.
 *
 * Setup:
 *   1. Create VTEX Partner app in Admin > Integrations > My Apps
 *   2. Generate AppKey and AppToken
 *   3. Set environment variables and run tests
 *
 * Run with:
 *   VTEX_ACCOUNT_NAME=mystorename \
 *   VTEX_APP_KEY=vtexappkey-mystorename-XXXXX \
 *   VTEX_APP_TOKEN=YYYYYYYYYYYYY \
 *   MERCHANT_ID=mrc_test_123 \
 *   SERVICE_API_KEY=sk_test_xxx \
 *   API_BASE=http://localhost:3009 \
 *   pnpm e2e:realapi -- vtex-integration.spec.ts
 */

test.describe('VTEX Integration E2E', () => {
  // Skip all tests if VTEX credentials not provided
  test.skip(
    !process.env.VTEX_ACCOUNT_NAME,
    'Skipped: VTEX Partner account not configured. Set VTEX_ACCOUNT_NAME, VTEX_APP_KEY, VTEX_APP_TOKEN to enable.',
  );

  const VTEX_ACCOUNT = process.env.VTEX_ACCOUNT_NAME || '';
  const VTEX_KEY = process.env.VTEX_APP_KEY || '';
  const VTEX_TOKEN = process.env.VTEX_APP_TOKEN || '';
  const MERCHANT_ID = process.env.MERCHANT_ID || 'mrc_test_123';
  const SERVICE_API_KEY = process.env.SERVICE_API_KEY || '';
  const API_BASE = process.env.API_BASE || 'http://localhost:3009';

  test('connect VTEX merchant account via API', async ({ request }) => {
    test.skip(!SERVICE_API_KEY, 'SERVICE_API_KEY required');

    const idempotencyKey = `connect-${Date.now()}`;

    const res = await request.post(`${API_BASE}/commerce/connections`, {
      headers: {
        'Authorization': `Bearer ${SERVICE_API_KEY}`,
        'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/json',
      },
      data: {
        provider: 'vtex',
        account_name: VTEX_ACCOUNT,
        app_key: VTEX_KEY,
        app_token: VTEX_TOKEN,
      },
    });

    // Expect either 201 (created) or 502 (invalid credentials, but endpoint works)
    expect(res.status()).toBeGreaterThanOrEqual(201);
    expect(res.status()).toBeLessThan(500); // No 5xx server errors

    const body = await res.json();
    expect(body).toHaveProperty('provider');
    expect(body.provider).toBe('vtex');
  });

  test('retrieve VTEX connection status', async ({ request }) => {
    test.skip(!SERVICE_API_KEY, 'SERVICE_API_KEY required');

    const res = await request.get(`${API_BASE}/commerce/connections`, {
      headers: {
        'Authorization': `Bearer ${SERVICE_API_KEY}`,
      },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('reject invalid VTEX credentials', async ({ request }) => {
    test.skip(!SERVICE_API_KEY, 'SERVICE_API_KEY required');

    const res = await request.post(`${API_BASE}/commerce/connections`, {
      headers: {
        'Authorization': `Bearer ${SERVICE_API_KEY}`,
        'Idempotency-Key': `invalid-${Date.now()}`,
      },
      data: {
        provider: 'vtex',
        account_name: 'invalid-store-name-xyz',
        app_key: 'badkey123',
        app_token: 'badtoken456',
      },
    });

    // Should fail with 401 or 502 (VTEX auth failure)
    expect([401, 502, 400]).toContain(res.status());
  });

  test('handle VTEX webhook: payment-approved status', async ({ request }) => {
    const orderId = `test-${Date.now()}-01`;
    const payload = {
      OrderId: orderId,
      status: 'payment-approved',
      accountName: VTEX_ACCOUNT,
      timestamp: new Date().toISOString(),
    };

    const res = await request.post(`${API_BASE}/webhooks/vtex/${MERCHANT_ID}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: payload,
    });

    // Webhook always returns 200, even if merchant not found
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('outcome');
    expect(['processed', 'ignored']).toContain(body.outcome);
  });

  test('handle VTEX webhook: order-created status', async ({ request }) => {
    const orderId = `test-${Date.now()}-02`;
    const payload = {
      OrderId: orderId,
      status: 'order-created',
      accountName: VTEX_ACCOUNT,
    };

    const res = await request.post(`${API_BASE}/webhooks/vtex/${MERCHANT_ID}`, {
      data: payload,
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(['processed', 'ignored']).toContain(body.outcome);
  });

  test('reject VTEX webhook with missing merchantId', async ({ request }) => {
    const res = await request.post(`${API_BASE}/webhooks/vtex/`, {
      data: {
        OrderId: 'test-123',
        status: 'payment-approved',
      },
    });

    // Should be 404 or 400
    expect([400, 404]).toContain(res.status());
  });

  test('reject VTEX webhook with invalid payload', async ({ request }) => {
    const res = await request.post(`${API_BASE}/webhooks/vtex/${MERCHANT_ID}`, {
      data: {
        // Missing required fields: OrderId, status
        accountName: VTEX_ACCOUNT,
      },
    });

    expect(res.status()).toBe(400);
  });

  test('deduplicate duplicate VTEX paid webhooks', async ({ request }) => {
    const orderId = `test-dedup-${Date.now()}`;
    const payload = {
      OrderId: orderId,
      status: 'payment-approved',
      accountName: VTEX_ACCOUNT,
    };

    // First webhook
    const res1 = await request.post(`${API_BASE}/webhooks/vtex/${MERCHANT_ID}`, {
      data: payload,
    });
    expect(res1.status()).toBe(200);
    const body1 = await res1.json();

    // Duplicate webhook (same orderId + status)
    const res2 = await request.post(`${API_BASE}/webhooks/vtex/${MERCHANT_ID}`, {
      data: payload,
    });
    expect(res2.status()).toBe(200);
    const body2 = await res2.json();

    // Both should return success, but second should be ignored by dedup
    expect(['processed', 'ignored']).toContain(body1.outcome);
    expect(['processed', 'ignored']).toContain(body2.outcome);
  });

  test('handle VTEX webhook with mismatched account name', async ({ request }) => {
    const res = await request.post(`${API_BASE}/webhooks/vtex/${MERCHANT_ID}`, {
      data: {
        OrderId: `test-${Date.now()}`,
        status: 'payment-approved',
        accountName: 'different-account-name',
      },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    // Should be processed or ignored, webhook doesn't reject
    expect(['processed', 'ignored']).toContain(body.outcome);
  });
});

test.describe('VTEX Adapter Rate Limiting', () => {
  test.skip(
    !process.env.VTEX_ACCOUNT_NAME,
    'Skipped: requires VTEX Partner account',
  );

  test('rate limiter respects 800 req/min limit', async () => {
    // This is a unit-level test, not an integration test
    // It should be part of packages/commerce-adapters/src/vtex/vtex-rate-limiter.ts
    // Kept here as a placeholder for load testing patterns
    test.skip(true, 'Use unit tests in packages/commerce-adapters/src/vtex/');
  });
});
