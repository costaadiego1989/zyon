import assert from "node:assert/strict";
import test from "node:test";
import { FiscalDocumentService } from "../../../fiscal/application/fiscal-document.service.js";
import type { FiscalDocumentAccessPort, FiscalDocumentProjection } from "../../../fiscal/domain/fiscal-document-access.port.js";
import { fiscalBuyerLink } from "../../../fiscal/domain/fiscal-buyer-link.js";
import { createOrderHandlers } from "../../infrastructure/tool-handlers/order.handlers.js";
import { buildConversationBlocks } from "../../infrastructure/agents/conversation-block.builder.js";
import { wrapHandler } from "../tools/types.js";
import { validateStorefrontToolOutput } from "./storefront-tool-output.schemas.js";

// FISCAL-41/42/43: real handler + document projection + native tool boundary.
// Access is a controlled unit port; actual AppModule separately proves DB/HTTP ownership.
function arrange(state: "authorized" | "cancelled" | "processing" = "authorized", buyer = "buyer-own") {
  const reads: { actor: unknown; input: unknown }[] = [];
  const row: FiscalDocumentProjection = {
    intentId: "fi-original", merchantId: "merchant-own", environment: "homologation", orderId: "ORDER-ORIGINAL", state,
    document: state === "processing" ? null : {
      id: "document-original", state, documentState: "available", number: "22", series: "1", accessKey: "1".repeat(44),
      authorizationProtocol: "151260029467289", authorizedAt: new Date("2026-11-18T12:00:00.000Z"),
      cancellationProtocol: state === "cancelled" ? "151260029467290" : null,
      cancelledAt: state === "cancelled" ? new Date("2026-11-18T12:30:00.000Z") : null,
      artifacts: [{ kind: "xml", sha256: "a".repeat(64), size: 100, mimeType: "application/xml" },
        { kind: "danfe", sha256: "b".repeat(64), size: 100, mimeType: "application/pdf" }],
    },
  };
  const access = { order: async (actor, input) => {
    reads.push({ actor, input });
    return actor.kind === "buyer" && actor.globalUserId === "buyer-own" && input.merchantId === row.merchantId
      && input.environment === row.environment && input.orderId === row.orderId ? [row] : null;
  } } as Pick<FiscalDocumentAccessPort, "order">;
  const documents = new FiscalDocumentService(access as FiscalDocumentAccessPort, {} as never, {} as never, {} as never);
  const handlers = createOrderHandlers({ prisma: { merchant: { findUnique: async () => ({ storeSlug: "loja-original" }) } } as never,
    fiscal: { documents, environment: "homologation" } }, {
    merchantId: row.merchantId, sessionId: "conversation-original", ...(buyer ? { buyer: { globalUserId: buyer } } : {}),
  });
  const raw = () => handlers.getInvoice({ orderId: row.orderId });
  const execute = () => wrapHandler("get_invoice", () => raw()).execute({ orderId: row.orderId });
  return { reads, row, raw, execute };
}

function fiscalBlocks(data: unknown) {
  return buildConversationBlocks({ merchantId: "merchant-own", userMessage: "Nota fiscal do meu pedido", finalContent: "Consulte a nota.",
    toolResults: { get_invoice: data } }).blocks.filter(block => block.type === "fiscal_invoices");
}

for (const state of ["authorized", "cancelled"] as const) {
  test(`FISCAL-41 native invoice tool preserves the real ${state} projection and protected file actions`, async () => {
    const a = arrange(state), result = await a.execute();
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("invoice_tool_projection_rejected");
    const data = result.data as Awaited<ReturnType<typeof a.raw>>;
    assert.equal(data.invoiceAvailable, true);
    assert.deepEqual(a.reads, [{ actor: { kind: "buyer", globalUserId: "buyer-own" },
      input: { merchantId: "merchant-own", environment: "homologation", orderId: "ORDER-ORIGINAL" } }]);
    const invoice = (data as any).invoices[0];
    assert.equal(invoice.authorizationProtocol, "151260029467289");
    assert.equal(invoice.accessKey, "1".repeat(44));
    assert.equal(invoice.authorizedAt, "2026-11-18T12:00:00.000Z");
    assert.equal(invoice.cancellationProtocol, state === "cancelled" ? "151260029467290" : undefined);
    const blocks = fiscalBlocks(data);
    assert.deepEqual(blocks, [{ type: "fiscal_invoices", data: { orderId: "ORDER-ORIGINAL", invoices: [{
      intentId: "fi-original", sellerMerchantId: "merchant-own", environment: "homologation", state, documentState: "available", number: "22",
      options: [{ label: "Abrir XML no pedido", action: "navigate", href: fiscalBuyerLink("loja-original", "ORDER-ORIGINAL", "fi-original", "xml", "homologation") },
        { label: "Abrir DANFE no pedido", action: "navigate", href: fiscalBuyerLink("loja-original", "ORDER-ORIGINAL", "fi-original", "danfe", "homologation") }],
    }] } }]);
  });
}

