import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { FiscalPaymentEvidenceReader } from "./fiscal-payment-evidence.reader.js";
import { FiscalSetupService } from "../application/fiscal-setup.service.js";
import { FiscalCredentialCipher } from "./fiscal-credential-cipher.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { registerTenantMiddleware } from "../../../shared/persistence/tenant.middleware.js";
import { MercadoPagoPaymentAdapter } from "../../payment/infrastructure/mercadopago-payment.adapter.js";
import { AsaasPaymentAdapter } from "../../payment/infrastructure/asaas-payment.adapter.js";
import { admitFiscalPaymentEvidence } from "../domain/fiscal-payment-evidence.port.js";
import { FiscalProviderFactory } from "./fiscal-provider.factory.js";
import { PrismaFiscalIssuanceStore } from "./prisma-fiscal-issuance.store.js";
import { PaymentIntentEntity } from "../../payment/domain/payment-intent.entity.js";
import { PrismaPaymentRepository } from "../../payment/infrastructure/prisma-payment.repository.js";
import { ConfirmCryptoPaymentUseCase } from "../../payment/application/confirm-crypto-payment.use-case.js";
import { EvmCryptoVerifier } from "../../payment/infrastructure/evm-crypto-verifier.js";
let f: Awaited<ReturnType<typeof createFiscalFixture>>;
before(
  async () => {
    f = await createFiscalFixture();
  },
  { timeout: 120000 }
);
after(async () => {
  await f?.close();
});
async function original(brand: string, production = false, hosted = false) {
  const sale = await seedFiscalSale(f, {
      issuance: true,
      ...(production ? { environment: "production" } : {}),
      ...(hosted
        ? { orderMerchantId: f.tag + "_host_" + crypto.randomUUID() }
        : {}),
    }),
    scope = { merchantId: sale.merchantId, environment: sale.environment };
  let calls = 0;
  const provider = new MercadoPagoPaymentAdapter(
    "https://api.mercadopago.com",
    "synthetic-original-mp-key",
    undefined,
    (async (_url, init) => {
      calls++;
      assert.equal(init?.method, "GET");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer synthetic-original-mp-key"
      );
      return Response.json({
        id: 123,
        external_reference: sale.snapshot.paymentProofRef,
        status: "approved",
        transaction_amount: 21.01,
        currency_id: "BRL",
        live_mode: false,
        payment_type_id: brand.startsWith("deb") ? "debit_card" : "credit_card",
        payment_method_id: brand,
        authorization_code: "MP_ORIGINAL_AUTH",
        date_approved: "2026-11-15T22:30:00-03:00",
      });
    }) as typeof fetch
  );
  const input = {
    merchantId: sale.orderMerchantId,
    sessionId: sale.completedOrder.sessionId,
    intentId: sale.snapshot.paymentProofRef!,
    amountCents: 2101,
    currency: "BRL",
    method: "card",
    provider: "mercadopago",
    providerAccountFingerprint: provider.creationAccountFingerprint(),
  };
  await f.prisma.paymentIntent.create({
    data: {
      id: input.intentId,
      merchantId: input.merchantId,
      sessionId: input.sessionId,
      idempotencyKey: input.intentId,
      amountCents: 2101,
      approvedAmountCents: 2101,
      currency: "BRL",
      method: "card",
      status: "approved",
      providerPaymentId: "123",
      creation: { state: "complete", input },
    },
  });
  const tenants = new TenantContextService(),
    db = registerTenantMiddleware(f.prisma, tenants),
    setup = new FiscalSetupService(
      db,
      new FiscalCredentialCipher({
        AACP_PII_ENC_KEY: "synthetic-reader-private-key",
      }),
      tenants
    );
  if (!hosted) await setup.save(
    scope,
    sale.connection.id,
    {
      fiscalTimeZone: "America/Sao_Paulo",
      paymentConfiguration: {
        ...(hosted
          ? { intentId: sale.intent.id }
          : { paymentIntentId: input.intentId }),
        confirmed: true,
        environment: "test",
        acquirerTaxId: "12345678000195",
      },
    },
    { actorKind: "merchant", actorId: "synthetic-authorized-owner" }
  );
  const reader = new FiscalPaymentEvidenceReader(db, provider, setup, tenants),
    context = (
      await new PrismaFiscalIssuanceStore(db).readOnly(scope, sale.intent.id)
    ).context;
  const factory = new FiscalProviderFactory({
    credential: async () => {
      throw new Error("not used by builder");
    },
    authorization: { read: async () => null },
    accountEvidence: { read: async () => null },
  });
  return {
    sale,
    reader,
    setup,
    tenants,
    scope,
    calls: () => calls,
    build: async () =>
      factory.build(
        context,
        new Date().toISOString(),
        admitFiscalPaymentEvidence(
          sale.snapshot,
          await reader.read(sale.snapshot)
        )
      ),
  };
}

