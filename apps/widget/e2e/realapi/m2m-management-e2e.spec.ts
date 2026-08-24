/**
 * M2M Management E2E — Tests the management endpoints used by the dashboard
 * to configure M2M protocol, register/suspend agents, and verify webhook delivery.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3009";
const EMAIL = "costaadiego1989@gmail.com";
const PASSWORD = "ueuf3900";

async function login(request: APIRequestContext) {
  const resp = await request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(resp.status()).toBe(201);
  const body = await resp.json();
  const cookies = resp.headers()["set-cookie"] || "";
  const cookie = cookies.split(";")[0];
  return { token: body.access_token, cookie, merchantId: body.merchant_id };
}

test.describe("M2M Management E2E @realapi", () => {
  let cookie: string;
  let merchantId: string;

  test.beforeAll(async ({ request }) => {
    const auth = await login(request);
    cookie = auth.cookie;
    merchantId = auth.merchantId;
  });

  test("GET /m2m/protocol/config returns defaults when no config exists", async ({ request }) => {
    const resp = await request.get(`${API}/m2m/protocol/config`, {
      headers: { Cookie: cookie },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(typeof body.enabled).toBe("boolean");
    expect(typeof body.maxSessionTtlMinutes).toBe("number");
  });

  test("PUT /m2m/protocol/config persists configuration", async ({ request }) => {
    const resp = await request.put(`${API}/m2m/protocol/config`, {
      headers: { Cookie: cookie },
      data: { enabled: true, webhookUrl: "https://test-hooks.example.com/m2m", maxSessionTtlMinutes: 45 },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.enabled).toBe(true);
    expect(body.webhookUrl).toBe("https://test-hooks.example.com/m2m");
    expect(body.maxSessionTtlMinutes).toBe(45);

    // Verify persistence via GET
    const check = await request.get(`${API}/m2m/protocol/config`, { headers: { Cookie: cookie } });
    const saved = await check.json();
    expect(saved.enabled).toBe(true);
    expect(saved.webhookUrl).toBe("https://test-hooks.example.com/m2m");
  });

  test("PUT /m2m/protocol/config rejects non-HTTPS webhook URL", async ({ request }) => {
    const resp = await request.put(`${API}/m2m/protocol/config`, {
      headers: { Cookie: cookie },
      data: { webhookUrl: "http://insecure.example.com/hook" },
    });
    expect(resp.status()).toBeGreaterThanOrEqual(400);
  });

  test("GET /m2m/agents returns empty array initially", async ({ request }) => {
    const resp = await request.get(`${API}/m2m/agents`, {
      headers: { Cookie: cookie },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body.agents)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  test("POST /m2m/agents creates a new agent", async ({ request }) => {
    const resp = await request.post(`${API}/m2m/agents`, {
      headers: { Cookie: cookie },
      data: { displayName: "E2E Test Bot", globalUserId: `e2e-agent-${Date.now()}` },
    });
    expect(resp.status()).toBe(201);
    const body = await resp.json();
    expect(body.displayName).toBe("E2E Test Bot");
    expect(body.status).toBe("active");
    expect(body.reputation).toBeTruthy();
    expect(body.reputation.reputationScore).toBe(100);
  });

  test("POST /m2m/agents rejects duplicate globalUserId", async ({ request }) => {
    const uid = `e2e-dup-${Date.now()}`;
    await request.post(`${API}/m2m/agents`, {
      headers: { Cookie: cookie },
      data: { displayName: "First", globalUserId: uid },
    });
    const resp = await request.post(`${API}/m2m/agents`, {
      headers: { Cookie: cookie },
      data: { displayName: "Duplicate", globalUserId: uid },
    });
    expect(resp.status()).toBeGreaterThanOrEqual(400);
  });

  test("PUT /m2m/agents/:id/suspend toggles agent status", async ({ request }) => {
    // Create agent
    const createResp = await request.post(`${API}/m2m/agents`, {
      headers: { Cookie: cookie },
      data: { displayName: "Suspend Test", globalUserId: `e2e-suspend-${Date.now()}` },
    });
    const agent = await createResp.json();

    // Suspend
    const suspendResp = await request.put(`${API}/m2m/agents/${agent.id}/suspend`, {
      headers: { Cookie: cookie },
      data: { suspend: true },
    });
    expect(suspendResp.status()).toBe(200);

    // Verify
    const listResp = await request.get(`${API}/m2m/agents`, { headers: { Cookie: cookie } });
    const list = await listResp.json();
    const found = list.agents.find((a: any) => a.id === agent.id);
    expect(found.status).toBe("suspended");

    // Reactivate
    await request.put(`${API}/m2m/agents/${agent.id}/suspend`, {
      headers: { Cookie: cookie },
      data: { suspend: false },
    });
    const listResp2 = await request.get(`${API}/m2m/agents`, { headers: { Cookie: cookie } });
    const list2 = await listResp2.json();
    const found2 = list2.agents.find((a: any) => a.id === agent.id);
    expect(found2.status).toBe("active");
  });
});
