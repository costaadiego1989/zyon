import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createHash, createHmac } from "node:crypto";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { arrangeIssuance } from "../../../../tests/fiscal-issuance-harness.js";
import { FiscalReconciliationService } from "../application/fiscal-reconciliation.service.js";
import { PrismaFiscalStockCoordinator } from "../../../shared/persistence/fiscal-stock-coordination.js";
import { FiscalDeliveryService } from "../application/fiscal-delivery.service.js";
import { FiscalDeliveryAccounts } from "./fiscal-delivery-accounts.js";
import { FiscalDeliveryDispatcher } from "./fiscal-delivery.dispatcher.js";
import { FiscalCredentialCipher } from "./fiscal-credential-cipher.js";
import { FiscalRuntimeConfiguration } from "./fiscal-runtime-configuration.js";
import { ResendEmailAdapter } from "../../notifications/infrastructure/adapters/resend-email.adapter.js";
import { TwilioSenderAdapter } from "../../whatsapp-channel/infrastructure/adapters/twilio-sender.adapter.js";
let f: Awaited<ReturnType<typeof createFiscalFixture>>;
const cipher = new FiscalCredentialCipher({
  AACP_PII_ENC_KEY: "synthetic-original-callback-key",
});
before(
  async () => {
    f = await createFiscalFixture();
  },
  { timeout: 120000 }
);
after(async () => {
  await f?.close();
});
async function original(pending = false) {
  const a = await arrangeIssuance(f);
  await a.run();
  a.setRemote("authorized");
  await new FiscalReconciliationService(
    a.store,
    a.factory,
    { read: async () => ({ found: false, reasonCode: "none" }) },
    new PrismaFiscalStockCoordinator(f.prisma)
  ).reconcile(a.scope, a.sale.intent.id);
  const ledger = new FiscalDeliveryService(f.prisma, a.store, {}),
    rows = await ledger.initialize(a.scope, a.sale.intent.id),
    row = rows.find((r) => r.channel === "whatsapp")!;
  const accountSid = "AC" + crypto.randomUUID().replaceAll("-", ""),
    configId = "original_config_" + row.id,
    messageId = "SM" + row.id,
    authToken = "original-private-token-" + row.id;
  await f.prisma.fiscalDelivery.update({
    where: { id: row.id },
    data: {
      state: pending ? "delivery_unknown" : "accepted",
      transportProvider: "twilio",
      transportAccountId: accountSid,
      transportConnectionId: configId,
      providerMessageId: pending ? null : messageId,
      callbackCredentialCipher: cipher.encrypt(
        JSON.stringify({ accountSid, authToken })
      ),
    },
  });
  const accounts = new FiscalDeliveryAccounts(f.prisma, cipher),
    dispatcher = new FiscalDeliveryDispatcher(
      ledger,
      accounts,
      "https://api.example.test"
    );
  const url =
      "https://api.example.test/v1/webhooks/fiscal-delivery/twilio/" + configId,
    body = {
      AccountSid: accountSid,
      MessageSid: messageId,
      MessageStatus: "delivered",
      To: "whatsapp:" + row.destination,
    };
  const signature = (key = authToken) =>
    createHmac("sha1", key)
      .update(
        Object.keys(body)
          .sort()
          .reduce((s, k) => s + k + body[k as keyof typeof body], url)
      )
      .digest("base64");
  return {
    ...a,
    row,
    accounts,
    dispatcher,
    accountSid,
    configId,
    messageId,
    authToken,
    body,
    signature,
    path: new URL(url).pathname,
  };
}
test("FISCAL-49 actual runtime original encrypted Twilio credential authenticates callback-before-message-ID and requires retry", async () => {
  const a = await original(true);
  await assert.rejects(
    a.dispatcher.twilio(a.configId, a.signature(), a.body, a.path),
    /identity_pending/
  );
  assert.equal(
    (
      await f.prisma.fiscalDelivery.findUniqueOrThrow({
        where: { id: a.row.id },
      })
    ).state,
    "delivery_unknown"
  );
});
test("FISCAL-49 actual runtime original token remains callback authority after account credential rotation", async () => {
  const a = await original();
  await a.dispatcher.twilio(a.configId, a.signature(), a.body, a.path);
  assert.equal(
    (
      await f.prisma.fiscalDelivery.findUniqueOrThrow({
        where: { id: a.row.id },
      })
    ).state,
    "delivered"
  );
  await assert.rejects(
    a.dispatcher.twilio(
      a.configId,
      a.signature("replacement-current-token"),
      a.body,
      a.path
    ),
    /signature_invalid/
  );
});
test("FISCAL-49 actual runtime foreign account never borrows a pending callback credential", async () => {
  const a = await original(true);
  assert.equal(
    await a.accounts.twilio(a.configId, "ACforeign", a.messageId),
    null
  );
  await assert.rejects(
    a.dispatcher.twilio(
      a.configId,
      a.signature(),
      { ...a.body, AccountSid: "ACforeign" },
      a.path
    ),
    /signature_invalid/
  );
});
test("FISCAL-61 actual original callback cipher is private and immutable in PostgreSQL", async () => {
  const a = await original();
  const row = await f.prisma.fiscalDelivery.findUniqueOrThrow({
    where: { id: a.row.id },
  });
  assert.equal(row.callbackCredentialCipher!.includes(a.authToken), false);
  await assert.rejects(
    f.prisma.fiscalDelivery.update({
      where: { id: row.id },
      data: { callbackCredentialCipher: cipher.encrypt("replacement") },
    }),
    /credential_immutable/
  );
});
test("FISCAL-48 actual Resend sender-domain GET binds current key and original callback mapping", async () => {
  let calls = 0;
  const key = "synthetic-resend-original",
    keyFingerprint = createHash("sha256").update(key).digest("hex"),
    hookSecret =
      "whsec_" +
      Buffer.from("original-synthetic-hook-secret").toString("base64");
  const accounts = new FiscalDeliveryAccounts(
    f.prisma,
    cipher,
    {
      RESEND_API_KEY: key,
      RESEND_FROM_EMAIL: "fiscal@example.test",
      FISCAL_RESEND_ACCOUNTS: JSON.stringify([
        {
          keyFingerprint,
          fromEmail: "fiscal@example.test",
          domainId: "original-domain",
          hookRef: "original-hook",
          hookSecret,
        },
      ]),
    },
    (async (url, init) => {
      calls++;
      assert.equal(
        String(url),
        "https://api.resend.com/domains/original-domain"
      );
      assert.equal(init?.method, "GET");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer " + key
      );
      return Response.json({
        id: "original-domain",
        name: "example.test",
        status: "verified",
      });
    }) as typeof fetch
  );
  assert.deepEqual(await accounts.read(), {
    enabled: true,
    accountId: "resend:" + keyFingerprint,
  });
  assert.deepEqual(await accounts.resend("original-hook"), {
    accountId: "resend:" + keyFingerprint,
    secret: hookSecret,
  });
  assert.equal(calls, 1);
});
test("FISCAL-48 missing or foreign Resend original binding never becomes ready by an arbitrary configured flag", async () => {
  let calls = 0;
  const a = new FiscalDeliveryAccounts(
    f.prisma,
    cipher,
    {
      RESEND_API_KEY: "changed",
      FISCAL_RESEND_ACCOUNTS: JSON.stringify([
        { keyFingerprint: "foreign", ready: true },
      ]),
    },
    (async () => {
      calls++;
      return Response.json({ status: "verified" });
    }) as typeof fetch
  );
  assert.equal(await a.read(), null);
  assert.equal(calls, 0);
  assert.equal(await a.resend("unmapped"), null);
});
test("FISCAL-26 actual runtime Olist stock origin uses exact protected original issuer/account/environment contract", async () => {
  const scope = {
    merchantId: "original_merchant",
    connectionId: "original_connection",
    provider: "tiny" as const,
    environment: "homologation" as const,
    issuerTaxId: "12ABC34501DE35",
  };
  const env = {
    FISCAL_OLIST_STOCK_ORIGINS: JSON.stringify([
      {
        scope,
        objectType: "synthetic_reviewed_NF_origin",
        source: "verified_provider_contract",
        evidenceReference: "verified_provider_contract:synthetic_fixture_only",
      },
    ]),
  };
  const runtime = new FiscalRuntimeConfiguration(
    f.prisma,
    cipher,
    {} as any,
    env
  );
  assert.equal(
    (await runtime.stockOrigin(scope))?.objectType,
    "synthetic_reviewed_NF_origin"
  );
  for (const replacement of [
    { merchantId: "foreign" },
    { connectionId: "replacement" },
    { environment: "production" as const },
    { issuerTaxId: "99999999000199" },
  ])
    assert.equal(await runtime.stockOrigin({ ...scope, ...replacement }), null);
});
test("FISCAL-26 absent Olist reviewed origin stays specifically pending without guessed semantic type", async () => {
  const a = new FiscalRuntimeConfiguration(f.prisma, cipher, {} as any, {});
  assert.equal(
    await a.stockOrigin({
      merchantId: "a",
      connectionId: "b",
      provider: "tiny",
      environment: "homologation",
      issuerTaxId: "12ABC34501DE35",
    }),
    null
  );
});

