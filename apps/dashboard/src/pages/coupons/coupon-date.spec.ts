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
