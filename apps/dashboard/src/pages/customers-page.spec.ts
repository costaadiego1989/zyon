import { describe, expect, it } from "vitest";
import {
  getInitials,
  toCustomerRows,
  calculatePurchaseMetrics,
  filterRows,
  formatDate,
} from "./customers-page.js";
import { customerMetricPeriods, toCustomerKpis } from "./useCustomersPage.js";
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

describe("customer KPIs", () => {
  it("uses stable all-time and seven-day server periods", () => {
    expect(customerMetricPeriods(new Date("2026-09-10T12:00:00Z"))).toEqual({
      allTime: { dateFrom: "1970-01-01", dateTo: "2026-09-10" },
      last7Days: { dateFrom: "2026-09-04", dateTo: "2026-09-10" },
    });
  });

  it("uses completed-purchase metrics returned by the server", () => {
    expect(toCustomerKpis(
      { total_customers: 42, new_customers: 42, returning_customers: 0, repeat_rate: 0, period_from: "1970-01-01", period_to: "2026-09-10" },
      { total_customers: 8, new_customers: 3, returning_customers: 5, repeat_rate: 0.625, period_from: "2026-09-04", period_to: "2026-09-10" },
    )).toEqual({ totalCustomers: 42, newCustomersLast7Days: 3, repeatRateLast7Days: 0.625 });
  });
});

describe("calculatePurchaseMetrics", () => {
  it("uses the API total_minor amounts without producing NaN", () => {
    expect(calculatePurchaseMetrics([
      { order_id: "order-1", total_minor: 12_345, completed_at: "2026-09-01T00:00:00Z" },
      { order_id: "order-2", total_minor: 5_000, completed_at: "2026-09-02T00:00:00Z" },
    ])).toEqual({ totalOrders: 2, totalRevenue: 173.45, avgTicket: 86.725 });
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