test("FISCAL-48 actual Resend adapter retains its captured original account and rejects replacement runtime mapping before GET", async () => {
  const saved = { key: process.env.RESEND_API_KEY };
  const originalFrom = process.env.RESEND_FROM_EMAIL;
  try {
    process.env.RESEND_API_KEY = "synthetic-original-sender-key";
    process.env.RESEND_FROM_EMAIL = "fiscal@example.test";
    const sender = new ResendEmailAdapter();
    let calls = 0;
    const env = {
      RESEND_API_KEY: "replacement-key",
      RESEND_FROM_EMAIL: "fiscal@example.test",
      FISCAL_RESEND_ACCOUNTS: JSON.stringify([
        {
          keyFingerprint: createHash("sha256")
            .update("replacement-key")
            .digest("hex"),
          fromEmail: "fiscal@example.test",
          domainId: "replacement-domain",
        },
      ]),
    };
    const accounts = new FiscalDeliveryAccounts(
      f.prisma,
      cipher,
      env,
      (async () => {
        calls++;
        throw new Error("must not query a replacement account");
      }) as typeof fetch,
      sender
    );
    assert.equal(
      sender.deliveryAccountIdentity()?.credentialFingerprint,
      createHash("sha256").update("synthetic-original-sender-key").digest("hex")
    );
    assert.equal(await accounts.read(), null);
    assert.equal(calls, 0);
  } finally {
    if (saved.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved.key;
    if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalFrom;
  }
});

test("FISCAL-48 actual strict Twilio adapter refuses a token rotated after fiscal preparation without a provider write", async () => {
  const sender = new TwilioSenderAdapter({
    findById: async () => ({
      id: "original_config",
      merchantId: "merchant",
      provider: "TWILIO",
      enabled: true,
      status: "ACTIVE",
      credentials: {
        accountSid: "ACoriginal",
        authToken: "replacement-token",
        senderId: "whatsapp:+5511888888888",
      },
    }),
  } as any);
  const result = await sender.sendTextStrict(
    {
      deviceId: "twilio:original_config",
      toNumber: "+5511999999999",
      text: "Original invoice",
    },
    {
      configId: "original_config",
      merchantId: "merchant",
      accountId: "ACoriginal",
      credentialFingerprint: createHash("sha256")
        .update("original-token")
        .digest("hex"),
      statusCallbackUrl:
        "https://api.example.test/v1/webhooks/fiscal-delivery/twilio/original_config",
    }
  );
  assert.deepEqual(result, { status: "skipped", messageId: "" });
});

test("FISCAL-48 never-written blocked channel can dispatch after eligibility is restored and never duplicates an accepted message", async () => {
  const a = await original();
  let ready = false,
    sends = 0;
  const ledger = new FiscalDeliveryService(f.prisma, a.store, {
    email: {
      prepare: async () =>
        ready
          ? {
              ready: true,
              provider: "resend",
              accountId: "original-account",
              send: async () => {
                sends++;
                return { state: "accepted", messageId: "original-message" };
              },
            }
          : { ready: false, reasonCode: "fiscal_email_account_pending" },
    },
  });
  const blocked = await ledger.dispatch(a.scope, a.sale.intent.id, "email");
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.attempts, 0);
  ready = true;
  const accepted = await ledger.dispatch(a.scope, a.sale.intent.id, "email");
  assert.equal(accepted.id, blocked.id);
  assert.equal(accepted.state, "accepted");
  assert.equal(accepted.attempts, 1);
  await ledger.dispatch(a.scope, a.sale.intent.id, "email");
  assert.equal(sends, 1);
});