test("FISCAL-24 FI-D16 rejects foreign payment traversal while retaining its original private binding", async () => {
  const a = await original("visa", false, true);
  await a.tenants.run(
    {
      merchantId: a.sale.merchantId,
      userId: "original_seller_owner",
      role: "owner",
    },
    async () => {
      await assert.rejects(a.setup.save(
        a.scope,
        a.sale.connection.id,
        {
          paymentConfiguration: {
            intentId: a.sale.intent.id,
            confirmed: true,
            environment: "test",
            acquirerTaxId: "12345678000195",
          },
        },
        { actorKind: "merchant", actorId: "original_seller_owner" }
      ), /fiscal_order_scope_unsupported/);
      await assert.rejects(a.reader.read(a.sale.snapshot), /fiscal_order_scope_unsupported/);
      await assert.rejects(a.setup.paymentSources(a.scope, a.sale.intent.id), /fiscal_order_scope_unsupported/);
      assert.equal(a.sale.snapshot.totalCents, 2101); assert.equal(a.calls(), 0);
    }
  );
});
for (const [brand, band, method] of [
  ["visa", "01", "03"],
  ["master", "02", "03"],
  ["debmaster", "02", "04"],
  ["diners", "05", "03"],
])
  test(`FISCAL-16/19 actual authenticated MP ${brand} reader produces documented Focus brand${band} payment${method}`, async () => {
    const a = await original(brand);
    const payload = await a.build();
    const payment = (payload.formas_pagamento as any[])[0];
    assert.equal(payment.bandeira_operadora, band);
    assert.equal(payment.forma_pagamento, method);
    assert.equal(payment.numero_autorizacao, "MP_ORIGINAL_AUTH");
    assert.equal(payment.valor_pagamento, 21.01);
    assert.equal(payment.data_pagamento, "2026-11-15");
    assert.equal(a.calls(), 1);
  });
