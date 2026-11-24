/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it } from "vitest";
import { ServiceAppointmentsPage } from "./ServiceAppointmentsPage.js";
import { appointmentPageQuery, appointmentPageHash } from "./service-appointments-filters.js";
import { detailFixture } from "../service-attendance/components/appointment-detail.test-fixture.js";
import { manualDetail, manualClick, manualSelect } from "../service-attendance/components/manual-appointment.test-fixture.js";
import type { AppointmentDetailProps } from "../service-attendance/components/useAppointmentDetail.js";

describe("T103 canonical service filter", () => {
  it("retains the exact service selector in direct URLs and canonical history without a cursor", () => {
    const query = { fromDate: "2030-01-01", toDate: "2030-01-03", productId: "service-a", professionalId: "professional-a" };
    expect(appointmentPageQuery("#service-appointments?fromDate=2030-01-01&toDate=2030-01-03&professionalId=professional-a&productId=service-a&cursor=old", "2030-01-02")).toEqual(query);
    const hash = appointmentPageHash(query);
    expect(new URLSearchParams(hash.split("?")[1]).get("productId")).toBe("service-a");
    expect(appointmentPageQuery(hash, "2030-01-02")).toEqual(query);
  });
  it("consults the scoped existing catalogue and applies the selected service to the actual page read", async () => {
    let initial = true;
    function Page(props: AppointmentDetailProps) {
      if (initial) { initial = false; window.history.replaceState(null, "", "/#service-appointments?fromDate=2030-01-01&toDate=2030-01-03"); }
      return <ServiceAppointmentsPage me={props.me} />;
    }
    const f = await detailFixture(Page, { handle: request => {
      if (request.method !== "GET" || !request.path.endsWith("/service-appointments")) return undefined;
      const detail = manualDetail("at_attendance");
      return Response.json({ items: [{ ...detail, history: undefined, historyPartial: undefined, asOf: undefined }],
        totalCount: 1, nextCursor: null, countsByStatus: { pending: 0, scheduled: 1, in_service: 0, completed: 0, no_show: 0, cancelled: 0 },
        asOf: "2030-01-01T12:00:00Z", timeZone: "America/Sao_Paulo" });
    } });
    await manualClick("Consultar serviços para filtrar");
    const catalogue = f.requests.find(row => row.path.endsWith("/products"));
    expect(catalogue?.path).toBe("/v1/merchants/merchant-a/products");
    expect(catalogue?.query.get("status")).toBe("all");
    await manualSelect("Serviço", "service-a");
    await manualClick("Aplicar filtros");
    const read = f.requests.filter(row => row.path.endsWith("/service-appointments")).at(-1)!;
    expect(read.query.get("productId")).toBe("service-a");
    expect(read.query.has("cursor")).toBe(false);
    expect(new URLSearchParams(window.location.hash.split("?")[1]).get("productId")).toBe("service-a");
    expect(document.querySelector('[data-appointment-id="appointment-a"]')).not.toBeNull();
    expect(f.writes()).toEqual([]);
  });
});
