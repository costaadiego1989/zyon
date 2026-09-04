import { describe, expect, it } from "vitest";
import {
  getInitials,
  toCustomerRows,
  computeMetrics,
  filterRows,
  formatDate,
} from "./customers-page.js";
import type { TenantCustomer } from "../api-client.js";

// ── getInitials ─────────────────────────────────────────────────────────────

describe("getInitials", () => {
  it("returns two initials from full name: 'Maria Silva' → 'MS'", () => {
    expect(getInitials("Maria Silva")).toBe("MS");
  });

  it("returns single initial from single name: 'Maria' → 'M'", () => {
    expect(getInitials("Maria")).toBe("M");
  });

  it("returns '?' for empty string", () => {
    expect(getInitials("")).toBe("?");
  });

  it("returns '?' for dash name", () => {
    expect(getInitials("-")).toBe("?");
  });

  it("uses first and last parts for multi-word names", () => {
    expect(getInitials("Ana Maria Costa")).toBe("AC");
  });
});

// ── toCustomerRows ──────────────────────────────────────────────────────────

describe("toCustomerRows", () => {
  const customer: TenantCustomer = {
    id: "global_user_abc",
    profile: { full_name: "Maria Silva", email: "maria@test.com", phone: "+55 11 99999" },
    first_seen_at: "2026-06-01T10:00:00Z",
    last_seen_at: "2026-06-28T14:00:00Z",
  };

  it("maps TenantCustomer to CustomerRow with initials", () => {
    const rows = toCustomerRows([customer]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      globalUserId: "global_user_abc",
      name: "Maria Silva",
      email: "maria@test.com",
      phone: "+55 11 99999",
      firstSeen: "2026-06-01T10:00:00Z",
      lastSeen: "2026-06-28T14:00:00Z",
      initials: "MS",
    });
  });

  it("falls back to a placeholder name and its initials when name is missing", () => {
    const noName: TenantCustomer = {
      id: "u2",
      profile: {},
      first_seen_at: "2026-06-01T10:00:00Z",
      last_seen_at: "2026-06-01T10:00:00Z",
    };
    const rows = toCustomerRows([noName]);
    // Empty profiles render a friendly placeholder ("Cliente sem nome" → "CN")
    // instead of a bare dash, so the row still reads as a person.
    expect(rows[0].name).toBe("Cliente sem nome");
    expect(rows[0].initials).toBe("CN");
  });

  it("uses placeholders for missing email and phone", () => {
    const empty: TenantCustomer = {
      id: "u3",
      profile: {},
      first_seen_at: "2026-06-10T00:00:00Z",
      last_seen_at: "2026-06-10T00:00:00Z",
    };
    const rows = toCustomerRows([empty]);
    expect(rows[0].email).toBe("email@exemplo.com");
    expect(rows[0].phone).toBe("(00) 00000-0000");
  });
});

// ── formatDate ──────────────────────────────────────────────────────────────

describe("formatDate", () => {
  it("formats valid ISO date to pt-BR short", () => {
    const result = formatDate("2026-06-15T10:30:00Z");
    // pt-BR short format: DD/MM/YYYY HH:MM
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it("returns '-' for empty string", () => {
    expect(formatDate("")).toBe("-");
  });

  it("returns '-' for invalid date string", () => {
    expect(formatDate("not-a-date")).toBe("-");
  });

  it("returns '-' for undefined cast to string", () => {
    expect(formatDate(undefined as unknown as string)).toBe("-");
  });
});

// ── computeMetrics ──────────────────────────────────────────────────────────

describe("computeMetrics", () => {
  it("counts total from all rows", () => {
    const rows = [
      { globalUserId: "1", name: "A", email: "a@a.com", phone: "-", firstSeen: "2026-06-01T00:00:00Z", lastSeen: "2026-06-28T00:00:00Z", initials: "A" },
      { globalUserId: "2", name: "B", email: "b@b.com", phone: "-", firstSeen: "2026-06-10T00:00:00Z", lastSeen: "2026-06-10T00:00:00Z", initials: "B" },
    ];
    expect(computeMetrics(rows).total).toBe(2);
  });

  it("counts new in last 7 days based on firstSeen", () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const rows = [
      { globalUserId: "1", name: "A", email: "a@a.com", phone: "-", firstSeen: threeDaysAgo, lastSeen: threeDaysAgo, initials: "A" },
      { globalUserId: "2", name: "B", email: "b@b.com", phone: "-", firstSeen: tenDaysAgo, lastSeen: tenDaysAgo, initials: "B" },
    ];
    expect(computeMetrics(rows).newLast7Days).toBe(1);
  });

  it("computes returning rate as fraction of rows where firstSeen !== lastSeen", () => {
    const rows = [
      { globalUserId: "1", name: "A", email: "a@a.com", phone: "-", firstSeen: "2026-06-01T00:00:00Z", lastSeen: "2026-06-28T00:00:00Z", initials: "A" },
      { globalUserId: "2", name: "B", email: "b@b.com", phone: "-", firstSeen: "2026-06-10T00:00:00Z", lastSeen: "2026-06-10T00:00:00Z", initials: "B" },
    ];
    expect(computeMetrics(rows).returningRate).toBe(0.5);
  });

  it("returns zeros for empty array", () => {
    const metrics = computeMetrics([]);
    expect(metrics.total).toBe(0);
    expect(metrics.newLast7Days).toBe(0);
    expect(metrics.returningRate).toBe(0);
  });
});

// ── filterRows ──────────────────────────────────────────────────────────────

describe("filterRows", () => {
  const rows = [
    { globalUserId: "1", name: "Maria Silva", email: "maria@test.com", phone: "+55", firstSeen: "2026-06-01T00:00:00Z", lastSeen: "2026-06-28T00:00:00Z", initials: "MS" },
    { globalUserId: "2", name: "João Costa", email: "joao@test.com", phone: "+55", firstSeen: "2026-06-05T00:00:00Z", lastSeen: "2026-06-05T00:00:00Z", initials: "JC" },
    { globalUserId: "3", name: "Ana Pereira", email: "ana@corp.com", phone: "+55", firstSeen: "2026-06-10T00:00:00Z", lastSeen: "2026-06-20T00:00:00Z", initials: "AP" },
  ];

  it("returns all rows when term is empty", () => {
    expect(filterRows(rows, "")).toEqual(rows);
    expect(filterRows(rows, "   ")).toEqual(rows);
  });

  it("filters by name case-insensitive", () => {
    const result = filterRows(rows, "maria");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Maria Silva");
  });

  it("filters by email case-insensitive", () => {
    const result = filterRows(rows, "CORP.COM");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Ana Pereira");
  });

  it("ignores accents in search (NFD normalization)", () => {
    const result = filterRows(rows, "joao");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("João Costa");
  });

  it("returns empty array when nothing matches", () => {
    expect(filterRows(rows, "xyz-no-match")).toEqual([]);
  });
});