test("FISCAL-19 actual unknown provider card brand remains specific merchant pending without fake code", async () => {
  const a = await original("unmapped");
  await assert.rejects(a.build(), /card_brand_unavailable/);
  assert.equal(a.calls(), 1);
});
test("FISCAL-04 actual trusted test PSP original cannot build production fiscal payload", async () => {
  const a = await original("master", true);
  await assert.rejects(a.build(), /environment_mismatch/);
  assert.equal(a.calls(), 1);
  assert.equal(
    await f.prisma.fiscalProviderStageReceipt.count({
      where: { intentId: a.sale.intent.id },
    }),
    0
  );
});
test("FISCAL-16/19 actual authenticated Asaas Pix E2E maps to Omie documented NSU/TID field while private receipt retains E2E semantics", async () => {
  const rules = {
    currency: "BRL",
    supportedProductTypes: ["physical"],
    items: {
      shirt: {
        productType: "physical",
        ncm: "61091000",
        cfop: "5102",
        origin: "0",
        unit: "UN",
        taxes: { "icms_sn.cod_sit_trib_icms_sn": "102" },
      },
    },
    operation: {
      etapa: "10",
      codigoParcela: "001",
      codigoCenarioImpostos: 1,
      codigoCategoria: "1.01",
      codigoContaCorrente: 1,
      modalidadeFrete: "0",
      contribuinte: "N",
      indPresenca: "2",
      indIntermediario: "0",
      timeZone: "America/Sao_Paulo",
      products: { shirt: { productId: 11 } },
    },
  };
  const sale = await seedFiscalSale(f, {
      issuance: true,
      provider: "omie",
      profileItemRules: rules,
    }),
    scope = { merchantId: sale.merchantId, environment: sale.environment },
    e2e = "E1234567820261116000000000000000";
  const provider = new AsaasPaymentAdapter(
    "https://api-sandbox.asaas.com",
    "synthetic-original-pix-key",
    (async (url, init) => {
      assert.equal(init?.method ?? "GET", "GET");
      assert.equal(
        new Headers(init?.headers).get("access_token"),
        "synthetic-original-pix-key"
      );
      return Response.json(
        String(url).includes("/pix/transactions/")
          ? {
              id: "pix_original",
              status: "DONE",
              type: "CREDIT",
              value: 21.01,
              effectiveDate: "2026-11-15 22:30:00",
              endToEndIdentifier: e2e,
              originType: "DYNAMIC_QRCODE",
            }
          : {
              id: "pay_original",
              object: "payment",
              externalReference: sale.snapshot.paymentProofRef,
              customer: "cus_original",
              value: 21.01,
              status: "RECEIVED",
              billingType: "PIX",
              pixTransaction: "pix_original",
            }
      );
    }) as typeof fetch
  );
  const input = {
    merchantId: sale.merchantId,
    sessionId: sale.completedOrder.sessionId,
    intentId: sale.snapshot.paymentProofRef!,
    amountCents: 2101,
    currency: "BRL",
    method: "pix",
    provider: "asaas",
    asaasCustomerId: "cus_original",
    providerAccountFingerprint: provider.creationAccountFingerprint(),
  };
  await f.prisma.paymentIntent.create({
    data: {
      id: input.intentId,
      merchantId: input.merchantId,
      sessionId: input.sessionId,
      idempotencyKey: input.intentId,
      amountCents: 2101,
      approvedAmountCents: 2101,
      currency: "BRL",
      method: "pix",
      status: "approved",
      providerPaymentId: "pay_original",
      creation: { state: "complete", input },
    },
  });
  const tenants = new TenantContextService(),
    setup = new FiscalSetupService(
      f.prisma,
      new FiscalCredentialCipher({ AACP_PII_ENC_KEY: "synthetic-reader-key" }),
      tenants
    );
  await setup.save(
    scope,
    sale.connection.id,
    {
      fiscalTimeZone: "America/Sao_Paulo",
      paymentConfiguration: {
        paymentIntentId: input.intentId,
        confirmed: true,
        environment: "test",
        acquirerTaxId: "12345678000195",
        providerTimeZone: "America/Sao_Paulo",
      },
    },
    { actorKind: "merchant", actorId: "authorized_owner" }
  );
  const evidence = await new FiscalPaymentEvidenceReader(
    f.prisma,
    provider,
    setup,
    tenants
  ).read(sale.snapshot);
  assert.equal(evidence.receipt.authorizationKind, "pix_end_to_end");
  assert.equal(evidence.receipt.authorizationCode, e2e);
  assert.equal(evidence.receipt.nsu, undefined);
  const context = (
    await new PrismaFiscalIssuanceStore(f.prisma).readOnly(
      scope,
      sale.intent.id
    )
  ).context;
  const factory = new FiscalProviderFactory({
    credential: async () => "unused",
    authorization: { read: async () => null },
    accountEvidence: { read: async () => null },
  });
  const payload = factory.build(
    context,
    "2026-11-16T01:30:00Z",
    admitFiscalPaymentEvidence(sale.snapshot, evidence)
  ) as any;
  assert.equal(payload.order.informacoes_adicionais.nsu, e2e);
  assert.equal(payload.order.informacoes_adicionais.meio_pagamento, "17");
  assert.equal(payload.order.cabecalho.nao_gerar_boleto, "S");
  assert.equal(payload.order.cabecalho.data_previsao, "15/11/2026");
});

