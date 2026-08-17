/**
 * Unit tests for AuditLogPage — audit-log-page.tsx
 * Validates: Portuguese diacritics, API contract (occurred_at, actor_type, correlation_id),
 * cursor pagination, filtering logic, CSV export, expandable rows, accessibility.
 * Environment: node (no jsdom) — tests validate source strings + pure function logic.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SOURCE_PATH = path.resolve(import.meta.dirname ?? ".", "audit-log-page.tsx");
const HOOK_PATH = path.resolve(import.meta.dirname ?? ".", "useAuditLogPage.ts");
const source = fs.readFileSync(SOURCE_PATH, "utf-8") + "\n" + fs.readFileSync(HOOK_PATH, "utf-8");

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

  it("contains correct 'necessário' with accent", () => {
    expect(source).toContain("necessário");
  });

  it("contains correct 'ações realizadas' with accent", () => {
    expect(source).toContain("ações realizadas");
  });

  it("contains correct 'auditoria' word in heading context", () => {
    expect(source).toContain("Auditoria");
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
  it("contains 'Carregar mais' load-more button text", () => {
    expect(source).toContain("Carregar mais");
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
    expect(source).toContain("Exclusão");
    expect(source).toContain("Criação");
    expect(source).toContain("Alteração");
  });

  it("has actor type filter", () => {
    expect(source).toContain("Pessoa");
    expect(source).toContain("Sistema");
  });

  it("shows event count summary", () => {
    expect(source).toContain("Exibindo");
    expect(source).toContain("eventos");
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

  it("renders audit-detail-row class for expanded content", () => {
    expect(source).toContain("audit-detail-row");
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
    expect(source).toContain("<caption");
    expect(source).toContain("sr-only");
    expect(source).toContain("Log de auditoria do merchant");
  });

  it("has aria-live region", () => {
    expect(source).toContain('aria-live="polite"');
  });

  it("has aria-busy during loading", () => {
    expect(source).toContain("aria-busy");
  });

  it("refresh button has aria-label", () => {
    expect(source).toContain('aria-label="Atualizar log de auditoria"');
  });

  it("export button has aria-label", () => {
    expect(source).toContain('aria-label="Exportar registros"');
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
  it("renders skeleton-row class for table skeleton", () => {
    expect(source).toContain("skeleton-row");
  });

  it("renders skeleton-cell class for individual cells", () => {
    expect(source).toContain("skeleton-cell");
  });
});

// ── Actor type badge ─────────────────────────────────────────────────────────

describe("AuditLogPage — actor type display", () => {
  it("renders actor-badge class with type distinction", () => {
    expect(source).toContain("actor-badge");
  });

  it("distinguishes human vs service actors", () => {
    expect(source).toContain("human");
    expect(source).toContain("service");
  });
});

// ── Refresh button ───────────────────────────────────────────────────────────

describe("AuditLogPage — refresh", () => {
  it("has Atualizar button", () => {
    expect(source).toContain("Atualizar");
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
