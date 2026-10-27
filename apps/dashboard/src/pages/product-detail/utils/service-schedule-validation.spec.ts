import { describe, it, expect } from "vitest";
import { validateProductMetadata } from "./product-validation.js";
import { serviceScheduleFormError } from "./service-schedule-validation.js";
describe("service schedule form", () => {
  const value = { timeZone: "America/Sao_Paulo", durationMinutes: 30, slots: [{ id: "a", date: "2030-10-04", startTime: "09:00" }] };
  it("preserves optional legacy configuration and allows an empty unavailable draft", () => {
    expect(serviceScheduleFormError(undefined)).toBeUndefined();
    expect(serviceScheduleFormError(value)).toBeUndefined();
    expect(serviceScheduleFormError({ ...value, slots: [] })).toBeUndefined();
  });
  it("blocks incomplete dates, invalid zones and duration", () => {
    for (const change of [{ timeZone: "wrong/zone" }, { durationMinutes: 0 }, { durationMinutes: NaN }, { slots: [{ id: "a", date: "2030-02-30", startTime: "09:00" }] }]) {
      expect(validateProductMetadata("service", { serviceSchedule: { ...value, ...change } }).serviceSchedule).toBeTruthy();
    }
  });
  it("detects collisions after sorting, across day boundaries", () => {
    expect(serviceScheduleFormError({ ...value, slots: [{ id: "a", date: "2030-10-04", startTime: "23:45" }, { id: "b", date: "2030-10-05", startTime: "00:00" }] })).toContain("sobrepõem");
    expect(serviceScheduleFormError({ ...value, slots: [value.slots[0], { id: "b", date: "2030-10-04", startTime: "09:30" }] })).toBeUndefined();
  });
});