async function confirmedCrypto(
  timestampAvailable: boolean,
  options: {
    merchantId?: string;
    connectionId?: string;
    amountAtomic?: string;
    expiryMs?: number;
    destinationAddress?: string;
    tokenAddress?: string;
    chain?: "base" | "polygon";
    network?: "mainnet" | "testnet";
  } = {}
) {
  const sale = await seedFiscalSale(f, {
      issuance: true,
      merchantId: options.merchantId,
      connectionId: options.connectionId,
    }),
    scope = { merchantId: sale.merchantId, environment: sale.environment };
  const txHash = "0x" + crypto.randomUUID().replaceAll("-", "").repeat(2),
    blockHash = "0x" + "2".repeat(64),
    from = "0x" + "3".repeat(40),
    to = options.destinationAddress ?? "0x" + "4".repeat(40),
    token = options.tokenAddress ?? "0x" + "5".repeat(40);
  const quote = {
    chainId:
      options.chain === "polygon"
        ? 80002
        : options.network === "mainnet"
        ? 8453
        : 84532,
    chain: options.chain ?? "base",
    evmNetwork: options.network ?? "testnet",
    chainLabel: "Base Sepolia",
    tokenAddress: token,
    tokenSymbol: "USDC" as const,
    amountAtomic: options.amountAtomic ?? "1000000",
    amountDisplay: options.amountAtomic === "2000000" ? "2" : "1",
    destinationAddress: to,
    quoteExpiresAt: new Date(
      Date.now() + (options.expiryMs ?? 3600000)
    ).toISOString(),
  };
  const created = PaymentIntentEntity.create({
    merchantId: sale.merchantId,
    sessionId: sale.completedOrder.sessionId,
    idempotencyKey: crypto.randomUUID(),
    amountCents: 2101,
    currency: "BRL",
    method: "crypto",
  });
  const entity = PaymentIntentEntity.rehydrate({
    ...created.snapshot(),
    id: sale.snapshot.paymentProofRef!,
  });
  entity.prepareCreation({
    merchantId: sale.merchantId,
    sessionId: sale.completedOrder.sessionId,
    intentId: entity.id,
    amountCents: 2101,
    currency: "BRL",
    method: "crypto",
    provider: "crypto",
  });
  entity.claimCreation("original_crypto", new Date());
  entity.markRequiresAction({ providerPaymentId: "crypto_" + entity.id });
  entity.setBuyerFacingPayload(quote);
  entity.completeCreation("original_crypto");
  const repository = new PrismaPaymentRepository(f.prisma);
  await repository.saveIntent({ intent: entity });
  const rpcKey =
    quote.chain === "polygon"
      ? "POLYGON_AMOY_RPC_URL"
      : quote.evmNetwork === "mainnet"
      ? "BASE_RPC_URL"
      : "BASE_SEPOLIA_RPC_URL";
  const oldFetch = globalThis.fetch,
    oldRpc = process.env[rpcKey];
  process.env[rpcKey] = "https://synthetic-original-rpc.example.test";
  globalThis.fetch = (async (_url, init) => {
    const r = JSON.parse(String(init?.body));
    if (r.method === "eth_getBlockByHash" && !timestampAvailable)
      return Response.json({
        jsonrpc: "2.0",
        id: r.id,
        error: {
          code: -32000,
          message: "synthetic block metadata unavailable",
        },
      });
    const log = {
      address: token,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x" + from.slice(2).padStart(64, "0"),
        "0x" + to.slice(2).padStart(64, "0"),
      ],
      data: "0x" + BigInt(quote.amountAtomic).toString(16).padStart(64, "0"),
      blockHash,
      blockNumber: "0x10",
      transactionHash: txHash,
      transactionIndex: "0x0",
      logIndex: "0x0",
      removed: false,
    };
    const receipt = {
      transactionHash: txHash,
      blockHash,
      blockNumber: "0x10",
      status: "0x1",
      type: "0x2",
      from,
      to: token,
      cumulativeGasUsed: "0x5208",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x1",
      transactionIndex: "0x0",
      logsBloom: "0x" + "0".repeat(512),
      logs: [log],
    };
    return Response.json({
      jsonrpc: "2.0",
      id: r.id,
      result:
        r.method === "eth_getTransactionReceipt"
          ? receipt
          : r.method === "eth_blockNumber"
          ? "0x100"
          : {
              hash: blockHash,
              number: "0x10",
              timestamp:
                "0x" +
                Math.floor(Date.parse("2026-11-16T01:30:00Z") / 1000).toString(
                  16
                ),
              transactions: [],
            },
    });
  }) as typeof fetch;
  try {
    assert.equal(
      (
        await new ConfirmCryptoPaymentUseCase(
          repository,
          new EvmCryptoVerifier()
        ).execute({
          merchant_id: sale.merchantId,
          session_id: sale.completedOrder.sessionId,
          intent_id: entity.id,
          tx_hash: txHash,
          wallet_address: from,
        })
      ).status,
      "approved"
    );
  } finally {
    globalThis.fetch = oldFetch;
    if (oldRpc === undefined) delete process.env[rpcKey];
    else process.env[rpcKey] = oldRpc;
  }
  const row = await f.prisma.paymentIntent.findUniqueOrThrow({
    where: { id: entity.id },
  });
  assert.equal(row.status, "approved");
  assert.equal((row.privateReceipt as any).transfers[0].txHash, txHash);
  assert.equal(
    (await repository.getIntentById(sale.merchantId, entity.id))!
      .snapshot()
      .hasOwnProperty("privateReceipt"),
    false
  );
  await assert.rejects(
    f.prisma.paymentIntent.update({
      where: { id: entity.id },
      data: { privateReceipt: { replaced: true } },
    }),
    /private_payment_receipt_immutable/
  );
  return { sale, scope, quote, entity, row, repository };
}

