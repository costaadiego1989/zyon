import test from "node:test";
import assert from "node:assert/strict";
import { AgenticCheckoutEmbedClient, AgenticCheckoutHttpError } from "./checkout-embed-api.js";

test("normalize base URL and send X-AACP-Embed-Token on embed/start", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ session_id: "s_test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }) as Response;
  };

  const client = new AgenticCheckoutEmbedClient({
    apiBaseUrl: " https://api.example/",
    embedSessionToken: "emb_sess",
    fetchImpl: mockFetch
  });

  await client.startCheckout({
    cart: {
      currency: "BRL",
      total: 99,
      items: [{ sku: "a", name: "A", price: 99, quantity: 1 }]
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example/embed/start");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["X-AACP-Embed-Token"], "emb_sess");
  assert.ok(String(calls[0].init.body).includes("\"cart\""));
});

test("routes track/chat/applyOffer to slash paths under normalized base", async () => {
  const paths: string[] = [];
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    paths.push(url);
    if (url.endsWith("/embed/track")) {
      return Response.json({ received: true, abandonment_score: 0, trigger_agent: false });
    }
    if (url.endsWith("/embed/chat")) {
      return Response.json({ message: "ok", objection: "unknown", actions: [] });
    }
    if (url.endsWith("/embed/offers/apply")) {
      return Response.json({ success: true });
    }
    return new Response("", { status: 500 });
  };

  const client = new AgenticCheckoutEmbedClient({
    apiBaseUrl: "https://h.test",
    embedSessionToken: "t",
    fetchImpl: mockFetch
  });

  await client.trackEvent({ session_id: "s", event: "cart_viewed" });
  await client.sendChat({
    session_id: "s",
    conversation_id: "c",
    user_message: "hi"
  });
  await client.applyOffer({ session_id: "s", offer_id: "o1" });

  assert.deepEqual(paths, [
    "https://h.test/embed/track",
    "https://h.test/embed/chat",
    "https://h.test/embed/offers/apply"
  ]);
});

test("createPaymentIntent posts /embed/payment/intents JSON sem merchant_id", async () => {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    urls.push(String(input));
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return Response.json(
      {
        merchantId: "m",
        sessionId: "s",
        amountCents: 100,
        currency: "BRL",
        status: "requires_action",
        buyerFacing: { invoiceUrl: "https://x" }
      },
      { status: 200 }
    );
  };

  const client = new AgenticCheckoutEmbedClient({
    apiBaseUrl: "https://api.embed/",
    embedSessionToken: "tok",
    fetchImpl: mockFetch
  });

  await client.createPaymentIntent({ session_id: "sess", idempotency_key: "idem-uuid" });

  assert.deepEqual(urls, ["https://api.embed/embed/payment/intents"]);
  assert.deepEqual(bodies[0], { session_id: "sess", idempotency_key: "idem-uuid" });
});

test("throws AgenticCheckoutHttpError on non-OK response", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response("nope", { status: 401 }) as Response;

  const client = new AgenticCheckoutEmbedClient({
    apiBaseUrl: "https://x",
    embedSessionToken: "t",
    fetchImpl: mockFetch
  });

  await assert.rejects(
    async () =>
      client.startCheckout({
        cart: { currency: "BRL", total: 1, items: [{ sku: "x", name: "X", price: 1, quantity: 1 }] }
      }),
    (err: unknown) => err instanceof AgenticCheckoutHttpError && err.status === 401 && err.responseBody === "nope"
  );
});
