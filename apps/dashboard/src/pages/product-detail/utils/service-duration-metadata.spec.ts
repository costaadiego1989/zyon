import { describe, expect, it } from "vitest";
import { withServiceDuration } from "./service-duration-metadata.js";

describe("T78 catalog preserves historical availability metadata", () => {
  it("edits duration without rewriting historical slot identities, dates, zone or extra metadata", () => {
    const original = { serviceType: "presencial", serviceLocation: "Sala 2", serviceSchedule: { timeZone: "America/Manaus", durationMinutes: 30, slots: [{ id: "historical-slot", date: "2027-01-04", startTime: "09:00" }], legacyAnnotation: "retained" }, privateExtra: { original: true } };
    const before = structuredClone(original), result = withServiceDuration(original, 45);
    expect(result).toEqual({ ...before, serviceSchedule: { ...before.serviceSchedule, durationMinutes: 45 } });
    expect(original).toEqual(before);
  });
  it("creates the existing duration contract with no independent legacy offered slots", () => {
    expect(withServiceDuration({ serviceType: "remoto" }, 30)).toEqual({ serviceType: "remoto", serviceSchedule: { timeZone: "America/Sao_Paulo", durationMinutes: 30, slots: [] } });
  });
  it.each([4, 481, 5.5, NaN])("rejects invalid duration %s without changing metadata", duration => {
    const original = { serviceSchedule: { timeZone: "America/Manaus", durationMinutes: 30, slots: [] } }, before = structuredClone(original);
    expect(() => withServiceDuration(original, duration)).toThrow("invalid_service_duration");
    expect(original).toEqual(before);
  });
  it.each([null, "unknown", { slots: null }])("does not erase malformed historical scheduling %j", serviceSchedule => {
    const original = { serviceSchedule }, before = structuredClone(original);
    expect(() => withServiceDuration(original, 30)).toThrow("historical_service_schedule_needs_review");
    expect(original).toEqual(before);
  });
});
