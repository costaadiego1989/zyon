import assert from "node:assert/strict";
import { test } from "node:test";
import { businessDateKey, resolveBusinessPeriod } from "./business-period.js";
import { resolveFunnelRange } from "./funnel-range.js";

test("dashboard presets cover exactly N calendar days including today in São Paulo", () => {
  const now = new Date("2026-10-06T21:00:00.000Z");
  for (const [period, days, first] of [["today", 1, "2026-10-06"], ["7d", 7, "2026-09-30"], ["30d", 30, "2026-09-07"], ["90d", 90, "2026-07-09"]] as const) {
    const window = resolveBusinessPeriod(period, now);
    assert.equal(window.dates.length, days);
    assert.equal(window.dates[0], first);
    assert.equal(window.dates.at(-1), "2026-10-06");
    assert.equal(window.from.toISOString(), first + "T03:00:00.000Z");
    assert.equal(window.to.toISOString(), now.toISOString());
    assert.deepEqual(resolveFunnelRange(period, undefined, now), { from: window.from, to: window.to });
  }
});

test("UTC midnight does not advance the merchant calendar before local midnight", () => {
  const now = new Date("2026-10-06T01:30:00.000Z");
  assert.equal(businessDateKey(now), "2026-10-05");
  assert.equal(resolveBusinessPeriod("today", now).from.toISOString(), "2026-10-05T03:00:00.000Z");
});

test("date-only funnel range uses merchant days; explicit timestamps retain their instant", () => {
  assert.deepEqual(resolveFunnelRange("7d", { from: "2026-10-06", to: "2026-10-06" }), {
    from: new Date("2026-10-06T03:00:00.000Z"), to: new Date("2026-10-07T02:59:59.999Z"),
  });
  assert.equal(resolveFunnelRange("7d", { from: "2026-10-06T00:00:00Z", to: "2026-10-06T02:00:00Z" }).from.toISOString(), "2026-10-06T00:00:00.000Z");
  assert.throws(() => resolveFunnelRange("7d", { from: "2026-02-30", to: "2026-10-06" }), /funnel_range_invalid/);
  assert.throws(() => resolveFunnelRange("7d", { from: "2026-10-07", to: "2026-10-06" }), /funnel_range_reversed/);
});
