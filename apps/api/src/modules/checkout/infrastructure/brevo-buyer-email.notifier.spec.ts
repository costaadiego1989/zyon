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

test("BrevoBuyerEmailNotifier adds the merchant logo, CNPJ and social links", async () => {
  process.env.BREVO_API_KEY = "x";
  process.env.BREVO_SENDER_EMAIL = "noreply@test.com";
  let delivered: Record<string, string> | undefined;
  let resolveDelivery!: () => void;
  const completed = new Promise<void>((resolve) => { resolveDelivery = resolve; });
  const http = {
    fetch: async (_url: string, options: { body?: unknown }) => {
      delivered = JSON.parse(String(options.body));
      resolveDelivery();
      return new Response("{}", { status: 202 });
    },
  };
  const prisma = {
    merchant: {
      findUnique: async () => ({
        name: "Loja Alfa",
        theme: { logoUrl: "https://cdn.example.test/brevo-logo.png" },
        storeSettings: {
          company: { cnpj: "12.345.678/0001-90" },
          social: { instagram: "https://instagram.com/lojaalfa" },
        },
      }),
    },
  } as never;
  try {
    new BrevoBuyerEmailNotifier(http as never, prisma).notifyCaptured(payload());
    await completed;
    assert.match(delivered?.htmlContent ?? "", /brevo-logo\.png/);
    assert.match(delivered?.htmlContent ?? "", /CNPJ: 12\.345\.678\/0001-90/);
    assert.match(delivered?.htmlContent ?? "", /instagram\.com\/lojaalfa/);
  } finally {
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_SENDER_EMAIL;
  }
});
