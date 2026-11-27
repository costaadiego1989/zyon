import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FiscalSettingsPage } from "./FiscalSettingsPage.js";
import {
  buildFiscalProfile,
  operationFields,
  fiscalErrorText,
  readinessLabel,
  fiscalCredentialSecret,
} from "./fiscal-ui.js";
import { FiscalApiError } from "../../api/fiscal.js";

it("FISCAL-59 settings starts with an accessible loading state", () => {
  expect(
    renderToStaticMarkup(
      <FiscalSettingsPage apiBaseUrl="/v1" merchantId="merchant" />
    )
  ).toContain("Carregando configuração fiscal");
});
it("FISCAL-01 settings requires a signed in merchant before showing credentials", () => {
  const html = renderToStaticMarkup(
    <FiscalSettingsPage apiBaseUrl="/v1" merchantId={null} />
  );
  expect(html).toContain("Faça login");
  expect(html).not.toContain('type="password"');
});
it("FISCAL-02 readiness explains certificate and original account checks", () => {
  expect(readinessLabel.certificate).toBe("Certificado no provedor");
  expect(readinessLabel.environment).toBe("Ambiente efetivo da conta");
});
it("FISCAL-59 denied and expired sessions have actionable distinct copy", () => {
  expect(
    fiscalErrorText(
      new FiscalApiError(403, "forbidden", "tenant_role_required")
    )
  ).toContain("proprietário ou administrador");
  expect(
    fiscalErrorText(
      new FiscalApiError(401, "unauthenticated", "fiscal_request_failed")
    )
  ).toContain("Faça login");
});
it("FISCAL-20 merchant tax setup leaves missing tax values empty", () => {
  expect(() =>
    buildFiscalProfile(
      "focus",
      "homologation",
      null,
      {},
      [],
      "simples_nacional"
    )
  ).toThrow("Contrato fiscal indisponível");
});
it("FISCAL-21 profile uses the reviewed contract and explicit merchant rates", () => {
  const profile = buildFiscalProfile(
    "focus",
    "homologation",
    {
      sourceContractVersion: "reviewed",
      operations: ["sale"],
      currencies: ["BRL"],
      issuerRegimes: ["simples_nacional"],
      productTypes: ["physical"],
      minimumRecipientRequirements: ["name", "taxId"],
    },
    { natureza_operacao: "Venda", tipo_documento: "1" },
    [
      {
        sku: "sku",
        ncm: "12345678",
        cfop: "5102",
        origin: "0",
        unit: "UN",
        productId: "",
        natureId: "",
        taxes: [{ key: "icms_aliquota", value: "7.25", numeric: true }],
      },
    ],
    "simples_nacional"
  );
  expect(profile.sourceContractVersion).toBe("reviewed");
  expect(profile.recipientRequirements).toEqual(["name", "taxId"]);
  expect(profile.itemRules).toMatchObject({
    items: {
      sku: { ncm: "12345678", cfop: "5102", taxes: { icms_aliquota: 7.25 } },
    },
    operation: { natureza_operacao: "Venda", tipo_documento: 1 },
  });
});
it("FISCAL-22 ERP operations expose their distinct supported account fields", () => {
  expect(operationFields.bling.map((x) => x.key)).toContain("lojaId");
  expect(operationFields.omie.map((x) => x.key)).toContain(
    "codigoCenarioImpostos"
  );
  expect(operationFields.tiny.map((x) => x.key)).toContain(
    "naturezaOperacaoId"
  );
});
it("FISCAL-59 diagnostics never echo an arbitrary provider error or secret", () => {
  expect(fiscalErrorText(new Error("private-token"))).not.toContain(
    "private-token"
  );
  expect(
    fiscalErrorText(
      new FiscalApiError(503, "unavailable", "fiscal_request_failed")
    )
  ).toContain("Tente novamente");
});
it("FISCAL-18 fiscal OAuth uses the exact supported protected account contract", () => {
  const input = {
    token: "private-access",
    refreshToken: "private-refresh",
    expiresAt: "2027-01-01",
    appId: "app-original",
    clientSecret: "private-client",
    environment: "homologation" as const,
    issuerTaxId: "12.ABC.345/01DE-35",
  };
  expect(JSON.parse(fiscalCredentialSecret("omie", input))).toEqual({
    contract: "omie_app_v1",
    token: "private-access",
    refreshToken: "private-refresh",
    expiresAt: "2027-01-01T23:59:59.000Z",
    appHash: "app-original",
    environment: "homologation",
    issuerTaxId: "12ABC34501DE35",
  });
  expect(JSON.parse(fiscalCredentialSecret("tiny", input))).toMatchObject({
    contract: "olist_oauth_v3",
    clientId: "app-original",
    clientSecret: "private-client",
  });
});
it("FISCAL-21 ERP profile preserves the named responsible policy revision", () => {
  const value = buildFiscalProfile(
    "bling",
    "production",
    {
      sourceContractVersion: "bling-v3-2026-11",
      operations: ["sale"],
      currencies: ["BRL"],
      issuerRegimes: ["simples_nacional"],
      productTypes: ["physical"],
      minimumRecipientRequirements: ["name", "taxId"],
    },
    {},
    [],
    "simples_nacional",
    { policyVersion: "revisao-contador-2" }
  );
  expect(value.itemRules.policyVersion).toBe("revisao-contador-2");
});
