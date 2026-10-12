import test from "node:test";
import assert from "node:assert/strict";
import { BrevoBuyerEmailNotifier } from "./brevo-buyer-email.notifier.js";

const payload = () => ({
  buyerEmail: "buyer@test.com",
  merchantId: "mrc_t",
  sessionId: "chk_t",
  merchantName: "Loja Alfa",
  buyerFirstNameHint: "Ana"
});

test("BrevoBuyerEmailNotifier noop sem BREVO_API_KEY / sender (fetch não chamado)", async () => {
  const prevKey = process.env.BREVO_API_KEY;
  const prevSender = process.env.BREVO_SENDER_EMAIL;
  delete process.env.BREVO_API_KEY;
  delete process.env.BREVO_SENDER_EMAIL;

  const originalFetch = globalThis.fetch;
  let hits = 0;
  globalThis.fetch = async () => {
    hits++;
    return new Response("{}");
  };

  try {
    new BrevoBuyerEmailNotifier().notifyCaptured(payload());
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    assert.equal(hits, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevKey !== undefined) process.env.BREVO_API_KEY = prevKey;
    else delete process.env.BREVO_API_KEY;
    if (prevSender !== undefined) process.env.BREVO_SENDER_EMAIL = prevSender;
    else delete process.env.BREVO_SENDER_EMAIL;
  }
});

test("BrevoBuyerEmailNotifier com env chama SMTP e erro HTTP não lança", async () => {
  process.env.BREVO_API_KEY = "x";
  process.env.BREVO_SENDER_EMAIL = "noreply@test.com";

  const originalFetch = globalThis.fetch;
  let hits = 0;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    hits++;
    const url = typeof input === "string" ? input : input.toString();
    assert.match(url, /brevo\.com\/v3\/smtp\/email$/);
    return new Response("{}", { status: 502 });
  };

  try {
    new BrevoBuyerEmailNotifier().notifyCaptured(payload());
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    assert.ok(hits >= 1);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_SENDER_EMAIL;
  }
});

test("capture notice describes the event without asking for confirmation or exposing internal IDs", async () => {
  const oldKey = process.env.BREVO_API_KEY, oldSender = process.env.BREVO_SENDER_EMAIL;
  process.env.BREVO_API_KEY = "fake-test-key";
  process.env.BREVO_SENDER_EMAIL = "noreply@example.test";
  let request: any;
  const notifier = new BrevoBuyerEmailNotifier({ fetch: async (_url: string, options: any) => {
    request = JSON.parse(options.body);
    return new Response("{}", { status: 201 });
  } } as any);
  try {
    await (notifier as any).trySend({ ...payload(), merchantName: "Loja <Teste>", buyerFirstNameHint: "<script>Ana</script>" });
    assert.equal(request.subject, "Loja <Teste> | Email informado na compra");
    assert.doesNotMatch(request.htmlContent, /chk_t|mrc_t|<script>|Confirme o uso/);
    assert.match(request.htmlContent, /Loja &lt;Teste&gt;/);
    assert.match(request.htmlContent, /não confirma um pedido nem um pagamento/);
  } finally {
    if (oldKey === undefined) delete process.env.BREVO_API_KEY; else process.env.BREVO_API_KEY = oldKey;
    if (oldSender === undefined) delete process.env.BREVO_SENDER_EMAIL; else process.env.BREVO_SENDER_EMAIL = oldSender;
  }
});
