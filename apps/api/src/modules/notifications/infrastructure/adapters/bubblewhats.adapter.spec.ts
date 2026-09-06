import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { BubbleWhatsAdapter } from "./bubblewhats.adapter.js";

function fakeEnvironment(t: TestContext) {
  const originalUrl = process.env.BUBBLEWHATS_API_URL;
  const originalToken = process.env.BUBBLEWHATS_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.BUBBLEWHATS_API_URL = "https://bubble-test.invalid";
  process.env.BUBBLEWHATS_TOKEN = "fake-test-token";
  const requests: Parameters<typeof fetch>[] = [];
  let respond: typeof fetch = async () => { throw new Error("Unexpected fake gateway request"); };
  globalThis.fetch = (...args) => {
    requests.push(args);
    return respond(...args);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.BUBBLEWHATS_API_URL;
    else process.env.BUBBLEWHATS_API_URL = originalUrl;
    if (originalToken === undefined) delete process.env.BUBBLEWHATS_TOKEN;
    else process.env.BUBBLEWHATS_TOKEN = originalToken;
  });
  return { requests, respondWith: (response: typeof fetch) => { respond = response; } };
}

test("BubbleWhats skips incomplete configuration without invoking fetch", async (t) => {
  const fake = fakeEnvironment(t);
  const adapter = new BubbleWhatsAdapter();
  for (const missing of ["BUBBLEWHATS_API_URL", "BUBBLEWHATS_TOKEN"] as const) {
    process.env.BUBBLEWHATS_API_URL = "https://bubble-test.invalid";
    process.env.BUBBLEWHATS_TOKEN = "fake-test-token";
    delete process.env[missing];
    assert.deepEqual(await adapter.send({ phone: "11999990000", message: "Test only" }), {
      status: "skipped", reason: "not_configured",
    });
  }
  assert.equal(fake.requests.length, 0);
});

test("BubbleWhats skips a missing phone without invoking fetch", async (t) => {
  const fake = fakeEnvironment(t);
  assert.deepEqual(await new BubbleWhatsAdapter().send({ phone: "", message: "Test only" }), {
    status: "skipped", reason: "missing_phone",
  });
  assert.equal(fake.requests.length, 0);
});

test("BubbleWhats reports acceptance only after a successful gateway response", async (t) => {
  const fake = fakeEnvironment(t);
  let accept!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => { accept = resolve; });
  fake.respondWith(async () => response);
  let settled = false;
  const execution = new BubbleWhatsAdapter().send({ phone: "(11) 99999-0000", message: "Test only" })
    .then((result) => { settled = true; return result; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(fake.requests.length, 1);
  const [url, options] = fake.requests[0]!;
  assert.equal(url, "https://bubble-test.invalid/send-message");
  assert.equal(options?.method, "POST");
  assert.deepEqual(options?.headers, {
    Authorization: "fake-test-token", "Content-Type": "application/json",
  });
  assert.deepEqual(JSON.parse(String(options?.body)), {
    jid: "5511999990000@s.whatsapp.net", message: "Test only",
  });
  accept(new Response("accepted", { status: 202 }));
  assert.deepEqual(await execution, { status: "accepted" });
});

test("BubbleWhats preserves an existing Brazil country code", async (t) => {
  const fake = fakeEnvironment(t);
  fake.respondWith(async () => new Response("accepted", { status: 200 }));
  assert.deepEqual(await new BubbleWhatsAdapter().send({ phone: "+55 11 99999-0000", message: "Test only" }), {
    status: "accepted",
  });
  assert.equal(JSON.parse(String(fake.requests[0]?.[1]?.body)).jid, "5511999990000@s.whatsapp.net");
});

test("BubbleWhats rejects gateway refusal so callers can retry", async (t) => {
  const fake = fakeEnvironment(t);
  fake.respondWith(async () => new Response("test rejection", { status: 503 }));
  await assert.rejects(
    new BubbleWhatsAdapter().send({ phone: "11999990000", message: "Test only" }),
    /whatsapp_send_failed: 503 test rejection/,
  );
  assert.equal(fake.requests.length, 1);
});

test("BubbleWhats propagates transport failures instead of claiming acceptance", async (t) => {
  const fake = fakeEnvironment(t);
  fake.respondWith(async () => { throw new Error("fake gateway offline"); });
  await assert.rejects(
    new BubbleWhatsAdapter().send({ phone: "11999990000", message: "Test only" }),
    /whatsapp_send_transport_failed: fake gateway offline/,
  );
  assert.equal(fake.requests.length, 1);
});
