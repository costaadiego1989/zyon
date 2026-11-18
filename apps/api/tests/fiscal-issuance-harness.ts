import assert from "node:assert/strict";
import type { createFiscalFixture } from "./fiscal-fixture.js";
import type { Prisma } from "@prisma/client";
import { seedFiscalSale } from "./fiscal-schema-seed.js";
import { PrismaFiscalRepository } from "../src/modules/fiscal/infrastructure/prisma-fiscal.repository.js";
import { PrismaFiscalIssuanceStore } from "../src/modules/fiscal/infrastructure/prisma-fiscal-issuance.store.js";
import { FiscalIssuanceService } from "../src/modules/fiscal/application/fiscal-issuance.service.js";
import { FiscalProviderFactory } from "../src/modules/fiscal/infrastructure/fiscal-provider.factory.js";
import type { FiscalPaymentEvidence } from "../src/modules/fiscal/domain/fiscal-payment-evidence.port.js";
import { admitFiscalPaymentEvidence } from "../src/modules/fiscal/domain/fiscal-payment-evidence.port.js";
import { fiscalObjectFingerprint } from "../src/modules/fiscal/infrastructure/providers/omie-fiscal.payload.js";
export async function arrangeIssuance(fixture: Awaited<ReturnType<typeof createFiscalFixture>>, options: { merchantId?: string; buyerGlobalUserId?: string; orderTotalCents?: number; orderLineItems?: Prisma.InputJsonValue; orderMerchantId?: string; orderId?: string; instrument?: FiscalPaymentEvidence["receipt"]["instrument"]; provider?: "focus" | "omie" | "bling" | "tiny"; stockOwner?: string; guestBuyer?: boolean; approvedAmountCents?: number; emailOwner?: "zyon" | "provider"; buyerEmail?: string | null; profileItemRules?: Prisma.InputJsonObject } = {}) {
  const sale = await seedFiscalSale(fixture, { merchantId: options.merchantId, buyerGlobalUserId: options.buyerGlobalUserId, orderTotalCents: options.orderTotalCents, orderLineItems: options.orderLineItems, orderMerchantId: options.orderMerchantId, orderId: options.orderId, provider: options.provider ?? "focus", issuance: true, stockOwner: options.stockOwner, approvedAmountCents: options.approvedAmountCents, guestBuyer: options.guestBuyer, emailOwner: options.emailOwner, buyerEmail: options.buyerEmail, profileItemRules: options.profileItemRules });
  const scope = { merchantId: sale.merchantId, environment: sale.environment };
  const repo = new PrismaFiscalRepository(fixture.prisma);
  const evidence: FiscalPaymentEvidence = { binding: { merchantId: sale.orderMerchantId, proofRef: sale.snapshot.paymentProofRef!, provider: "stripe", accountId: "acct_original", environment: "test", operationId: "pi_original", amountCents: options.approvedAmountCents ?? 2101, currency: "BRL" },
    receipt: { merchantId: sale.orderMerchantId, provider: "stripe", accountId: "acct_original", environment: "test", operationId: "pi_original", amountCents: options.approvedAmountCents ?? 2101, currency: "BRL", captured: true,
      instrument: options.instrument ?? "credit", acquirerTaxId: "12345678000195", authorizationCode: "ABC123", nsu: "TID_original", brandCode: "01", paidAt: "2026-11-14T12:00:00Z", evidenceReference: "stripe:charge:ch_original" } };
  const credentialScopes: import("../src/modules/fiscal/domain/fiscal-provider.js").FiscalScope[] = [];
  let artifacts: { xml?: Uint8Array; pdf?: Uint8Array } = {};
  const calls: { url: string; method: string; body?: Record<string, any>; authorization: string | null }[] = [];
  let remote: "absent" | "processing" | "authorized" | "rejected" | "cancelled" = "absent";
  let behavior: "normal" | "timeout" | "429" = "normal";
  let cancellationBehavior: "normal" | "timeout" | "422" = "normal";
  let cancellationXml: string | undefined;
  const factory = new FiscalProviderFactory({ credential: async scope => { credentialScopes.push({ ...scope }); return "private_company_token"; }, authorization: { read: async () => null }, accountEvidence: { read: async () => null },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET"; const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: String(url), method, body, authorization: new Headers(init?.headers).get("authorization") });
      if (String(url).endsWith("/nota.xml")) return artifacts.xml ? new Response(artifacts.xml, { headers: { "content-type": "application/xml" } }) : Response.json({}, { status: 404 });
      if (String(url).endsWith("/danfe.pdf")) return artifacts.pdf ? new Response(artifacts.pdf, { headers: { "content-type": "application/pdf" } }) : Response.json({}, { status: 404 });
      if (String(url).endsWith("/cancelamento.xml")) return new Response(cancellationXml ?? `<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe"><retEvento><infEvento><tpAmb>2</tpAmb><chNFe>${"352611" + sale.connection.issuerTaxId + "550010000000221123456780"}</chNFe><tpEvento>110111</tpEvento><cStat>135</cStat><nProt>151260029467299</nProt><dhRegEvento>2026-11-15T15:00:00Z</dhRegEvento></infEvento></retEvento></procEventoNFe>`, { headers: { "content-type": "application/xml" } });
      if (method === "DELETE") { if (cancellationBehavior === "timeout") throw new Error("synthetic lost cancellation acceptance"); return Response.json({ status: "processando_cancelamento" }, { status: cancellationBehavior === "422" ? 422 : 202 }); }
      if (method === "POST") {
        if (behavior === "429") return Response.json({}, { status: 429, headers: { "retry-after": "120" } });
        remote = "processing";
        if (behavior === "timeout") throw new Error("lost after acceptance with private_company_token");
        return Response.json({ status: "processando_autorizacao" }, { status: 202 });
      }
      if (remote === "absent") return Response.json({}, { status: 404 });
      return Response.json({ ref: sale.intent.stableReference, cnpj_emitente: sale.connection.issuerTaxId,
        caminho_xml_nota_fiscal: "/nota.xml", caminho_danfe: "/danfe.pdf", caminho_xml_cancelamento: "/cancelamento.xml", status: remote === "cancelled" ? "cancelado" : remote === "authorized" ? "autorizado" : remote === "rejected" ? "erro_autorizacao" : "processando_autorizacao", status_sefaz: "598", numero: "22", serie: "1",
        chave_nfe: "NFe" + "352611" + sale.connection.issuerTaxId + "55" + "001" + "000000022" + "1" + "12345678" + "0",
        protocolo_nota_fiscal: { ambiente: "2", numero_protocolo: "151260029467289", data_recebimento: "2026-11-14T12:00:00-03:00" } });
    }) as typeof fetch });
  const payments = { read: async () => evidence };
  const store = new PrismaFiscalIssuanceStore(fixture.prisma);
  const service = new FiscalIssuanceService(store, factory, payments);
  const claim = () => repo.claim(scope, new Date(), 60000);
  const run = async () => { const c = await claim(); assert.ok(c); return service.run(c); };
  return { sale, scope, repo, evidence, calls, credentialScopes, setArtifacts: (value: typeof artifacts) => { artifacts = value; }, factory, payments, store, service, claim, run,
    setRemote: (value: typeof remote) => { remote = value; }, setBehavior: (value: typeof behavior) => { behavior = value; },
    setCancellationBehavior: (value: typeof cancellationBehavior) => { cancellationBehavior = value; }, setCancellationXml: (value: string) => { cancellationXml = value; },
    writes: () => calls.filter(c => c.method === "POST"), current: () => fixture.prisma.fiscalIntent.findUniqueOrThrow({ where: { id: sale.intent.id } }) };
}

