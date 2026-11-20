import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import {
  fiscalXmlFixture,
  fiscalPdfFixture,
} from "../../../../tests/fiscal-artifact-fixtures.js";
import { FiscalCredentialCipher } from "./fiscal-credential-cipher.js";
import {
  executeFiscalHomologation,
  homologationBindingHash,
  type FiscalHomologationOperation,
} from "./fiscal-homologation.js";
import type { FiscalPaymentEvidence } from "../domain/fiscal-payment-evidence.port.js";
let fixture: Awaited<ReturnType<typeof createFiscalFixture>>;
let guard: Parameters<typeof executeFiscalHomologation>[2]["guard"];
const env = {
  ...process.env,
  AACP_PII_ENC_KEY: "synthetic-homologation-private-key",
};
before(async () => {
  fixture = await createFiscalFixture();
  guard = (
    await import(
      new URL("../../../../scripts/fiscal-homologation.mjs", import.meta.url)
        .href
    )
  ).guardHomologationFetch;
});
after(async () => {
  await fixture?.close();
});
async function arrange(
  options: {
    contacts?: boolean;
    approved?: boolean;
    provider?: "focus" | "bling" | "omie" | "tiny";
  } = {}
) {
  const provider = options.provider ?? "focus";
  const sale = await seedFiscalSale(fixture, {
    provider,
    issuance: true,
    orderId: "fiscal_hml_" + randomUUID().replaceAll("-", ""),
    buyerEmail: null,
    ...(!options.contacts ? { buyerPhone: null } : {}),
    profileSourceContractVersion: {
      focus: "focus-nfe-v2-2026-11",
      bling: "bling-v3-2026-11",
      omie: "omie-app-v1-2026-11",
      tiny: "olist-v3-2026-11",
    }[provider],
  });
  const operation: FiscalHomologationOperation = {
    mode: "emit",
    provider,
    environment: "homologation",
    merchantId: sale.merchantId,
    intentId: sale.intent.id,
    schema: fixture.schema,
    operationId: randomUUID().replaceAll("-", ""),
  };
  const evidence: FiscalPaymentEvidence = {
    binding: {
      merchantId: sale.orderMerchantId,
      proofRef: sale.snapshot.paymentProofRef!,
      provider: "stripe",
      accountId: "local-synthetic-account",
      environment: "test",
      operationId: "local-synthetic-operation",
      amountCents: 2101,
      currency: "BRL",
    },
    receipt: {
      merchantId: sale.orderMerchantId,
      provider: "stripe",
      accountId: "local-synthetic-account",
      environment: "test",
      operationId: "local-synthetic-operation",
      amountCents: 2101,
      currency: "BRL",
      captured: true,
      instrument: "credit",
      acquirerTaxId: "12345678000195",
      authorizationCode: "LOCAL123",
      brandCode: "01",
      paidAt: sale.snapshot.completedAt.toISOString(),
      evidenceReference: "local-homologation:synthetic",
    },
  };
  const cipher = new FiscalCredentialCipher(env);
  await fixture.prisma.fiscalConnection.update({
    where: { id: sale.connection.id },
    data: {
      isActive: true,
      activatedAt: new Date("2026-11-14T11:59:00Z"),
      credentialCipher: cipher.encrypt("synthetic-company-token"),
      setupCipher: cipher.encrypt(
        JSON.stringify({
          companyId: "company-original",
          updatedAt: new Date().toISOString(),
          updatedBy: "local-setup",
        })
      ),
    },
  });
  await fixture.prisma.paymentIntent.create({
    data: {
      id: sale.snapshot.paymentProofRef!,
      merchantId: sale.orderMerchantId,
      sessionId: sale.completedOrder.sessionId,
      idempotencyKey: operation.operationId,
      amountCents: 2101,
      approvedAmountCents: options.approved === false ? null : 2101,
      currency: "BRL",
      method: "card",
      status: options.approved === false ? "pending" : "approved",
      commerceOrderId: sale.orderId,
      creation: {
        kind: "local_homologation_setup",
        operationId: operation.operationId,
      },
      privateReceipt: {
        kind: "fiscal_local_homologation_v1",
        operationId: operation.operationId,
        evidence,
      } as any,
    },
  });
  await fixture.prisma.fiscalEvent.create({
    data: {
      merchantId: sale.merchantId,
      environment: sale.environment,
      intentId: sale.intent.id,
      actorKind: "local_homologation",
      actorId: operation.operationId,
      action: "homologation.prepared",
      providerEvidenceRef: homologationBindingHash({
        schema: fixture.schema,
        operationId: operation.operationId,
        merchantId: sale.merchantId,
        intentId: sale.intent.id,
        reference: sale.intent.stableReference,
        snapshotHash: sale.snapshot.contentHash,
        paymentId: sale.snapshot.paymentProofRef!,
      }),
    },
  });
  const calls: Array<{ url: string; method: string; body: any }> = [];
  let submitted = false;
  let verified = true;
  let missingPdf = false;
  const pdf = await fiscalPdfFixture();
  const fetcher = (async (url, init) => {
    const u = String(url),
      method = init?.method ?? "GET";
    calls.push({
      url: u,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (u === "https://api.focusnfe.com.br/v2/empresas/company-original")
      return Response.json({
        id: "company-original",
        cnpj: sale.connection.issuerTaxId,
        certificado_cnpj: sale.connection.issuerTaxId,
        certificado_valido_de: "2026-01-01",
        certificado_valido_ate: "2030-01-01",
        token_homologacao: verified ? "synthetic-company-token" : "foreign",
        habilita_nfe: true,
        enviar_email_destinatario: false,
        enviar_email_homologacao: false,
      });
    if (u.endsWith("/nota.xml"))
      return new Response(fiscalXmlFixture(sale.connection.issuerTaxId), {
        headers: { "content-type": "application/xml" },
      });
    if (u.endsWith("/danfe.pdf"))
      return missingPdf
        ? new Response(null, { status: 503 })
        : new Response(pdf, { headers: { "content-type": "application/pdf" } });
    if (method === "POST") {
      submitted = true;
      return Response.json(
        { status: "processando_autorizacao" },
        { status: 202 }
      );
    }
    if (!submitted) return Response.json({}, { status: 404 });
    return Response.json({
      ref: sale.intent.stableReference,
      cnpj_emitente: sale.connection.issuerTaxId,
      status: "autorizado",
      numero: "22",
      serie: "1",
      chave_nfe:
        "NFe" +
        "352611" +
        sale.connection.issuerTaxId +
        "550010000000221123456780",
      protocolo_nota_fiscal: {
        ambiente: "2",
        numero_protocolo: "151260029467289",
        data_recebimento: "2026-11-14T15:00:00Z",
      },
      caminho_xml_nota_fiscal: "/nota.xml",
      caminho_danfe: "/danfe.pdf",
    });
  }) as typeof fetch;
  return {
    sale,
    operation,
    calls,
    fetcher,
    setVerified: (v: boolean) => {
      verified = v;
    },
    setMissingPdf: () => {
      missingPdf = true;
    },
    run: (op = operation) =>
      executeFiscalHomologation(fixture.prisma, op, { env, fetcher, guard }),
  };
}
test("FISCAL-04 homologation preflight leaves persisted operation unchanged and makes zero provider calls", async () => {
  const a = await arrange();
  const before = await fixture.prisma.fiscalIntent.findUniqueOrThrow({
    where: { id: a.sale.intent.id },
  });
  const events = await fixture.prisma.fiscalEvent.count();
  const result = await a.run({ ...a.operation, mode: "preflight" });
  assert.equal(result.code, 2);
  assert.equal(result.report.status, "not_run");
  assert.equal(a.calls.length, 0);
  assert.deepEqual(
    await fixture.prisma.fiscalIntent.findUniqueOrThrow({
      where: { id: a.sale.intent.id },
    }),
    before
  );
  assert.equal(await fixture.prisma.fiscalEvent.count(), events);
});
test("FISCAL-19 homologation executes real persisted worker stages and private files without customer IO", async () => {
  const a = await arrange();
  const result = await a.run();
  assert.equal(result.code, 0);
  assert.equal(result.report.status, "local_contract_authorized");
  assert.equal(result.report.evidenceMode, "local_contract");
  assert.equal(result.report.state, "authorized");
  assert.equal(result.report.artifacts?.length, 2);
  assert.equal(a.calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(
    a.calls.filter((c) => c.method === "POST")[0].url,
    "https://homologacao.focusnfe.com.br/v2/nfe?ref=" +
      a.sale.intent.stableReference
  );
  assert.equal(
    a.calls.filter((c) => c.method === "POST")[0].body.email_destinatario,
    undefined
  );
  const stages = await fixture.prisma.fiscalProviderStageReceipt.findMany({
    where: { intentId: a.sale.intent.id },
  });
  assert.equal(stages.length, 1);
  assert.equal(stages[0].stage, "invoice.submit");
  assert.equal(stages[0].outcome, "accepted");
  const document = await fixture.prisma.fiscalDocument.findFirstOrThrow({
    where: { intentId: a.sale.intent.id },
  });
  assert.equal(document.authorizationProtocol, "151260029467289");
  assert.equal(document.documentState, "available");
  const channels = await fixture.prisma.fiscalDelivery.findMany({
    where: { documentId: document.id },
  });
  assert.equal(channels.length, 2);
  assert.ok(
    channels.every(
      (c) =>
        c.state === "blocked" &&
        c.attempts === 0 &&
        c.transportProvider === null
    )
  );
  assert.equal(
    JSON.stringify(result.report).includes("synthetic-company-token"),
    false
  );
  assert.equal(JSON.stringify(result.report).includes("52998224725"), false);
});
test("FISCAL-17 homologation replay retains one original invoice submission", async () => {
  const a = await arrange();
  await a.run();
  const result = await a.run();
  assert.equal(result.report.state, "authorized");
  assert.equal(a.calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(
    await fixture.prisma.fiscalDocument.count({
      where: { intentId: a.sale.intent.id },
    }),
    1
  );
});
test("FISCAL-04 homologation target does not drain older same merchant other tenant or production work", async () => {
  const a = await arrange();
  const others = [];
  for (const options of [
    { merchantId: a.sale.merchantId },
    { environment: "production" as const },
    {},
  ])
    others.push(await seedFiscalSale(fixture, { issuance: true, ...options }));
  const before = await fixture.prisma.fiscalIntent.findMany({
    where: { id: { in: others.map((o) => o.intent.id) } },
  });
  await a.run();
  assert.deepEqual(
    await fixture.prisma.fiscalIntent.findMany({
      where: { id: { in: others.map((o) => o.intent.id) } },
    }),
    before
  );
  assert.equal(
    await fixture.prisma.fiscalProviderStageReceipt.count({
      where: { intentId: { in: others.map((o) => o.intent.id) } },
    }),
    0
  );
  assert.equal(
    await fixture.prisma.fiscalEvent.count({
      where: { intentId: { in: others.map((o) => o.intent.id) } },
    }),
    0
  );
});
test("FISCAL-04 homologation requires authenticated company environment before any fiscal stage write", async () => {
  const a = await arrange();
  a.setVerified(false);
  const before = await fixture.prisma.fiscalIntent.findUniqueOrThrow({
    where: { id: a.sale.intent.id },
  });
  const result = await a.run();
  assert.equal(result.code, 2);
  assert.equal(result.report.status, "blocked");
  assert.equal(a.calls.filter((c) => c.method === "POST").length, 0);
  assert.deepEqual(
    await fixture.prisma.fiscalIntent.findUniqueOrThrow({
      where: { id: a.sale.intent.id },
    }),
    before
  );
  assert.equal(
    await fixture.prisma.fiscalProviderStageReceipt.count({
      where: { intentId: a.sale.intent.id },
    }),
    0
  );
});
test("FISCAL-04 homologation another operation marker cannot authorize a synthetic payment", async () => {
  const a = await arrange();
  await assert.rejects(
    a.run({ ...a.operation, operationId: "0".repeat(32) }),
    /synthetic_payment_required/
  );
  assert.equal(a.calls.length, 0);
});
test("FISCAL-61 homologation rejects any persisted customer communication destination", async () => {
  const a = await arrange({ contacts: true });
  await assert.rejects(a.run(), /communications_forbidden/);
  assert.equal(a.calls.length, 0);
});
test("FISCAL-04 homologation production request fails before database mutation", async () => {
  const a = await arrange();
  await assert.rejects(
    a.run({ ...a.operation, environment: "production" as any }),
    /binding_invalid/
  );
  assert.equal(a.calls.length, 0);
});
test("FISCAL-04 homologation pending financial payment is never manufactured as paid", async () => {
  const a = await arrange({ approved: false });
  await assert.rejects(a.run(), /synthetic_payment_required/);
  assert.equal(a.calls.length, 0);
});
test("FISCAL-66 homologation missing DANFE remains pending with genuine authorized result", async () => {
  const a = await arrange();
  a.setMissingPdf();
  const result = await a.run();
  assert.equal(result.code, 3);
  assert.equal(result.report.status, "pending");
  assert.equal(result.report.state, "authorized");
  assert.equal(result.report.documentState, "document_pending");
  assert.equal(result.report.artifacts?.length, 1);
});
for (const provider of ["bling", "omie", "tiny"] as const)
  test(`FISCAL-04 homologation ${provider} local environment enum cannot authorize an external write`, async () => {
    const a = await arrange({ provider });
    const result = await a.run();
    assert.equal(result.code, 2);
    assert.equal(result.report.status, "blocked");
    assert.equal(
      result.report.reason,
      "fiscal_homologation_effective_provider_environment_unverified"
    );
    assert.equal(a.calls.length, 0);
    assert.equal(
      await fixture.prisma.fiscalProviderStageReceipt.count({
        where: { intentId: a.sale.intent.id },
      }),
      0
    );
  });
