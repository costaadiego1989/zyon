import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  FiscalInvoiceDetail,
  FiscalInvoiceEvidence,
  validCancellation,
} from "./FiscalInvoiceDetail.js";
import type { FiscalInvoiceDetail as Detail } from "../../api/fiscal.js";
const detail: Detail = {
  id: "intent",
  orderId: "original-order",
  recipientName: "Maria S.",
  provider: "focus",
  state: "authorized",
  environment: "homologation",
  completedAt: "2026-11-16T12:00:00Z",
  totalCents: 10000,
  currency: "BRL",
  reasonCode: null,
  attempts: 1,
  nextAttemptAt: "2026-11-16T12:00:00Z",
  document: {
    intentId: "intent",
    sellerMerchantId: "seller",
    orderId: "original-order",
    state: "authorized",
    documentState: "available",
    number: "123",
    series: "1",
    authorizationProtocol: "135original",
    accessKey: "1".repeat(44),
    authorizedAt: "2026-11-16T12:01:00Z",
    documents: [
      { kind: "xml", available: true },
      { kind: "danfe", available: false },
    ],
  },
  stock: { owner: "provider", state: "awaiting_provider_evidence" },
  deliveries: [
    { channel: "email", state: "accepted" },
    { channel: "whatsapp", state: "failed" },
  ],
  reviews: [],
  history: [],
  allowedActions: [],
};
const html = (d: Detail = detail) =>
  renderToStaticMarkup(<FiscalInvoiceEvidence detail={d} />);
it("FISCAL-59 detail starts loading", () =>
  expect(
    renderToStaticMarkup(
      <FiscalInvoiceDetail
        apiBaseUrl="/v1"
        merchantId="m"
        intentId="i"
        environment="homologation"
      />
    )
  ).toContain("Carregando detalhe fiscal"));
it("FISCAL-59 detail rejects anonymous access", () =>
  expect(
    renderToStaticMarkup(
      <FiscalInvoiceDetail
        apiBaseUrl="/v1"
        merchantId={null}
        intentId="i"
        environment="homologation"
      />
    )
  ).toContain("Faça login"));
it("FISCAL-41 detail retains original order", () =>
  expect(html()).toContain("original-order"));
it("FISCAL-33 detail shows real authorization protocol", () =>
  expect(html()).toContain("135original"));
it("FISCAL-04 detail identifies homologation", () =>
  expect(html()).toContain("sem validade fiscal"));
it("FISCAL-47 channel failure leaves authorization visible", () => {
  expect(html()).toContain("Autorizada");
  expect(html()).toContain("Falhou");
});
it("FISCAL-48 accepted channel is not delivered", () => {
  expect(html()).toContain("Aceito pelo canal");
  expect(html()).not.toContain("E-mail: Entregue");
});
it("FISCAL-26 stock evidence is distinct from fiscal authorization", () => {
  expect(html()).toContain("Aguardando o emissor confirmar a baixa do estoque");
  expect(html()).toContain("Autorizada");
});
it("FISCAL-66 pending files do not regress authorization", () => {
  const s = html({
    ...detail,
    document: { ...detail.document, documentState: "document_pending" },
  });
  expect(s).toContain(
    "Arquivos em recuperação. A autorização confirmada permanece preservada."
  );
  expect(s).not.toContain("document_pending");
  expect(s).toContain("135original");
});
it("FISCAL-54 cancellation only shows actual returned protocol", () => {
  expect(html()).not.toContain("Protocolo de cancelamento");
  expect(
    html({
      ...detail,
      state: "cancelled",
      document: { ...detail.document, cancellationProtocol: "cancel-original" },
    })
  ).toContain("cancel-original");
});
it("FISCAL-52 cancellation requires explicit confirmation and valid justification", () => {
  expect(validCancellation("Pedido cancelado pelo comprador", false)).toBe(
    false
  );
  expect(validCancellation("curta", true)).toBe(false);
  expect(validCancellation("Pedido cancelado pelo comprador", true)).toBe(true);
  expect(validCancellation("x".repeat(256), true)).toBe(false);
});
it("FISCAL-61 history cannot expose raw event references", () => {
  const s = html({
    ...detail,
    history: [
      {
        id: "event-private",
        actorId: "actor-private",
        actorKind: "merchant",
        action: "stage_secret_hash",
        previousState: "processing",
        nextState: "authorized",
        occurredAt: "2026-11-16T12:00:00Z",
        safeReasonCode: null,
      },
    ],
  });
  expect(s).not.toContain("event-private");
  expect(s).not.toContain("actor-private");
  expect(s).not.toContain("stage_secret_hash");
  expect(s).toContain("Atualização fiscal");
});
