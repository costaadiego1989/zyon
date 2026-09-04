import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PulseAPI } from '../features/pulse/model/PulseAPI.js';

describe('PulseAPI.createOrder card', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('retorna clientSecret e stripePublishableKey do buyerFacing', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'pay_int_1',
        buyerFacing: {
          clientSecret: 'pi_test_secret_123',
          stripePublishableKey: 'pk_test_123',
        },
      }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const api = new PulseAPI({
      baseUrl: 'http://localhost:3009',
      merchantId: 'mrc_1',
      sessionToken: 'embed_token',
      sessionId: 'chk_1',
    });

    const order = await api.createOrder('card');

    expect(order).toEqual(expect.objectContaining({
      id: 'pay_int_1',
      clientSecret: 'pi_test_secret_123',
      stripePublishableKey: 'pk_test_123',
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3009/embed/payment/intents',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"method":"card"'),
      }),
    );
  });

  it('confirma pagamento Stripe no endpoint embed', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'approved', intent_id: 'pay_int_1' }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const api = new PulseAPI({
      baseUrl: 'http://localhost:3009',
      merchantId: 'mrc_1',
      sessionToken: 'embed_token',
      sessionId: 'chk_1',
    });

    await expect(api.confirmStripePayment('pay_int_1')).resolves.toEqual({ status: 'approved', intent_id: 'pay_int_1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3009/embed/payment/intents/pay_int_1/stripe/confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ session_id: 'chk_1' }),
      }),
    );
  });

  it('propaga erro user-friendly quando API falha no card', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => 'stripe_connect_not_active',
    })) as unknown as typeof fetch;

    const api = new PulseAPI({
      baseUrl: 'http://localhost:3009',
      merchantId: 'mrc_1',
      sessionToken: 'embed_token',
      sessionId: 'chk_1',
    });

    await expect(api.createOrder('card')).rejects.toThrow('stripe_connect_not_active');
  });
});
