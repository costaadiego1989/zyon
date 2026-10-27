import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Webhook Dispatcher Tests ─────────────────────────────────────────────────

interface WebhookDeliveryRecord {
  id: string;
  merchantId: string;
  eventType: string;
  targetUrl: string;
  statusCode: number | null;
  attempts: number;
  status: "pending" | "delivered" | "failed";
  createdAt: Date;
}

interface WebhookDispatchResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

class InMemoryWebhookStore {
  deliveries: WebhookDeliveryRecord[] = [];
  private idCounter = 0;

  record(merchantId: string, eventType: string, targetUrl: string): WebhookDeliveryRecord {
    const entry: WebhookDeliveryRecord = {
      id: `wh_${++this.idCounter}`,
      merchantId,
      eventType,
      targetUrl,
      statusCode: null,
      attempts: 0,
      status: "pending",
      createdAt: new Date(),
    };
    this.deliveries.push(entry);
    return entry;
  }

  updateStatus(id: string, status: WebhookDeliveryRecord["status"], statusCode?: number): void {
    const d = this.deliveries.find((x) => x.id === id);
    if (d) {
      d.status = status;
      d.statusCode = statusCode ?? null;
      d.attempts++;
    }
  }

  listByMerchant(merchantId: string, limit = 50): WebhookDeliveryRecord[] {
    return this.deliveries
      .filter((d) => d.merchantId === merchantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

class M2MWebhookDispatcher {
  constructor(
    private readonly store: InMemoryWebhookStore,
    private readonly fetchFn: FetchFn,
    private readonly maxAttempts = 3,
  ) {}

  async dispatch(merchantId: string, eventType: string, targetUrl: string, payload: unknown): Promise<WebhookDispatchResult> {
    if (!targetUrl) return { success: false, error: "no_webhook_url" };

    const record = this.store.record(merchantId, eventType, targetUrl);
    let lastError: string | undefined;
    let lastStatus: number | undefined;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        const resp = await this.fetchFn(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-AACP-Event-Type": eventType },
          body: JSON.stringify(payload),
        });
        lastStatus = resp.status;

        if (resp.ok) {
          this.store.updateStatus(record.id, "delivered", resp.status);
          return { success: true, statusCode: resp.status };
        }

        // Non-retryable 4xx (except 408, 429)
        if (resp.status >= 400 && resp.status < 500 && resp.status !== 408 && resp.status !== 429) {
          this.store.updateStatus(record.id, "failed", resp.status);
          return { success: false, statusCode: resp.status, error: `http_${resp.status}` };
        }

        lastError = `http_${resp.status}`;
        this.store.updateStatus(record.id, "pending", resp.status);
      } catch (e) {
        lastError = "network_error";
        this.store.updateStatus(record.id, "pending");
      }

      // Exponential backoff (simulated — in real code would await)
    }

    this.store.updateStatus(record.id, "failed", lastStatus);
    return { success: false, error: lastError };
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("M2MWebhookDispatcher", () => {
  let store: InMemoryWebhookStore;

  beforeEach(() => {
    store = new InMemoryWebhookStore();
  });

  it("delivers successfully on 200", async () => {
    const fetch: FetchFn = async () => ({ ok: true, status: 200 });
    const dispatcher = new M2MWebhookDispatcher(store, fetch);

    const result = await dispatcher.dispatch("m1", "m2m.session.started", "https://hook.io/m2m", { session_id: "s1" });

    assert.equal(result.success, true);
    assert.equal(result.statusCode, 200);
    assert.equal(store.deliveries.length, 1);
    assert.equal(store.deliveries[0].status, "delivered");
  });

  it("retries on 5xx up to maxAttempts", async () => {
    let calls = 0;
    const fetch: FetchFn = async () => { calls++; return { ok: false, status: 503 }; };
    const dispatcher = new M2MWebhookDispatcher(store, fetch, 3);

    const result = await dispatcher.dispatch("m1", "m2m.negotiation.completed", "https://hook.io/m2m", {});

    assert.equal(result.success, false);
    assert.equal(result.error, "http_503");
    assert.equal(calls, 3);
    assert.equal(store.deliveries[0].status, "failed");
    assert.equal(store.deliveries[0].attempts, 4); // 3 retries + 1 final update
  });

  it("stops on non-retryable 4xx immediately", async () => {
    let calls = 0;
    const fetch: FetchFn = async () => { calls++; return { ok: false, status: 403 }; };
    const dispatcher = new M2MWebhookDispatcher(store, fetch, 3);

    const result = await dispatcher.dispatch("m1", "m2m.checkout.completed", "https://hook.io/m2m", {});

    assert.equal(result.success, false);
    assert.equal(calls, 1);
    assert.equal(result.error, "http_403");
    assert.equal(store.deliveries[0].status, "failed");
  });

  it("retries on 429 (rate limited)", async () => {
    let calls = 0;
    const fetch: FetchFn = async () => {
      calls++;
      if (calls < 3) return { ok: false, status: 429 };
      return { ok: true, status: 200 };
    };
    const dispatcher = new M2MWebhookDispatcher(store, fetch, 3);

    const result = await dispatcher.dispatch("m1", "m2m.session.started", "https://hook.io/m2m", {});

    assert.equal(result.success, true);
    assert.equal(calls, 3);
    assert.equal(store.deliveries[0].status, "delivered");
  });

  it("handles network errors and retries", async () => {
    let calls = 0;
    const fetch: FetchFn = async () => {
      calls++;
      if (calls < 3) throw new Error("ECONNREFUSED");
      return { ok: true, status: 200 };
    };
    const dispatcher = new M2MWebhookDispatcher(store, fetch, 3);

    const result = await dispatcher.dispatch("m1", "m2m.session.started", "https://hook.io/m2m", {});

    assert.equal(result.success, true);
    assert.equal(calls, 3);
  });

  it("returns error when no webhook URL", async () => {
    const fetch: FetchFn = async () => ({ ok: true, status: 200 });
    const dispatcher = new M2MWebhookDispatcher(store, fetch);

    const result = await dispatcher.dispatch("m1", "m2m.session.started", "", {});

    assert.equal(result.success, false);
    assert.equal(result.error, "no_webhook_url");
    assert.equal(store.deliveries.length, 0);
  });

  it("records delivery in store with correct event type", async () => {
    const fetch: FetchFn = async () => ({ ok: true, status: 200 });
    const dispatcher = new M2MWebhookDispatcher(store, fetch);

    await dispatcher.dispatch("merchant_x", "m2m.agent.registered", "https://x.io/hook", { agent_id: "a1" });

    const records = store.listByMerchant("merchant_x");
    assert.equal(records.length, 1);
    assert.equal(records[0].eventType, "m2m.agent.registered");
    assert.equal(records[0].targetUrl, "https://x.io/hook");
    assert.equal(records[0].status, "delivered");
  });

  it("isolates by merchant", async () => {
    const fetch: FetchFn = async () => ({ ok: true, status: 200 });
    const dispatcher = new M2MWebhookDispatcher(store, fetch);

    await dispatcher.dispatch("m1", "m2m.session.started", "https://m1.io/hook", {});
    await dispatcher.dispatch("m2", "m2m.session.started", "https://m2.io/hook", {});

    assert.equal(store.listByMerchant("m1").length, 1);
    assert.equal(store.listByMerchant("m2").length, 1);
  });
});
