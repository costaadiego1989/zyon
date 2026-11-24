import { describe, expect, it } from "vitest";
import { appointmentPageQuery, appointmentPageHash } from "./service-appointments-filters.js";
describe("T103 canonical appointment page filters", () => {
  it("uses actual period/professional/category/status names and ignores public tenant and cursor parameters", () => { expect(appointmentPageQuery("#service-appointments?fromDate=2030-01-01&toDate=2030-01-02&professionalId=p&categoryId=c&status=scheduled&merchantId=foreign&cursor=old", "2030-01-01")).toEqual({ fromDate: "2030-01-01", toDate: "2030-01-02", professionalId: "p", categoryId: "c", status: "scheduled" }); });
  it("uses the supplied Brasilia day only for a fresh route without filter parameters", () => { expect(appointmentPageQuery("#service-appointments", "2030-01-03")).toEqual({ fromDate: "2030-01-03", toDate: "2030-01-03" }); });
  it("invalid periods and operational states remain invalid rather than silently querying another period", () => { expect(appointmentPageQuery("#service-appointments?fromDate=2030-02-30&toDate=2030-03-01", "2030-01-01")).toBeNull(); expect(appointmentPageQuery("#service-appointments?status=paid", "2030-01-01")).toBeNull(); });
  it("serializes only canonical query filters and has no pagination or tenant authority", () => { expect(appointmentPageHash({ fromDate: "2030-01-01", toDate: "2030-01-03", status: "pending" })).toBe("#service-appointments?fromDate=2030-01-01&toDate=2030-01-03&status=pending"); });
});
