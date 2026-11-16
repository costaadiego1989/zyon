import { expect, it } from "vitest";
import { formatCouponDate } from "./CouponsPage.js";

it.each(["America/Sao_Paulo", "UTC", "Asia/Tokyo"])("preserves the selected coupon day in %s", zone => {
  const previous = process.env.TZ; process.env.TZ = zone;
  try {
    expect(formatCouponDate("2026-11-16")).toBe("16/11/2026");
    expect(formatCouponDate("2026-11-16T00:00:00.000Z")).toBe("16/11/2026");
    expect(formatCouponDate("2026-01-01T00:00:00.000Z")).toBe("01/01/2026");
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
it("displays unavailable for an invalid coupon date", () => { expect(formatCouponDate("invalid")).toBe("Data indisponível"); });
it.each(["2026-02-29", "2026-02-29T00:00:00.000Z", "2026-04-31", "2026-04-31T12:00:00Z", "2026-00-01", "2026-13-01"])("rejects invalid normalized coupon date %s", value => {
  expect(formatCouponDate(value)).toBe("Data indisponível");
});
it("preserves valid coupon leap days in both API forms", () => {
  expect(formatCouponDate("2028-02-29")).toBe("29/02/2028");
  expect(formatCouponDate("2028-02-29T00:00:00.000Z")).toBe("29/02/2028");
});
