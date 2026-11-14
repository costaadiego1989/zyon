/**
 * Unit tests for AuditLogPage — audit-log-page.tsx
 * Validates: Portuguese diacritics, API contract (occurred_at, actor_type, correlation_id),
 * cursor pagination, filtering logic, CSV export, expandable rows, accessibility.
 * Environment: node (no jsdom), with server-rendered markup and pure function tests.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AuditEvent } from "../api-client.js";
import { AuditLogPage } from "./audit-log-page.js";
import { useAuditLogPage } from "./useAuditLogPage.js";

vi.mock("./useAuditLogPage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useAuditLogPage.js")>();
  return { ...actual, useAuditLogPage: vi.fn() };
});

const SOURCE_PATH = path.resolve(import.meta.dirname ?? ".", "audit-log-page.tsx");
const HOOK_PATH = path.resolve(import.meta.dirname ?? ".", "useAuditLogPage.ts");
const source = fs.readFileSync(SOURCE_PATH, "utf-8") + "\n" + fs.readFileSync(HOOK_PATH, "utf-8");

const renderedEvents: AuditEvent[] = ["human", "service"].map((actorType, index): AuditEvent => ({
  id: `event-${index + 1}`,
  actor_type: actorType as "human" | "service",
  actor_id: `actor-${index + 1}`,
  action: index ? "delete_key" : "create_rule",
  resource_type: "rule",
  resource_id: `rule-${index + 1}`,
  correlation_id: `correlation-${index + 1}`,
  ip_address: null,
  user_agent: null,
  outcome: "success",
  metadata: { description: `Activity ${index + 1}` },
  occurred_at: "2026-09-28T12:00:00Z",
}));

function renderPage(overrides: Partial<ReturnType<typeof useAuditLogPage>> = {}, authenticated = true) {
  vi.mocked(useAuditLogPage).mockReturnValue({
    events: renderedEvents, filteredEvents: renderedEvents, pagedEvents: renderedEvents,
    page: 1, pageSize: 20, totalFiltered: renderedEvents.length, setPage: vi.fn(),
    loading: false, loadingMore: false, hasMore: false, error: null, moreError: null,
    filters: { dateRange: "all", actionCategory: "all", actorType: "all" },
    setFilters: vi.fn(), expandedRowId: null, load: vi.fn(), loadMore: vi.fn(),
    exportCsv: vi.fn(), toggleExpand: vi.fn(), ...overrides,
  });
  return renderToStaticMarkup(createElement(AuditLogPage, {
    apiBaseUrl: "",
    me: authenticated ? { id: "merchant-test", user_id: "owner-test", name: "Loja de teste", role: "OWNER" } : null,
  }));
}

function exportButton(markup: string) {
  return markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(button => button.includes("Exportar registros carregados"));
}

// ── Portuguese Diacritics ────────────────────────────────────────────────────

describe("AuditLogPage — Portuguese diacritics", () => {
  const BROKEN_PATTERNS = [
    { wrong: /\bnecessario\b/i, correct: "necessário" },
    { wrong: /\bacoes administrativas\b/i, correct: "ações administrativas" },
    { wrong: /\bseguranca\b/i, correct: "segurança" },
    { wrong: /"Acao"/i, correct: "Ação" },
    { wrong: /\bserao registradas\b/i, correct: "serão registradas" },
    { wrong: /\bacoes administrativas do tenant serao\b/i, correct: "Ações...serão" },
  ];

  for (const { wrong, correct } of BROKEN_PATTERNS) {
    it(`does not contain broken pattern ${wrong} — should be "${correct}"`, () => {
      expect(source.match(wrong), `Found ${wrong}`).toBeNull();
    });
  }

  it("explains how to access the history when signed out", () => {
    const markup = renderPage({}, false);
    expect(markup).toContain("Entre na sua conta para consultar as atividades da loja.");
    expect(markup).not.toContain("<table");
    expect(exportButton(markup)).toBeUndefined();
  });

  it("describes the actor and time of each action", () => {
    expect(source).toContain("quem realizou cada ação");
  });

  it("uses the activity history heading", () => {
    expect(source).toContain('title="Histórico de atividades"');
  });

  it("contains correct 'Ação' table header with accent", () => {
    expect(source).toContain("Ação");
  });

  it("contains correct 'registrada' word with diacritic context", () => {
    expect(source).toContain("registrada");
  });
});

// ── API Contract — occurred_at, actor_type, correlation_id ───────────────────

describe("AuditLogPage — API contract alignment", () => {
  it("uses occurred_at (not created_at) for timestamp display", () => {
    expect(source).toContain("occurred_at");
    expect(source).not.toContain("created_at");
  });

  it("references actor_type for actor badge rendering", () => {
    expect(source).toContain("actor_type");
  });

  it("references correlation_id for detail expansion", () => {
    expect(source).toContain("correlation_id");
  });
});

// ── Pagination — Carregar mais ───────────────────────────────────────────────

describe("AuditLogPage — pagination", () => {
  it("exposes a loadMore handler for progressive loading", () => {
    expect(renderPage({ hasMore: true })).toContain("Carregar registros anteriores");
    expect(renderPage({ hasMore: false })).not.toContain("Carregar registros anteriores");
  });

  it("uses cursor-based pagination (nextCursor state)", () => {
    expect(source).toContain("nextCursor");
  });

  it("uses hasMore state to control load-more visibility", () => {
    expect(source).toContain("hasMore");
  });

  it("calls getAuditEvents with cursor option", () => {
    expect(source).toContain("cursor:");
  });
});

// ── Filter bar ───────────────────────────────────────────────────────────────

describe("AuditLogPage — filters", () => {
  it("has date range filter with correct labels", () => {
    expect(source).toContain("7 dias");
    expect(source).toContain("30 dias");
    expect(source).toContain("90 dias");
  });

  it("has action category filter", () => {
    const markup = renderPage();
    expect(markup).toContain('aria-label="Tipo de ação"');
    expect(markup).toContain('<option value="destructive">Exclusões</option>');
    expect(markup).toContain('<option value="constructive">Criações</option>');
    expect(markup).toContain('<option value="update">Alterações</option>');
  });

  it("has actor type filter", () => {
    expect(source).toContain("Pessoa");
    expect(source).toContain("Sistema");
  });

  it("shows event count summary", () => {
    const markup = renderPage();
    expect(markup).toContain("2 registros carregados.");
    expect(markup).toContain("Os filtros e a exportação consideram esses registros.");
  });

  it("implements filterEvents as a pure function", () => {
    expect(source).toMatch(/function filterEvents/);
  });
});

// ── Expandable row detail ────────────────────────────────────────────────────

describe("AuditLogPage — expandable row", () => {
  it("has expand/collapse toggle state (expandedRowId)", () => {
    expect(source).toContain("expandedRowId");
  });

  it("renders the expanded row as the target of its disclosure button", () => {
    const collapsed = renderPage();
    const expanded = renderPage({ expandedRowId: "event-1" });
    expect(collapsed).not.toContain('id="detail-event-1"');
    expect(expanded).toMatch(/aria-expanded="true" aria-controls="detail-event-1"/);
    expect(expanded).toMatch(/<tr id="detail-event-1"><td colspan="7">/i);
    expect(expanded).toContain("Activity 1");
  });

  it("shows metadata as JSON in pre block", () => {
    expect(source).toMatch(/JSON\.stringify/);
  });

  it("shows correlation_id in detail", () => {
    // Must reference correlation_id in detail rendering
    expect(source).toContain("correlation_id");
  });
});

// ── CSV Export ───────────────────────────────────────────────────────────────

describe("AuditLogPage — CSV export", () => {
  it("contains 'Exportar' button text", () => {
    expect(source).toContain("Exportar");
  });

  it("generates CSV with correct header columns", () => {
    expect(source).toContain("Data,Tipo Ator,Ator,Ação,Recurso,ID Recurso,Resultado,IP,ID Correlação");
  });

  it("uses downloadCsv helper for CSV download", () => {
    expect(source).toContain("downloadCsv");
  });

  it("generates filename with date pattern auditoria-YYYY-MM-DD.csv", () => {
    expect(source).toMatch(/auditoria-.*\.csv/);
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

describe("AuditLogPage — accessibility", () => {
  it("has table caption for screen readers", () => {
    expect(renderPage()).toContain('<caption class="sr-only">Atividades da loja</caption>');
  });

  it("has aria-live region", () => {
    const liveRegion = (markup: string) => markup.match(/<p[^>]*role="status"[^>]*>[\s\S]*?<\/p>/)?.[0];
    const loaded = liveRegion(renderPage({ totalFiltered: 42, pagedEvents: renderedEvents, page: 3 }));
    expect(loaded).toContain('aria-live="polite"');
    expect(loaded).toContain('aria-atomic="true"');
    expect(loaded).toContain("42 atividades encontradas. Exibindo 2 na página 3.");
    expect(liveRegion(renderPage({ loading: true }))).toContain("Carregando atividades.");
    expect(liveRegion(renderPage({ loadingMore: true }))).toContain("Carregando registros anteriores.");
    expect(liveRegion(renderPage({ moreError: "unavailable" }))).toContain("Os registros atuais foram mantidos.");
    expect(liveRegion(renderPage({ error: "unavailable" }))).toContain("Não foi possível carregar as atividades.");
  });

  it("has aria-busy during loading", () => {
    expect(source).toContain("aria-busy");
  });

  it("export button has a visible accessible name that states its scope", () => {
    const button = exportButton(renderPage());
    expect(button).toBeDefined();
    expect(button).toContain("Exportar registros carregados");
    expect(button).not.toMatch(/^<button\b[^>]*aria-hidden="true"/);
    const override = button?.match(/aria-label="([^"]+)"/)?.[1];
    if (override) expect(override).toContain("Exportar registros carregados");
  });

  it("only enables export when results are available and loading has finished", () => {
    expect(exportButton(renderPage({ loading: true }))).toMatch(/\sdisabled(?:=|\s|>)/);
    expect(exportButton(renderPage({ totalFiltered: 0 }))).toMatch(/\sdisabled(?:=|\s|>)/);
    expect(exportButton(renderPage())).not.toMatch(/\sdisabled(?:=|\s|>)/);
  });

  it("expand button has aria-expanded attribute", () => {
    expect(source).toContain("aria-expanded");
  });

  it("expand button has aria-controls attribute", () => {
    expect(source).toContain("aria-controls");
  });

  it("uses <time> element with datetime for relative timestamps", () => {
    expect(source).toContain("<time");
    expect(source).toContain("dateTime");
  });
});

// ── Loading skeleton ─────────────────────────────────────────────────────────

describe("AuditLogPage — loading skeleton", () => {
  it("renders a named busy placeholder while activities load", () => {
    const markup = renderPage({ loading: true });
    expect(markup).toMatch(/<section[^>]*aria-label="Carregando atividades"[^>]*aria-busy="true"/);
    expect(markup).toContain('class="skeleton-cell"');
    expect(markup).not.toContain("<table");
  });

  it("renders skeleton-cell class for individual cells", () => {
    expect(source).toContain("skeleton-cell");
  });
});

// ── Actor type badge ─────────────────────────────────────────────────────────

describe("AuditLogPage — actor type display", () => {
  it("names human and service actors without relying on badge color", () => {
    const table = renderPage().match(/<table\b[\s\S]*?<\/table>/)?.[0];
    expect(table).toContain("<td>Pessoa</td>");
    expect(table).toContain("<td>Sistema</td>");
  });

  it("distinguishes human vs service actors", () => {
    expect(source).toContain("human");
    expect(source).toContain("service");
  });
});

// ── Header action ────────────────────────────────────────────────────────────

describe("AuditLogPage — header action", () => {
  it("has an Exportar action in the header", () => {
    // The manual "Atualizar" refresh was dropped in favor of auto-loading;
    // Exportar is the header's primary action now.
    expect(source).toContain("Exportar");
  });
});

// ── filterEvents pure function logic ─────────────────────────────────────────

describe("filterEvents — pure function", () => {
  // Import and test the exported filterEvents function
  // Since it's inline, we test via dynamic import
  it("is exported for testability", async () => {
    const mod = await import("./useAuditLogPage.js");
    expect(typeof mod.filterEvents).toBe("function");
    expect(typeof mod.actionBadgeCategory).toBe("function");
  });

  it("returns all events when filters are 'all'", async () => {
    const { filterEvents } = await import("./useAuditLogPage.js");
    const events = [
      { id: "1", actor_type: "human" as const, actor_id: null, action: "create_rule", resource_type: "rule", resource_id: null, correlation_id: null, ip_address: null, user_agent: null, outcome: "success" as const, metadata: null, occurred_at: new Date().toISOString() },
      { id: "2", actor_type: "service" as const, actor_id: null, action: "delete_key", resource_type: "key", resource_id: null, correlation_id: null, ip_address: null, user_agent: null, outcome: "success" as const, metadata: null, occurred_at: new Date().toISOString() },
    ];
    const result = filterEvents(events, { dateRange: "all", actionCategory: "all", actorType: "all" });
    expect(result).toHaveLength(2);
  });

  it("filters by actorType=human", async () => {
    const { filterEvents } = await import("./useAuditLogPage.js");
    const events = [
      { id: "1", actor_type: "human" as const, actor_id: null, action: "create_rule", resource_type: "rule", resource_id: null, correlation_id: null, ip_address: null, user_agent: null, outcome: "success" as const, metadata: null, occurred_at: new Date().toISOString() },
      { id: "2", actor_type: "service" as const, actor_id: null, action: "delete_key", resource_type: "key", resource_id: null, correlation_id: null, ip_address: null, user_agent: null, outcome: "success" as const, metadata: null, occurred_at: new Date().toISOString() },
    ];
    const result = filterEvents(events, { dateRange: "all", actionCategory: "all", actorType: "human" });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("1");
  });

  it("filters by actionCategory=destructive", async () => {
    const { filterEvents, actionBadgeCategory } = await import("./useAuditLogPage.js");
    const events = [
      { id: "1", actor_type: "human" as const, actor_id: null, action: "create_rule", resource_type: "rule", resource_id: null, correlation_id: null, ip_address: null, user_agent: null, outcome: "success" as const, metadata: null, occurred_at: new Date().toISOString() },
      { id: "2", actor_type: "service" as const, actor_id: null, action: "delete_key", resource_type: "key", resource_id: null, correlation_id: null, ip_address: null, user_agent: null, outcome: "success" as const, metadata: null, occurred_at: new Date().toISOString() },
    ];
    const result = filterEvents(events, { dateRange: "all", actionCategory: "destructive", actorType: "all" });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("2");
  });

  it("dateRange filter is server-side — filterEvents does NOT exclude by date", async () => {
    const { filterEvents } = await import("./useAuditLogPage.js");
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const events = [
      { id: "1", actor_type: "human" as const, actor_id: null, action: "create_rule", resource_type: "rule", resource_id: null, correlation_id: null, ip_address: null, user_agent: null, outcome: "success" as const, metadata: null, occurred_at: recent },
      { id: "2", actor_type: "human" as const, actor_id: null, action: "create_rule", resource_type: "rule", resource_id: null, correlation_id: null, ip_address: null, user_agent: null, outcome: "success" as const, metadata: null, occurred_at: old },
    ];
    // dateRange is now pushed to API (server-side); filterEvents only applies actionCategory + actorType
    const result = filterEvents(events, { dateRange: "7d", actionCategory: "all", actorType: "all" });
    expect(result).toHaveLength(2);
  });
});

// ── actionBadgeCategory pure function ────────────────────────────────────────

describe("actionBadgeCategory — pure function", () => {
  it("is exported", async () => {
    const mod = await import("./useAuditLogPage.js");
    expect(typeof mod.actionBadgeCategory).toBe("function");
  });

  it("classifies delete actions as destructive", async () => {
    const { actionBadgeCategory } = await import("./useAuditLogPage.js");
    expect(actionBadgeCategory("delete_key")).toBe("destructive");
    expect(actionBadgeCategory("remove_user")).toBe("destructive");
    expect(actionBadgeCategory("revoke_token")).toBe("destructive");
  });

  it("classifies create actions as constructive", async () => {
    const { actionBadgeCategory } = await import("./useAuditLogPage.js");
    expect(actionBadgeCategory("create_rule")).toBe("constructive");
    expect(actionBadgeCategory("add_user")).toBe("constructive");
    expect(actionBadgeCategory("enable_feature")).toBe("constructive");
  });

  it("classifies update actions as update", async () => {
    const { actionBadgeCategory } = await import("./useAuditLogPage.js");
    expect(actionBadgeCategory("update_settings")).toBe("update");
    expect(actionBadgeCategory("edit_rule")).toBe("update");
    expect(actionBadgeCategory("modify_config")).toBe("update");
  });

  it("classifies unknown actions as other", async () => {
    const { actionBadgeCategory } = await import("./useAuditLogPage.js");
    expect(actionBadgeCategory("login")).toBe("other");
    expect(actionBadgeCategory("unknown_action")).toBe("other");
  });
});