test("FISCAL-43 native invoice tool retains pending documents without inventing authorization or file links", async () => {
  const a = arrange("processing"), result = await a.execute();
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("pending_invoice_tool_projection_rejected");
  const data = result.data as any;
  assert.equal(data.invoiceAvailable, false);
  assert.deepEqual(data.invoices, [{ intentId: "fi-original", sellerMerchantId: "merchant-own", orderId: "ORDER-ORIGINAL",
    state: "processing", environment: "homologation", documentState: "document_pending",
    documents: [{ kind: "xml", available: false }, { kind: "danfe", available: false }], options: [] }]);
  const blocks = fiscalBlocks(data);
  assert.equal(blocks.length, 1);
  assert.equal((blocks[0] as any).data.invoices[0].state, "processing");
  assert.deepEqual((blocks[0] as any).data.invoices[0].options, []);
  assert.doesNotMatch(JSON.stringify(data), /authorizationProtocol|accessKey|authorizedAt|number/);
});

test("FISCAL-42 anonymous invoice access retains identification and performs no fiscal ownership read", async () => {
  const a = arrange("authorized", ""), raw = await a.raw(), result = await a.execute();
  assert.deepEqual(result, { ok: true, data: raw });
  assert.equal((raw as any).requiresIdentification, true);
  assert.equal(raw.invoiceAvailable, false);
  assert.deepEqual(a.reads, []);
  assert.deepEqual(fiscalBlocks((result as any).data), []);
  assert.doesNotMatch(JSON.stringify(result), /151260029467289|fi-original|accessKey|invoices|number/);
});

test("FISCAL-42 foreign buyer denial cannot expose an existing invoice through the native tool", async () => {
  const a = arrange("authorized", "buyer-foreign"), result = await a.execute();
  assert.equal(result.ok, true);
  assert.equal((result as any).data.invoiceAvailable, false);
  assert.deepEqual(a.reads, [{ actor: { kind: "buyer", globalUserId: "buyer-foreign" },
    input: { merchantId: "merchant-own", environment: "homologation", orderId: "ORDER-ORIGINAL" } }]);
  assert.deepEqual(fiscalBlocks((result as any).data), []);
  assert.doesNotMatch(JSON.stringify(result), /151260029467289|fi-original|accessKey|invoices|number/);
});

test("FISCAL-41 invoice projection removes provider credentials and direct document URLs at every declared object", async () => {
  const a = arrange(), raw = await a.raw() as any;
  const privateValue = "PRIVATE_FISCAL_CREDENTIAL";
  const result = validateStorefrontToolOutput("get_invoice", { ...raw, credential: privateValue, invoiceUrl: "https://provider.example.test/private",
    invoices: raw.invoices.map((invoice: any) => ({ ...invoice, credentialCipher: privateValue, xml: privateValue,
      documents: invoice.documents.map((document: any) => ({ ...document, providerUrl: privateValue })),
      options: invoice.options.map((option: any) => ({ ...option, accessToken: privateValue })),
    })) });
  assert.equal(result.ok, true);
  assert.deepEqual(result, { ok: true, data: raw });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FISCAL_CREDENTIAL|credential|providerUrl|provider\.example|accessToken/);
  assert.equal(fiscalBlocks((result as any).data).length, 1);
});

test("FISCAL-41/42 malformed invoice data and unbound or external file links fail closed without a negative fallback", async () => {
  const raw = await arrange().raw() as any, invoice = raw.invoices[0];
  const withInvoice = (change: Record<string, unknown>) => ({ ...raw, invoices: [{ ...invoice, ...change }] });
  const wrongLinks = ["https://provider.example.test/private", "//provider.example.test/private", "javascript:alert(1)", "/store/loja-original?buyerHub=orders",
    fiscalBuyerLink("loja-original", "ORDER-FOREIGN", "fi-original", "xml", "homologation"),
    fiscalBuyerLink("loja-original", "ORDER-ORIGINAL", "fi-foreign", "xml", "homologation"),
    fiscalBuyerLink("loja-original", "ORDER-ORIGINAL", "fi-original", "xml", "production")];
  const invalid = [
    { ...raw, invoices: "private" }, { ...raw, invoices: [] }, { ...raw, requiresIdentification: true },
    withInvoice({ intentId: "" }), withInvoice({ orderId: "ORDER-FOREIGN" }), withInvoice({ state: "invented" }),
    withInvoice({ authorizationProtocol: undefined }), withInvoice({ authorizedAt: "yesterday" }),
    ...wrongLinks.map(href => withInvoice({ options: [{ ...invoice.options[0], href }] })),
    { ...raw, invoiceAvailable: false },
    { ...raw, invoiceAvailable: false, invoices: [{ ...invoice, state: "processing" }] },
  ];
  for (const value of invalid) assert.deepEqual(validateStorefrontToolOutput("get_invoice", value),
    { ok: false, error: "invalid_tool_output", code: "invalid_tool_output" });
});

test("FISCAL-43 an identified order with no invoices stays empty and legacy unavailable results remain valid", () => {
  for (const raw of [
    { orderId: "ORDER-ORIGINAL", invoiceAvailable: false, message: "Consulte o atendimento." },
    { invoiceAvailable: false, message: "Informe o pedido." },
    { orderId: "ORDER-ORIGINAL", invoiceAvailable: false, invoices: [], message: "Este pedido ainda não possui nota fiscal disponível." },
  ]) assert.deepEqual(validateStorefrontToolOutput("get_invoice", raw), { ok: true, data: raw });
});
