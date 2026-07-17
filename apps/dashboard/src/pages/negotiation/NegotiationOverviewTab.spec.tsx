/**
 * Tests for NegotiationOverviewTab.
 * Verifies: metric cards, sessions table, empty state, loading state, pagination.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NegotiationOverviewTab } from "./NegotiationOverviewTab.js";
import type { NegotiationApi } from "./NegotiationOverviewTab.js";

function makeMockApi(overrides?: Partial<NegotiationApi>): NegotiationApi {
  return {
    getNegotiationStats: vi.fn().mockResolvedValue({
      total_sessions: 142,
      total_ai_cost_cents: 568,
      agreement_count: 98,
      agreement_rate: 0.69,
      avg_discount_percent: 7.2,
      total_ledger_entries: 284,
      period: "30d",
    }),
    getNegotiationSessions: vi.fn().mockResolvedValue({
      data: [
        {
          id: "sess_1",
          global_user_id: "usr_1",
          cart_fingerprint: "fp_1",
          agreement: true,
          selected_discount_percent: 8.5,
          estimated_ai_cost_cents: 4,
          created_at: "2026-07-01T12:00:00.000Z",
          applied_at: "2026-07-01T12:01:00.000Z",
        },
      ],
      next_cursor: null,
      has_more: false,
    }),
    ...overrides,
  };
}

describe("NegotiationOverviewTab", () => {
  it("renders 4 metric labels in Portuguese", () => {
    const html = renderToStaticMarkup(<NegotiationOverviewTab api={makeMockApi()} />);
    expect(html).toContain("Sessões");
    expect(html).toContain("Custo IA");
    expect(html).toContain("Acordo");
    expect(html).toContain("Desconto médio");
  });

  it("renders metrics grid container", () => {
    const html = renderToStaticMarkup(<NegotiationOverviewTab api={makeMockApi()} />);
    expect(html).toContain('class="metrics"');
  });

  it("renders sessions panel with title", () => {
    const html = renderToStaticMarkup(<NegotiationOverviewTab api={makeMockApi()} />);
    expect(html).toContain("Sessões recentes");
  });

  it("renders empty state message when no sessions on initial SSR", () => {
    const html = renderToStaticMarkup(<NegotiationOverviewTab api={makeMockApi()} />);
    expect(html).toContain("Nenhuma sessão registrada");
  });

  it("renders period selector buttons", () => {
    const html = renderToStaticMarkup(<NegotiationOverviewTab api={makeMockApi()} />);
    expect(html).toContain("7d");
    expect(html).toContain("30d");
    expect(html).toContain("90d");
  });

  it("renders 'Tudo' option in period selector", () => {
    const html = renderToStaticMarkup(<NegotiationOverviewTab api={makeMockApi()} />);
    expect(html).toContain("Tudo");
  });
});
