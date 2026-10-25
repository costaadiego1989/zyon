import { test, expect } from '@playwright/test';

const API_URL = 'http://localhost:3009';
const EMAIL = 'costaadiego1989@gmail.com';
const PASS = 'UeUf3900@';

test.describe('Melhor Envio OAuth API', () => {
  let cookie: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API_URL}/auth/login`, {
      data: { email: EMAIL, password: PASS }
    });
    expect(res.ok()).toBe(true);
    cookie = res.headers()['set-cookie']?.split(';')[0] ?? '';
  });

  test('GET /shipping/melhor-envio/status returns connected:false', async ({ request }) => {
    const res = await request.get(`${API_URL}/shipping/melhor-envio/status`, {
      headers: { Cookie: cookie }
    });
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data.provider).toBe('melhor_envio');
    expect(data.connected).toBe(false);
  });

  test('GET /shipping/melhor-envio/authorize redirects to OAuth', async ({ request }) => {
    const res = await request.get(`${API_URL}/shipping/melhor-envio/authorize`, {
      headers: { Cookie: cookie },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
    const location = res.headers()['location'] ?? '';
    expect(location).toContain('melhorenvio.com.br/oauth/authorize');
    expect(location).toContain('client_id=11150');
    expect(location).toContain('shipping-calculate');
  });
});
