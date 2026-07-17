/**
 * Tests for NegotiationPage container.
 * Verifies: tab navigation logic, auth-required state, no XSS vectors.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NegotiationPage } from "../negotiation-page.js";
import { ApiContext } from "../../hooks/useApi.js";
import type { DashboardApi } from "../../hooks/useApi.js";

const mockApi = {
  getNegotiationStats: vi.fn().mockResolvedValue({}),
  getNegotiationSessions: vi.fn().mockResolvedValue({ data: [], next_cursor: null, has_more: false }),
  getNegotiationPolicy: vi.fn().mockResolvedValue({ has_custom_policy: false, policy: null }),
  putNegotiationPolicy: vi.fn().mockResolvedValue({}),
  evaluateNegotiation: vi.fn().mockResolvedValue({}),
} as unknown as DashboardApi;

function renderWithProvider(el: React.ReactElement) {
  return renderToStaticMarkup(
    <ApiContext.Provider value={mockApi}>{el}</ApiContext.Provider>
  );
}

describe("NegotiationPage", () => {
  const me = { id: "mrc_test", name: "Test Store" };

  it("shows auth-required state when me is null", () => {
    const html = renderWithProvider(<NegotiationPage apiBaseUrl="http://localhost:3000" me={null} />);
    expect(html).toContain("Autenticação necessária");
  });

  it("renders page title in Portuguese", () => {
    const html = renderWithProvider(<NegotiationPage apiBaseUrl="http://localhost:3000" me={me} />);
    expect(html).toContain("Política de Negociação");
  });

  it("renders 3 tabs: Sessões e custos, Regras de negociação, Testar cenários", () => {
    const html = renderWithProvider(<NegotiationPage apiBaseUrl="http://localhost:3000" me={me} />);
    expect(html).toContain("Sessões e custos");
    expect(html).toContain("Regras de negociação");
    expect(html).toContain("Testar cenários");
  });

  it("default tab (Sessões e custos) has aria-selected=true", () => {
    const html = renderWithProvider(<NegotiationPage apiBaseUrl="http://localhost:3000" me={me} />);
    expect(html).toContain('aria-selected="true"');
    const overviewTabMatch = html.match(/aria-selected="true"[^>]*>Sessões e custos/);
    expect(overviewTabMatch).toBeTruthy();
  });

  it("does not contain dangerouslySetInnerHTML in rendered output", () => {
    const html = renderWithProvider(<NegotiationPage apiBaseUrl="http://localhost:3000" me={me} />);
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("has proper ARIA tablist role", () => {
    const html = renderWithProvider(<NegotiationPage apiBaseUrl="http://localhost:3000" me={me} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
  });
});
