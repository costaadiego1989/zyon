/**
 * Support Settings Page — Enterprise Redesign tests
 * Covers: exported logic functions, structural assertions, accessibility, layout conventions.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function readSource() {
  return readFileSync(resolve("src/pages/support-settings-page.tsx"), "utf-8");
}

// ── Task 2.1: formatPtBrDate ────────────────────────────────────────────────

describe("formatPtBrDate", () => {
  it("is exported for testing", async () => {
    const mod = await import("./support-settings-page.js");
    expect(mod.formatPtBrDate).toBeDefined();
    expect(typeof mod.formatPtBrDate).toBe("function");
  });

  it("formats ISO date with pt-BR month and time", async () => {
    const { formatPtBrDate } = await import("./support-settings-page.js");
    const result = formatPtBrDate("2026-07-02T14:32:00Z");
    expect(result).toContain("jul");
    expect(result).toContain("2026");
    // Time may vary by timezone offset but format must include HH:MM
    expect(result).toMatch(/\d{2}:\d{2}/);
  });

  it("returns raw string on invalid input", async () => {
    const { formatPtBrDate } = await import("./support-settings-page.js");
    const result = formatPtBrDate("not-a-date");
    expect(result).toBe("not-a-date");
  });
});

// ── Task 2.2: Validation logic ──────────────────────────────────────────────

describe("validateFaqItems", () => {
  it("is exported for testing", async () => {
    const mod = await import("./support-settings-page.js");
    expect(mod.validateFaqItems).toBeDefined();
  });

  it("returns errors for empty question", async () => {
    const { validateFaqItems } = await import("./support-settings-page.js");
    const errors = validateFaqItems([{ id: "1", question: "", answer: "ok" }]);
    expect(errors[0].question).toBe(true);
    expect(errors[0].answer).toBe(false);
  });

  it("returns errors for empty answer", async () => {
    const { validateFaqItems } = await import("./support-settings-page.js");
    const errors = validateFaqItems([{ id: "1", question: "q", answer: "   " }]);
    expect(errors[0].question).toBe(false);
    expect(errors[0].answer).toBe(true);
  });

  it("returns no errors for valid items", async () => {
    const { validateFaqItems } = await import("./support-settings-page.js");
    const errors = validateFaqItems([
      { id: "1", question: "Q1", answer: "A1" },
      { id: "2", question: "Q2", answer: "A2" },
    ]);
    expect(errors.every((e: { question: boolean; answer: boolean }) => !e.question && !e.answer)).toBe(true);
  });
});

// ── Task 2.4: FAQ reorder logic ─────────────────────────────────────────────

describe("moveItem", () => {
  it("is exported for testing", async () => {
    const mod = await import("./support-settings-page.js");
    expect(mod.moveItemInList).toBeDefined();
  });

  it("moves item down (swaps positions 0 and 1)", async () => {
    const { moveItemInList } = await import("./support-settings-page.js");
    const items = [
      { id: "a", question: "Q1", answer: "A1" },
      { id: "b", question: "Q2", answer: "A2" },
      { id: "c", question: "Q3", answer: "A3" },
    ];
    const result = moveItemInList(items, "a", "down");
    expect(result[0].id).toBe("b");
    expect(result[1].id).toBe("a");
    expect(result[2].id).toBe("c");
  });

  it("moves item up (swaps positions 1 and 0)", async () => {
    const { moveItemInList } = await import("./support-settings-page.js");
    const items = [
      { id: "a", question: "Q1", answer: "A1" },
      { id: "b", question: "Q2", answer: "A2" },
    ];
    const result = moveItemInList(items, "b", "up");
    expect(result[0].id).toBe("b");
    expect(result[1].id).toBe("a");
  });

  it("is no-op when moving first item up", async () => {
    const { moveItemInList } = await import("./support-settings-page.js");
    const items = [
      { id: "a", question: "Q1", answer: "A1" },
      { id: "b", question: "Q2", answer: "A2" },
    ];
    const result = moveItemInList(items, "a", "up");
    expect(result[0].id).toBe("a");
    expect(result[1].id).toBe("b");
  });

  it("is no-op when moving last item down", async () => {
    const { moveItemInList } = await import("./support-settings-page.js");
    const items = [
      { id: "a", question: "Q1", answer: "A1" },
      { id: "b", question: "Q2", answer: "A2" },
    ];
    const result = moveItemInList(items, "b", "down");
    expect(result[0].id).toBe("a");
    expect(result[1].id).toBe("b");
  });
});

// ── Task 2.5: Ticket filtering and pagination ───────────────────────────────

describe("filterTickets", () => {
  it("is exported for testing", async () => {
    const mod = await import("./support-settings-page.js");
    expect(mod.filterTickets).toBeDefined();
  });

  it("filters tickets by search query (buyerMessage)", async () => {
    const { filterTickets } = await import("./support-settings-page.js");
    const tickets = [
      { id: "t1", buyerMessage: "Meu pedido atrasou", status: "open" },
      { id: "t2", buyerMessage: "Quero cancelar", status: "open" },
      { id: "t3", buyerMessage: "Pedido errado", status: "resolved" },
    ];
    const result = filterTickets(tickets as any[], "pedido");
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("t1");
    expect(result[1].id).toBe("t3");
  });

  it("filters by ticket id substring", async () => {
    const { filterTickets } = await import("./support-settings-page.js");
    const tickets = [
      { id: "abc-123", buyerMessage: "msg", status: "open" },
      { id: "def-456", buyerMessage: "msg", status: "open" },
    ];
    const result = filterTickets(tickets as any[], "abc");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("abc-123");
  });

  it("returns all when query is empty", async () => {
    const { filterTickets } = await import("./support-settings-page.js");
    const tickets = [
      { id: "t1", buyerMessage: "A", status: "open" },
      { id: "t2", buyerMessage: "B", status: "open" },
    ];
    const result = filterTickets(tickets as any[], "  ");
    expect(result).toHaveLength(2);
  });
});

describe("paginateItems", () => {
  it("is exported for testing", async () => {
    const mod = await import("./support-settings-page.js");
    expect(mod.paginateItems).toBeDefined();
  });

  it("returns first page of 10 items", async () => {
    const { paginateItems } = await import("./support-settings-page.js");
    const items = Array.from({ length: 25 }, (_, i) => ({ id: `t${i}` }));
    const { paginated, hasMore } = paginateItems(items, 1, 10);
    expect(paginated).toHaveLength(10);
    expect(hasMore).toBe(true);
  });

  it("returns remaining items on last page", async () => {
    const { paginateItems } = await import("./support-settings-page.js");
    const items = Array.from({ length: 25 }, (_, i) => ({ id: `t${i}` }));
    const { paginated, hasMore } = paginateItems(items, 3, 10);
    expect(paginated).toHaveLength(25);
    expect(hasMore).toBe(false);
  });

  it("hasMore is false when items fit in one page", async () => {
    const { paginateItems } = await import("./support-settings-page.js");
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}` }));
    const { paginated, hasMore } = paginateItems(items, 1, 10);
    expect(paginated).toHaveLength(5);
    expect(hasMore).toBe(false);
  });
});

// ── Phase 3 & 4: Structural assertions ──────────────────────────────────────

describe("SupportSettingsPage — structure", () => {
  it("exports the page component", async () => {
    const mod = await import("./support-settings-page.js");
    expect(mod.SupportSettingsPage).toBeDefined();
    expect(typeof mod.SupportSettingsPage).toBe("function");
  });

  it("uses .metrics class for ticket summary strip", () => {
    const src = readSource();
    expect(src).toContain('className="metrics"');
  });

  it("uses aria-live polite for toast region", () => {
    const src = readSource();
    expect(src).toContain('aria-live="polite"');
    expect(src).toContain('role="status"');
  });

  it("does not contain 'handoff' English jargon", () => {
    const src = readSource();
    expect(src.toLowerCase()).not.toContain("handoff");
  });

  it("contains atendimento humano in Portuguese", () => {
    const src = readSource();
    expect(src).toContain("atendimento humano");
  });

  it("uses formatPtBrDate for timestamp localization", () => {
    const src = readSource();
    expect(src).toContain("formatPtBrDate");
  });

  it("has character counter elements", () => {
    const src = readSource();
    expect(src).toContain("char-counter");
  });

  it("has inline-confirm for delete confirmation", () => {
    const src = readSource();
    expect(src).toContain("inline-confirm");
    expect(src).toContain("confirmDeleteId");
  });

  it("has ticket search input with correct aria-label", () => {
    const src = readSource();
    expect(src).toContain('aria-label="Buscar chamados"');
    expect(src).toContain('type="search"');
  });

  it("has show-more pagination button", () => {
    const src = readSource();
    expect(src).toContain("show-more-btn");
    expect(src).toContain("Mostrar mais");
  });

  it("uses beforeunload for dirty state guard", () => {
    const src = readSource();
    expect(src).toContain("beforeunload");
  });

  it("has reorder controls with proper aria-labels", () => {
    const src = readSource();
    expect(src).toContain('aria-label="Mover item para cima"');
    expect(src).toContain('aria-label="Mover item para baixo"');
  });

  it("has label htmlFor associations on FAQ fields", () => {
    const src = readSource();
    expect(src).toMatch(/htmlFor=.*faq-question/);
    expect(src).toMatch(/htmlFor=.*faq-answer/);
  });

  it("has ticket status filter aria-label", () => {
    const src = readSource();
    expect(src).toContain('aria-label="Filtrar chamados por status"');
  });

  it("uses .ticket-card class instead of inline grid styles on tickets", () => {
    const src = readSource();
    expect(src).toContain('className="ticket-card"');
  });

  it("has isDirty state tracking", () => {
    const src = readSource();
    expect(src).toContain("isDirty");
  });

  it("disables save when hasValidationErrors", () => {
    const src = readSource();
    expect(src).toContain("hasValidationErrors");
  });

  it("has FAQ limit notice at 20", () => {
    const src = readSource();
    expect(src).toContain("Limite de 20 perguntas atingido");
  });

  it("uses TICKETS_PER_PAGE constant", () => {
    const src = readSource();
    expect(src).toContain("TICKETS_PER_PAGE");
  });

  it("uses ordered list semantics for FAQ items", () => {
    const src = readSource();
    expect(src).toMatch(/<ol[\s>]/);
  });

  it("has keyboard escape handler on confirm strip", () => {
    const src = readSource();
    expect(src).toContain("Escape");
  });
});
