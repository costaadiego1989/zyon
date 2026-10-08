import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutSession } from "../src/api/checkout-session.js";
import { initTracking } from "../src/lib/tracking.js";
import { resetTriggers, setupIdleTrigger } from "../src/lib/triggers.js";
import { useCheckoutStore as store } from "../src/store/checkout-store.js";

const config = { embedToken: "token", merchantId: "merchant", apiBaseUrl: "https://api.test/v1" };
function ready() {
  store.getState().resetSession();
  const api = new CheckoutSession(config);
  initTracking(api, "session");
  store.setState({ api, sessionId: "session", status: "active",
    paymentIntent: { intent_id: "intent", status: "pending", method: "card" } as never,
    merchantPaymentConfig: { paymentMethods: { pix: true, card: false } },
    triggerConfig: { enabledTriggers: ["payment_failed"], cooldownMs: 120000, maxInterventions: 3 },
    triggerMessages: { payment_failed: { message: "Experimente uma das opções disponíveis." } },
  });
  return api;
}

test("failure uses configured help, only supported methods and one event per payment", async t => {
  ready(); t.after(() => store.getState().resetSession());
  const requests: Array<Record<string, unknown>> = [];
  t.mock.method(globalThis, "fetch", async (_url, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return Response.json({ trigger_agent: true });
  });
  await Promise.all([store.getState().reportPaymentFailure("intent"), store.getState().reportPaymentFailure("intent")]);
  assert.equal(store.getState().status, "active");
  assert.equal(requests.length, 1); assert.equal(requests[0].event, "payment_failed");
  assert.equal(store.getState().messages.length, 1);
  assert.equal(store.getState().messages[0].text, "Experimente uma das opções disponíveis.");
  assert.deepEqual((store.getState().messages[0].blocks?.[0].data?.methods as Array<{ key: string }>).map(row => row.key), ["pix"]);
});

test("disabled, manual-only and server-denied help retain transactional failure without custom intervention", async t => {
  t.after(() => store.getState().resetSession());
  for (const mode of ["disabled", "manual", "denied"]) {
    ready();
    store.setState({ triggerConfig: { enabledTriggers: mode === "disabled" ? [] : ["payment_failed"],
      mode: mode === "manual" ? "manual_only" : "silent_until_trigger", cooldownMs: 120000, maxInterventions: 3 } });
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ trigger_agent: mode !== "denied" }));
    await store.getState().reportPaymentFailure("intent");
    assert.match(store.getState().messages[0].text!, /não foi aprovado/);
    assert.equal(store.getState().messages[0].blocks, undefined);
    fetchMock.mock.restore();
  }
});

test("payment observation and completed sessions never submit failure events", async t => {
  ready(); t.after(() => store.getState().resetSession());
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected mutation"); });
  store.setState({ paymentObservation: true }); await store.getState().reportPaymentFailure("intent");
  store.setState({ paymentObservation: false, status: "completed" }); await store.getState().reportPaymentFailure("intent");
  assert.equal(fetchMock.mock.callCount(), 0); assert.equal(store.getState().messages.length, 0);
});

test("stale failure response cannot inject help into another payment", async t => {
  ready(); t.after(() => store.getState().resetSession());
  let resolve!: (result: Response) => void;
  t.mock.method(globalThis, "fetch", () => new Promise<Response>(yes => { resolve = yes; }));
  const pending = store.getState().reportPaymentFailure("intent");
  store.setState({ paymentIntent: { intent_id: "new-intent", status: "pending", method: "card" } as never, messages: [] });
  resolve(Response.json({ trigger_agent: true })); await pending;
  assert.deepEqual(store.getState().messages, []);
});

test("idle timer honors configured duration, restarts after interaction and cleans up", t => {
  resetTriggers();
  const listeners = new Map<string, () => void>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true,
    value: { addEventListener: (event: string, handler: () => void) => listeners.set(event, handler),
      removeEventListener: (event: string) => listeners.delete(event) } });
  t.after(() => {
    resetTriggers();
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  });
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const fired: string[] = [];
  const cleanup = setupIdleTrigger({ enabledTriggers: ["idle_30_seconds"], idleSeconds: 600, cooldownMs: 0, maxInterventions: 3 }, event => fired.push(event));
  t.mock.timers.tick(599000); assert.deepEqual(fired, []);
  listeners.get("keydown")!();
  t.mock.timers.tick(599000); assert.deepEqual(fired, []);
  t.mock.timers.tick(1000); assert.deepEqual(fired, ["idle_30_seconds"]);
  cleanup(); assert.equal(listeners.size, 0); resetTriggers();
});
