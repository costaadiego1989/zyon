import { describe, expect, it } from "vitest";
import { cashbackInitialPeriod, cashbackPeriodQuery, cashbackPresetPeriod } from "./useCashbackPage.js";

describe("cashback reporting periods", () => {
  it("keeps the initial current month in Brasília before UTC and local dates agree", () => {
    expect(cashbackInitialPeriod(new Date("2026-12-01T02:59:59Z"))).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(cashbackInitialPeriod(new Date("2026-12-01T03:00:00Z"))).toEqual({ from: "2026-12-01", to: "2026-12-01" });
  });

  it("uses the business day for Today even when the UTC date is tomorrow", () => {
    expect(cashbackPresetPeriod("today", new Date("2026-11-15T02:30:00Z"))).toEqual({ from: "2026-11-14", to: "2026-11-14" });
  });

  it.each([
    ["7d", "2026-01-03T18:00:00Z", "2025-12-28", "2026-01-03"],
    ["15d", "2026-11-14T18:00:00Z", "2026-10-31", "2026-11-14"],
    ["30d", "2024-03-01T18:00:00Z", "2024-02-01", "2024-03-01"],
  ] as const)("includes exactly the selected %s across calendar boundaries", (preset, now, from, to) => {
    expect(cashbackPresetPeriod(preset, new Date(now))).toEqual({ from, to });
  });

  it("keeps the complete first and last business days for queries and CSV exports", () => {
    const { from, to } = cashbackPresetPeriod("7d", new Date("2026-01-03T18:00:00Z"));
    expect(cashbackPeriodQuery(from, to)).toEqual({ from: "2025-12-28T00:00:00-03:00", to: "2026-01-03T23:59:59.999-03:00" });
  });
});
