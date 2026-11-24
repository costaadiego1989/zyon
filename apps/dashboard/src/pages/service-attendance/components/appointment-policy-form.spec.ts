import { describe, expect, it } from "vitest";
import { appointmentPolicyDraft, appointmentPolicyUpdate } from "./appointment-policy-form.js";
import type { ServiceBusinessPolicyDTO } from "../../../api/endpoints/service-attendance.js";

const configured = (online: boolean, hold: boolean): ServiceBusinessPolicyDTO => ({ status: "configured", version: 7,
  policy: { paymentMode: online ? "online" : "at_attendance", holdEnabled: hold, holdMinutes: hold ? 8 : null, admissionsEnabled: true } });

describe("T81 canonical policy draft", () => {
  it("starts new online collection off without choosing a hold policy or admitting bookings", () => {
    expect(appointmentPolicyDraft({ status: "unconfigured", version: 0, policy: null })).toEqual({ expectedVersion: 0,
      online: false, hold: "", holdMinutes: "", admissionsEnabled: false });
  });
  for (const online of [true, false]) for (const hold of [true, false]) it(`preserves configured online=${online}/hold=${hold} through the canonical command`, () => {
    const dto = configured(online, hold), draft = appointmentPolicyDraft(dto);
    expect(appointmentPolicyUpdate(draft)).toEqual({ expectedVersion: 7, ...dto.policy });
  });
  it("switches collection off while retaining an at-attendance obligation and existing hold/admission", () => {
    const draft = appointmentPolicyDraft(configured(true, true));
    expect(appointmentPolicyUpdate({ ...draft, online: false })).toEqual({ expectedVersion: 7, paymentMode: "at_attendance",
      holdEnabled: true, holdMinutes: 8, admissionsEnabled: true });
  });
  it("requires an explicit hold choice and a valid duration when enabled", () => {
    const draft = appointmentPolicyDraft({ status: "unconfigured", version: 0, policy: null });
    expect(() => appointmentPolicyUpdate(draft)).toThrow(/reserva temporária/i);
    for (const value of ["", "0", "-1", "1.5", "2147483648", "5x"]) {
      expect(() => appointmentPolicyUpdate({ ...draft, hold: "on", holdMinutes: value })).toThrow(/minutos/i);
    }
    expect(appointmentPolicyUpdate({ ...draft, hold: "off", holdMinutes: "ignored" }).holdMinutes).toBeNull();
  });
  it("does not initialize an invalid saved policy as a new business", () => {
    expect(() => appointmentPolicyDraft({ status: "invalid", version: 9, policy: null })).toThrow(/service_policy_invalid/);
  });
});
