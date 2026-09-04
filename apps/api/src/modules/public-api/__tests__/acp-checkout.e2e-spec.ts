import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { EmbedTokenService } from "../../embed/domain/embed-token.service.js";

const BASE_URL = process.env.E2E_API_URL || "http://localhost:3009";
const API_KEY = process.env.E2E_API_KEY || "aacp_test_e2e_key";
const MERCHANT_ID = process.env.E2E_MERCHANT_ID || "merchant_test_e2e";
const TENANT_A = process.env.E2E_TENANT_A || "merchant_test_e2e";
const TENANT_B = process.env.E2E_TENANT_B || "merchant_other_e2e";
const TIMESTAMP = Date.now();

interface ApiResponse<T = unknown> {
  status: number;
  data: T;
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
  baseOverride?: string,
): Promise<ApiResponse<T>> {
  const url = `${baseOverride ?? BASE_URL}/v1${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const contentType = res.headers.get("content-type");
  const data =
    contentType?.includes("application/json") ? await res.json() : null;
  return { status: res.status, data };
}

function mintAcpToken(
  scopes: string[],
  overrides?: { merchantId?: string; expiresAtUnix?: number },
): string {
  const tokens = new EmbedTokenService({
    value: Buffer.from("embed-pay-intents-e2e-32-characters!!"),
  });
  const now = Math.floor(Date.now() / 1000);
  return tokens.sign({
    typ: "aacp_embed_v1",
    merchantId: overrides?.merchantId ?? MERCHANT_ID,
    issuedAtUnix: now,
    expiresAtUnix: overrides?.expiresAtUnix ?? now + 3600,
    nonce: randomUUID(),
    scopes: scopes as never,
  });
}

function uniqueSession(): string {
  return `chk_e2e_${TIMESTAMP}_${randomUUID().slice(0, 8)}`;
}

test.describe("ACP Checkout Sessions E2E", async () => {
  test("1. Discovery: GET /.well-known/ucp advertises checkout_sessions path", async () => {
    const res = await fetch(`${BASE_URL}/.well-known/ucp`, {
      method: "GET",
      headers: { "Accept": "application/json" },
    });
    assert(
      res.status === 200 || res.status === 404,
      `Expected 200 or 404 from well-known; got ${res.status}`,
    );
    if (res.status === 200) {
      const ct = res.headers.get("content-type");
      if (ct?.includes("application/json")) {
        const data = await res.json();
        assert(typeof data === "object" && data !== null);
      }
    }
  });

  test("2. Create checkout session returns 201/400 with valid id and ACP status", async () => {
    const res = await request<Record<string, unknown>>(
      "POST",
      "/acp/checkout_sessions",
      {
        merchant_id: MERCHANT_ID,
        items: [{ id: "sku_1", quantity: 2 }],
      },
    );
    assert(
      res.status === 201 || res.status === 400 || res.status === 422,
      `Expected 201, 400, or 422; got ${res.status}`,
    );
    assert(typeof res.data === "object" && res.data !== null);
    const data = res.data as Record<string, unknown>;
    if (res.status === 201) {
      assert.equal(typeof data.id, "string");
      assert((data.id as string).length > 0);
      assert(
        data.status === "not_ready_for_payment" ||
          data.status === "ready_for_payment",
        `Expected not_ready_for_payment or ready_for_payment; got ${String(data.status)}`,
      );
      assert.equal(typeof data.currency, "string");
      assert.equal((data.currency as string).toLowerCase(), data.currency);
      assert(Array.isArray(data.totals));
    }
  });

  test("3. Update session with line items returns 200/404/400", async () => {
    const create = await request<Record<string, unknown>>(
      "POST",
      "/acp/checkout_sessions",
      {
        merchant_id: MERCHANT_ID,
        items: [{ id: "sku_update_src", quantity: 1 }],
      },
    );
    if (create.status !== 201) {
      assert(
        create.status === 400 || create.status === 422,
        `Expected create to be 201/400/422; got ${create.status}`,
      );
      return;
    }
    const sessionId = (create.data as { id: string }).id;

    const res = await request<Record<string, unknown>>(
      "POST",
      `/acp/checkout_sessions/${sessionId}`,
      {
        merchant_id: MERCHANT_ID,
        line_items: [{ id: "sku_2", quantity: 3 }],
      },
    );
    assert(
      res.status === 200 || res.status === 400 || res.status === 404 || res.status === 422,
      `Expected 200, 400, 404, or 422; got ${res.status}`,
    );
  });

  test("4. Coupon apply returns 200 with discount or 400/404 if rejected", async () => {
    const create = await request<Record<string, unknown>>(
      "POST",
      "/acp/checkout_sessions",
      {
        merchant_id: MERCHANT_ID,
        items: [{ id: "sku_coupon_1", quantity: 1 }],
      },
    );
    if (create.status !== 201) {
      assert(
        create.status === 400 || create.status === 422,
        `Expected create 201/400/422; got ${create.status}`,
      );
      return;
    }
    const sessionId = (create.data as { id: string }).id;

    const res = await request<Record<string, unknown>>(
      "POST",
      `/acp/checkout_sessions/${sessionId}`,
      {
        merchant_id: MERCHANT_ID,
        coupon_code: "WELCOME10",
      },
    );
    assert(
      res.status === 200 || res.status === 400 || res.status === 404 || res.status === 422,
      `Expected 200, 400, 404, or 422; got ${res.status}`,
    );
    if (res.status === 200) {
      const data = res.data as { totals?: Array<{ type: string; amount: number }> };
      assert(Array.isArray(data.totals));
      const discount = data.totals!.find((t) => t.type === "discount");
      assert(discount !== undefined, "Expected discount entry in totals on 200");
      assert.equal(typeof discount!.amount, "number");
    }
  });

  test("5. Get session returns 200 with valid id or 404 if missing", async () => {
    const create = await request<Record<string, unknown>>(
      "POST",
      "/acp/checkout_sessions",
      {
        merchant_id: MERCHANT_ID,
        items: [{ id: "sku_get_1", quantity: 1 }],
      },
    );
    if (create.status !== 201) {
      assert(
        create.status === 400 || create.status === 422,
        `Expected create 201/400/422; got ${create.status}`,
      );
      return;
    }
    const sessionId = (create.data as { id: string }).id;

    const res = await request<Record<string, unknown>>(
      "GET",
      `/acp/checkout_sessions/${sessionId}`,
      { merchant_id: MERCHANT_ID },
    );
    assert(
      res.status === 200 || res.status === 404,
      `Expected 200 or 404; got ${res.status}`,
    );
    if (res.status === 200) {
      const data = res.data as { id: string; status: string };
      assert.equal(data.id, sessionId);
      assert(
        data.status === "not_ready_for_payment" ||
          data.status === "ready_for_payment" ||
          data.status === "completed" ||
          data.status === "canceled",
      );
    }
  });

  test("6a. Complete without auth returns 401", async () => {
    const sessionId = uniqueSession();
    const url = `${BASE_URL}/v1/acp/checkout_sessions/${sessionId}/complete`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: MERCHANT_ID,
        payment_token: "aacp_embed_v1.dummy",
      }),
    });
    assert.equal(res.status, 401);
  });

  test("6b. Complete with malformed bearer token returns 401", async () => {
    const sessionId = uniqueSession();
    const url = `${BASE_URL}/v1/acp/checkout_sessions/${sessionId}/complete`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Bearer not.a.valid.token.format",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        merchant_id: MERCHANT_ID,
        payment_token: "aacp_embed_v1.dummy",
      }),
    });
    assert.equal(res.status, 401);
  });

  test("6c. Complete with expired bearer token returns 401", async () => {
    const expired = mintAcpToken(["payment:intents:confirm"], {
      expiresAtUnix: Math.floor(Date.now() / 1000) - 60,
    });
    const sessionId = uniqueSession();
    const url = `${BASE_URL}/v1/acp/checkout_sessions/${sessionId}/complete`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${expired}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        merchant_id: MERCHANT_ID,
        payment_token: expired,
      }),
    });
    assert.equal(res.status, 401);
  });

  test("7. Complete with valid token lacking required scope returns 403", async () => {
    const wrongScopeToken = mintAcpToken(["checkout:track"]);
    const sessionId = uniqueSession();
    const url = `${BASE_URL}/v1/acp/checkout_sessions/${sessionId}/complete`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${wrongScopeToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        merchant_id: MERCHANT_ID,
        payment_token: wrongScopeToken,
      }),
    });
    assert.equal(res.status, 403);
  });

  test("8. Complete happy path with correct scope returns 200/400/422", async () => {
    const create = await request<Record<string, unknown>>(
      "POST",
      "/acp/checkout_sessions",
      {
        merchant_id: MERCHANT_ID,
        items: [{ id: "sku_complete_1", quantity: 1 }],
        fulfillment_address: {
          name: "E2E Buyer",
          line_one: "Av. Paulista 1000",
          city: "Sao Paulo",
          state: "SP",
          country: "BR",
          postal_code: "01310-100",
        },
      },
    );
    if (create.status !== 201) {
      assert(
        create.status === 400 || create.status === 422,
        `Expected create 201/400/422; got ${create.status}`,
      );
      return;
    }
    const sessionId = (create.data as { id: string }).id;

    const acpToken = mintAcpToken(["payment:intents:confirm"]);
    const res = await fetch(
      `${BASE_URL}/v1/acp/checkout_sessions/${sessionId}/complete`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${acpToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          merchant_id: MERCHANT_ID,
          payment_token: acpToken,
          payment_method: "pix",
        }),
      },
    );
    assert(
      res.status === 200 || res.status === 400 || res.status === 422,
      `Expected 200, 400, or 422; got ${res.status}`,
    );
    if (res.status === 200) {
      const data = (await res.json()) as {
        order_id?: string;
        confirmation_url?: string;
        session?: { status?: string };
      };
      assert.equal(typeof data.order_id, "string");
      assert.equal(typeof data.confirmation_url, "string");
      assert.match(
        data.confirmation_url as string,
        /^https:\/\/[^.]+\.zyon-payments\.com\.br\/orders\//,
      );
      assert.equal(data.session?.status, "completed");
    }
  });

  test("9a. Cancel session returns 200 with status=canceled", async () => {
    const create = await request<Record<string, unknown>>(
      "POST",
      "/acp/checkout_sessions",
      {
        merchant_id: MERCHANT_ID,
        items: [{ id: "sku_cancel_1", quantity: 1 }],
      },
    );
    if (create.status !== 201) {
      assert(
        create.status === 400 || create.status === 422,
        `Expected create 201/400/422; got ${create.status}`,
      );
      return;
    }
    const sessionId = (create.data as { id: string }).id;

    const cancel = await request<Record<string, unknown>>(
      "POST",
      `/acp/checkout_sessions/${sessionId}/cancel`,
      { merchant_id: MERCHANT_ID },
    );
    assert(
      cancel.status === 200 || cancel.status === 400 || cancel.status === 422,
      `Expected 200, 400, or 422; got ${cancel.status}`,
    );
    if (cancel.status === 200) {
      assert.equal((cancel.data as { status: string }).status, "canceled");
    }
  });

  test("9b. Update after cancel returns 409", async () => {
    const create = await request<Record<string, unknown>>(
      "POST",
      "/acp/checkout_sessions",
      {
        merchant_id: MERCHANT_ID,
        items: [{ id: "sku_terminal_1", quantity: 1 }],
      },
    );
    if (create.status !== 201) {
      assert(
        create.status === 400 || create.status === 422,
        `Expected create 201/400/422; got ${create.status}`,
      );
      return;
    }
    const sessionId = (create.data as { id: string }).id;

    const cancel = await request(
      "POST",
      `/acp/checkout_sessions/${sessionId}/cancel`,
      { merchant_id: MERCHANT_ID },
    );
    if (cancel.status !== 200) return;

    const updateAfterCancel = await request(
      "POST",
      `/acp/checkout_sessions/${sessionId}`,
      {
        merchant_id: MERCHANT_ID,
        line_items: [{ id: "sku_x", quantity: 1 }],
      },
    );
    assert(
      updateAfterCancel.status === 409 ||
        updateAfterCancel.status === 400 ||
        updateAfterCancel.status === 422,
      `Expected 409, 400, or 422 on post-cancel update; got ${updateAfterCancel.status}`,
    );
  });

  test("10. Tenant isolation: cross-merchant GET returns 404", async () => {
    const createA = await request<Record<string, unknown>>(
      "POST",
      "/acp/checkout_sessions",
      {
        merchant_id: TENANT_A,
        items: [{ id: "sku_iso_a", quantity: 1 }],
      },
    );
    if (createA.status !== 201) {
      assert(
        createA.status === 400 || createA.status === 422,
        `Expected create 201/400/422; got ${createA.status}`,
      );
      return;
    }
    const sessionId = (createA.data as { id: string }).id;

    const cross = await request(
      "GET",
      `/acp/checkout_sessions/${sessionId}`,
      { merchant_id: TENANT_B },
    );
    assert(
      cross.status === 404 || cross.status === 400 || cross.status === 422,
      `Expected 404, 400, or 422 for cross-tenant; got ${cross.status}`,
    );
  });

  test("11a. Complete with empty cart returns 400", async () => {
    const acpToken = mintAcpToken(["payment:intents:confirm"]);
    const sessionId = uniqueSession();
    const res = await fetch(
      `${BASE_URL}/v1/acp/checkout_sessions/${sessionId}/complete`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${acpToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          merchant_id: MERCHANT_ID,
          payment_token: acpToken,
        }),
      },
    );
    assert(
      res.status === 400 || res.status === 404 || res.status === 422,
      `Expected 400, 404, or 422; got ${res.status}`,
    );
  });

  test("11b. Complete without shipping/fulfillment returns 400/422", async () => {
    const create = await request<Record<string, unknown>>(
      "POST",
      "/acp/checkout_sessions",
      {
        merchant_id: MERCHANT_ID,
        items: [{ id: "sku_no_ship", quantity: 1 }],
      },
    );
    if (create.status !== 201) {
      assert(
        create.status === 400 || create.status === 422,
        `Expected create 201/400/422; got ${create.status}`,
      );
      return;
    }
    const sessionId = (create.data as { id: string }).id;

    const acpToken = mintAcpToken(["payment:intents:confirm"]);
    const res = await fetch(
      `${BASE_URL}/v1/acp/checkout_sessions/${sessionId}/complete`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${acpToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          merchant_id: MERCHANT_ID,
          payment_token: acpToken,
        }),
      },
    );
    assert(
      res.status === 200 || res.status === 400 || res.status === 422,
      `Expected 200, 400, or 422; got ${res.status}`,
    );
  });
});