for (const timestampAvailable of [false, true])
  test(`FISCAL-19 actual crypto confirmation persists original onchain receipt and ${
    timestampAvailable
      ? "admits configured other-payment classification"
      : "keeps approved payment while fiscal timestamp is pending"
  }`, async () => {
    const { sale, scope, entity } = await confirmedCrypto(timestampAvailable);
    const tenants = new TenantContextService(),
      setup = new FiscalSetupService(
        f.prisma,
        new FiscalCredentialCipher({
          AACP_PII_ENC_KEY: "synthetic-crypto-setup-key",
        }),
        tenants
      );
    await setup.save(
      scope,
      sale.connection.id,
      {
        fiscalTimeZone: "America/Sao_Paulo",
        paymentConfiguration: {
          paymentIntentId: entity.id,
          confirmed: true,
          environment: "testnet",
          cryptoDescription: "USDC recebido na Base Sepolia",
        },
      },
      { actorKind: "merchant", actorId: "original_owner" }
    );
    const reader = new FiscalPaymentEvidenceReader(
      f.prisma,
      {} as any,
      setup,
      tenants
    );
    if (!timestampAvailable)
      await assert.rejects(
        reader.read(sale.snapshot),
        /crypto_payment_time_unavailable/
      );
    else {
      const evidence = admitFiscalPaymentEvidence(
        sale.snapshot,
        await reader.read(sale.snapshot)
      );
      assert.equal(evidence.code, "99");
      assert.equal(evidence.fiscalDate, "2026-11-15");
      assert.equal(evidence.authorizationCode, undefined);
      assert.equal(evidence.acquirerTaxId, undefined);
    }
  });

