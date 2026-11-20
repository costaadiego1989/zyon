import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  FiscalInvoicesPage,
  FiscalInvoiceRows,
  FiscalInvoiceCounts,
} from "./FiscalInvoicesPage.js";
const row = {
  id: "intent",
  orderId: "pedido-original",
  recipientName: "Maria S.",
  provider: "focus" as const,
  state: "authorized" as const,
  deliveries: [
    { channel: "email" as const, state: "accepted" as const },
    { channel: "whatsapp" as const, state: "blocked" as const },
  ],
};
it("FISCAL-59 list starts with loading state", () =>
  expect(
    renderToStaticMarkup(<FiscalInvoicesPage apiBaseUrl="/v1" merchantId="m" />)
  ).toContain("Carregando notas"));
it("FISCAL-59 list requires authenticated merchant", () =>
  expect(
    renderToStaticMarkup(
      <FiscalInvoicesPage apiBaseUrl="/v1" merchantId={null} />
    )
  ).toContain("Faça login"));
it("FISCAL-56 rows display original order", () =>
  expect(
    renderToStaticMarkup(<FiscalInvoiceRows rows={[row]} onOpen={() => {}} />)
  ).toContain("pedido-original"));
it("FISCAL-56 rows display only safe recipient summary", () =>
  expect(
    renderToStaticMarkup(<FiscalInvoiceRows rows={[row]} onOpen={() => {}} />)
  ).toContain("Maria S."));
it("FISCAL-56 rows identify provider", () =>
  expect(
    renderToStaticMarkup(<FiscalInvoiceRows rows={[row]} onOpen={() => {}} />)
  ).toContain("Focus NF-e"));
it("FISCAL-47 failed channels retain independent authorization", () => {
  const html = renderToStaticMarkup(
    <FiscalInvoiceRows rows={[row]} onOpen={() => {}} />
  );
  expect(html).toContain("Autorizada");
  expect(html).toContain("Aceito pelo canal");
  expect(html).toContain("Bloqueado");
});
it("FISCAL-57 counts use backend totals even with one rendered row", () => {
  const html = renderToStaticMarkup(
    <FiscalInvoiceCounts
      total={901}
      counts={{ authorized: 700, processing: 201 }}
    />
  );
  expect(html).toContain("901");
  expect(html).toContain("700");
  expect(html).toContain("201");
});
it("FISCAL-59 empty rows explain future-sale eligibility", () =>
  expect(
    renderToStaticMarkup(<FiscalInvoiceRows rows={[]} onOpen={() => {}} />)
  ).toContain("vendas elegíveis"));
