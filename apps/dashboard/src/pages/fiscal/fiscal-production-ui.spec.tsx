import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { FiscalSettingsPage } from "./FiscalSettingsPage.js";
import { FiscalInvoicesPage } from "./FiscalInvoicesPage.js";
import { fiscalHash, readFiscalNavigation } from "../../shell/fiscal-navigation.js";

afterEach(() => vi.unstubAllEnvs());

it("FISCAL-UI-01 production settings omit the environment selector", () => {
  vi.stubEnv("PROD", true);
  const html = renderToStaticMarkup(<FiscalSettingsPage apiBaseUrl="/v1" merchantId="merchant-a" initialEnvironment="homologation" />);
  expect(html).toContain("Emissor fiscal");
  expect(html).not.toContain("Ambiente fiscal");
  expect(html).not.toContain("Homologação · sem validade fiscal");
});

it("FISCAL-UI-01 production invoices omit the environment selector", () => {
  vi.stubEnv("PROD", true);
  const html = renderToStaticMarkup(<FiscalInvoicesPage apiBaseUrl="/v1" merchantId="merchant-a" initialEnvironment="homologation" />);
  expect(html).toContain("Estado fiscal");
  expect(html).not.toContain("Ambiente fiscal");
});

it("FISCAL-UI-01 production navigation overrides an old homologation link without losing the invoice", () => {
  vi.stubEnv("PROD", true);
  expect(readFiscalNavigation("#fiscal-detail?environment=homologation&intentId=invoice-original")).toEqual({environment: "production", intentId: "invoice-original"});
  expect(fiscalHash("fiscal-detail", "homologation", "invoice-original")).toBe("#fiscal-detail?environment=production&intentId=invoice-original");
});

it("FISCAL-UI-01 local fiscal testing retains explicit homologation", () => {
  vi.stubEnv("PROD", false);
  expect(readFiscalNavigation("#fiscal-detail?environment=homologation&intentId=invoice-original")).toEqual({environment: "homologation", intentId: "invoice-original"});
  expect(renderToStaticMarkup(<FiscalSettingsPage apiBaseUrl="/v1" merchantId="merchant-a" />)).toContain("Ambiente fiscal");
});