test("FISCAL-19 one responsible crypto classification serves later original paid quotes while foreign receiving accounts remain pending", async () => {
  const first = await confirmedCrypto(true),
    tenants = new TenantContextService();
  const setup = new FiscalSetupService(
    f.prisma,
    new FiscalCredentialCipher({
      AACP_PII_ENC_KEY: "synthetic-stable-crypto-account",
    }),
    tenants
  );
  await setup.save(
    first.scope,
    first.sale.connection.id,
    {
      fiscalTimeZone: "America/Sao_Paulo",
      paymentConfiguration: {
        paymentIntentId: first.entity.id,
        confirmed: true,
        environment: "testnet",
        cryptoDescription: "USDC recebido na conta original",
      },
    },
    { actorKind: "merchant", actorId: "original_owner" }
  );
  const reader = new FiscalPaymentEvidenceReader(
    f.prisma,
    {} as any,
    setup,
    tenants
  );
  assert.equal(
    admitFiscalPaymentEvidence(
      first.sale.snapshot,
      await reader.read(first.sale.snapshot)
    ).code,
    "99"
  );
  const originalSetup = await f.prisma.fiscalConnection.findUniqueOrThrow({
    where: { id: first.sale.connection.id },
  });
  const binding = {
    merchantId: first.sale.merchantId,
    connectionId: first.sale.connection.id,
  };
  const second = await confirmedCrypto(true, {
    ...binding,
    amountAtomic: "2000000",
    expiryMs: 7200000,
  });
  assert.notEqual(first.quote.amountAtomic, second.quote.amountAtomic);
  assert.notEqual(first.quote.quoteExpiresAt, second.quote.quoteExpiresAt);
  assert.notEqual(first.entity.id, second.entity.id);
  assert.equal(
    admitFiscalPaymentEvidence(
      second.sale.snapshot,
      await reader.read(second.sale.snapshot)
    ).code,
    "99"
  );
  assert.equal(
    (
      await f.prisma.fiscalConnection.findUniqueOrThrow({
        where: { id: first.sale.connection.id },
      })
    ).setupCipher,
    originalSetup.setupCipher
  );
  for (const changed of [
    { destinationAddress: "0x" + "6".repeat(40) },
    { tokenAddress: "0x" + "7".repeat(40) },
    { chain: "polygon" as const },
    { network: "mainnet" as const },
  ]) {
    const foreign = await confirmedCrypto(true, { ...binding, ...changed });
    await assert.rejects(
      reader.read(foreign.sale.snapshot),
      /crypto_classification_required|environment_mismatch/
    );
    assert.equal(
      (
        await f.prisma.paymentIntent.findUniqueOrThrow({
          where: { id: foreign.entity.id },
        })
      ).status,
      "approved"
    );
  }
});


test("FISCAL-24 own-store identity cannot import persisted split funding into fiscal evidence or setup", async () => {
  const a = await original("visa");
  const row = await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: a.sale.snapshot.paymentProofRef! } });
  const creation = row.creation as any;
  await f.prisma.paymentIntent.update({ where: { id: row.id }, data: { creation: { ...creation, input: { ...creation.input, marketplaceFunding: { environment: "test", accountFingerprint: "foreign_account" } } } } });
  await assert.rejects(a.reader.read(a.sale.snapshot), /fiscal_order_scope_unsupported/);
  await assert.rejects(a.setup.save(a.scope, a.sale.connection.id, { paymentConfiguration: { paymentIntentId: row.id, confirmed: true, environment: "test", acquirerTaxId: "12345678000195" } }, { actorKind: "merchant", actorId: "owner" }), /fiscal_order_scope_unsupported/);
  assert.deepEqual(await a.setup.paymentSources(a.scope), []); assert.equal(a.calls(), 0);
  assert.equal((await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: row.id } })).amountCents, 2101);
});
