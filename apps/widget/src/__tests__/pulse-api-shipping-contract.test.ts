import { afterEach, describe, expect, it, vi } from 'vitest';
import { PulseAPI } from '../features/pulse/model/PulseAPI.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
const current = { carrier_key: 'own_delivery_neighborhood_centro', label: 'Entrega própria', price: 1375, eta_days: 2, is_free: false };

function fixture(payload: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = vi.fn(async (url, init) => { calls.push({ url: String(url), init }); return Response.json(payload, { status }); }) as typeof fetch;
  const api = new PulseAPI({ baseUrl: 'https://shipping.invalid', merchantId: 'synthetic', sessionId: 'owned-session',
    sessionToken: 'synthetic-token', allowDemoFallbacks: false });
  return { api, calls };
}

describe('Pulse shipping quote contract', () => {
  it('maps current whole-cent price and eta_days without changing embed scope or trusting customer prices', async () => {
    const f = fixture({ results: [current] });
    const options = await f.api.getShipping({ cep: '01001-000', number: '9', complement: '' });
    expect(options).toHaveLength(1); expect(options[0]).toMatchObject({ key: current.carrier_key, label: current.label, cost: 13.75 });
    expect(options[0]!.sub).toContain('2'); expect(options[0]!.sub).not.toContain('confirmar');
    expect(f.calls).toHaveLength(1); expect(f.calls[0]!.url).toBe('https://shipping.invalid/embed/shipping/quote');
    expect(new Headers(f.calls[0]!.init?.headers).get('Authorization')).toBe('Bearer synthetic-token');
    expect(JSON.parse(String(f.calls[0]!.init?.body))).toEqual({ session_id: 'owned-session', destination_zip: '01001-000' });
  });

  it('keeps the explicit legacy cents/business-days and options envelope compatible', async () => {
    const f = fixture({ options: [{ carrier_key: 'legacy', label: 'Legacy', price_cents: 900, eta_business_days: 1 }] });
    expect((await f.api.getShipping())[0]).toMatchObject({ key: 'legacy', cost: 9, tag: 'Mais rápido' });
  });

  for (const row of [
    { ...current, price: 0, is_free: true },
    { carrier_key: 'legacy', price_cents: 0, delivery_days: 3 },
    { ...current, price_cents: 1375, eta_business_days: 2, delivery_days: 2 },
  ]) it(`accepts an explicit consistent price ${JSON.stringify(row)}`, async () => {
    const f = fixture({ results: [row] }); const options = await f.api.getShipping();
    expect(options).toHaveLength(1); expect(options[0]!.cost).toBe(('price' in row ? row.price : row.price_cents)! / 100);
  });

  for (const price of [undefined, null, '0', -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
    it(`never infers free delivery from invalid/missing price ${String(price)}`, async () => {
      const f = fixture({ results: [{ ...current, price }, { ...current, carrier_key: 'valid', price: 250 }] });
      const options = await f.api.getShipping();
      expect(options).toHaveLength(1); expect(options[0]).toMatchObject({ key: 'valid', cost: 2.5 });
    });
  }

  for (const row of [
    { ...current, price_cents: 0 }, { ...current, price: 'invalid', price_cents: 1375 },
    { ...current, eta_days: 2, eta_business_days: 1 }, { ...current, eta_days: -1 },
  ]) it(`refuses contradictory/malformed explicit fields ${JSON.stringify(row)}`, async () => {
    expect(await fixture({ results: [row] }).api.getShipping()).toEqual([]);
  });

  for (const payload of [{ results: [] }, { results: [null] }, { results: [{}] }]) it('does not manufacture shipping for empty/invalid results', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await fixture(payload).api.getShipping()).toEqual([]);
  });

  it('does not replace a failed quote with demo shipping', async () => {
    expect(await fixture({ error: 'unavailable' }, 503).api.getShipping()).toEqual([]);
  });
});
