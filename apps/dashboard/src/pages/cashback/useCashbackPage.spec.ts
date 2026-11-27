import { describe, expect, it } from "vitest";
import { cashbackInitialPeriod, cashbackPeriodQuery, cashbackPresetPeriod } from "./useCashbackPage.js";

describe("cashback reporting periods", () => {
  it("CBX-11 covers the real 23-hour Brasília day when DST skips midnight", () => {
    const query = cashbackPeriodQuery("2018-11-04", "2018-11-04");
    expect(query).toEqual({ from: "2018-11-04T01:00:00-02:00", to: "2018-11-04T23:59:59.999-02:00" });
    expect(Date.parse(query.to) - Date.parse(query.from) + 1).toBe(23 * 3600000);
  });
  it("CBX-11 covers both occurrences of the repeated hour when Brasília DST ends", () => {
    const query = cashbackPeriodQuery("2018-02-17", "2018-02-17");
    expect(query).toEqual({ from: "2018-02-17T00:00:00-02:00", to: "2018-02-17T23:59:59.999-03:00" });
    expect(Date.parse(query.to) - Date.parse(query.from) + 1).toBe(25 * 3600000);
  });
  it("CBX-11 keeps invalid or reversed dates out of query construction", () => {
    for (const [from,to] of [["", "2026-11-18"], ["2026-02-30", "2026-03-01"], ["2026-11-19", "2026-11-18"]]) expect(cashbackPeriodQuery(from,to)).toEqual({from:"",to:""});
  });
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
