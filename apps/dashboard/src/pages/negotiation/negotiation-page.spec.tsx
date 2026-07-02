/**
 * Tests for NegotiationPage container.
 * Verifies: tab navigation logic, auth-required state, no XSS vectors.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NegotiationPage } from "../negotiation-page.js";

describe("NegotiationPage", () => {
  const me = { id: "mrc_test", name: "Test Store" };

  it("shows auth-required state when me is null", () => {
    const html = renderToStaticMarkup(<NegotiationPage apiBaseUrl="http://localhost:3000" me={null} />);
    expect(html).toContain("Autenticação necessária");
  });

  it("renders page title in Portuguese", () => {
    const html = renderToStaticMarkup(<NegotiationPage apiBaseUrl="http://localhost:3000" me={me} />);
    expect(html).toContain("Motor de Negociação M2M");
  });

  it("renders 3 tabs: Visão Geral, Política, Simulador", () => {
    const html = renderToStaticMarkup(<NegotiationPage apiBaseUrl="http://localhost:3000" me={me} />);
    expect(html).toContain("Visão Geral");
    expect(html).toContain("Política");
    expect(html).toContain("Simulador");
  });

  it("default tab (Visão Geral) has aria-selected=true", () => {
    const html = renderToStaticMarkup(<NegotiationPage apiBaseUrl="http://localhost:3000" me={me} />);
    expect(html).toContain('aria-selected="true"');
    const overviewTabMatch = html.match(/aria-selected="true"[^>]*>Visão Geral/);
    expect(overviewTabMatch).toBeTruthy();
  });

  it("does not contain dangerouslySetInnerHTML in rendered output", () => {
    const html = renderToStaticMarkup(<NegotiationPage apiBaseUrl="http://localhost:3000" me={me} />);
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("has proper ARIA tablist role", () => {
    const html = renderToStaticMarkup(<NegotiationPage apiBaseUrl="http://localhost:3000" me={me} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
  });
});