/** Explicit historical DB fixture. Builds archived bytes but performs no provider write or active issuance admission. */
export async function seedHistoricalFiscalIssuance(fixture: Awaited<ReturnType<typeof createFiscalFixture>>,
  original: Awaited<ReturnType<typeof arrangeIssuance>>, options: { transmitted?: boolean } = {}) {
  const issuedAt = new Date("2026-11-14T12:00:00Z");
  const context = (await original.store.readOnly(original.scope, original.sale.intent.id)).context;
  const payload = original.factory.build(context, issuedAt.toISOString(), admitFiscalPaymentEvidence(original.sale.snapshot, original.evidence));
  const payloadHash = fiscalObjectFingerprint(payload);
  await fixture.prisma.fiscalIssuanceRevision.create({ data: { ...original.scope, intentId: original.sale.intent.id, revision: 1,
    profileVersionId: original.sale.profile.id, issuedAt, payload: payload as Prisma.InputJsonObject, payloadHash,
    paymentEvidence: JSON.parse(JSON.stringify(original.evidence)) } });
  if (options.transmitted !== false) {
    await fixture.prisma.fiscalProviderStageReceipt.create({ data: { ...original.scope, intentId: original.sale.intent.id,
      revision: 1, stage: "invoice.submit", reference: original.sale.intent.stableReference, outcome: "accepted", payloadHash,
      remoteId: original.sale.intent.stableReference } });
    await fixture.prisma.fiscalIntent.update({ where: { id: original.sale.intent.id }, data: { state: "processing",
      writeStartedAt: issuedAt, remoteInvoiceId: original.sale.intent.stableReference } });
  }
  return JSON.parse(JSON.stringify(payload)) as Readonly<Record<string, unknown>>;
}
