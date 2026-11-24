import { describe, expect, it } from "vitest";
import { availabilityWallInstant, availabilityInstantWall, formatAvailabilityInstant, recurringAvailabilityPayload, availabilityExceptionPayload, deactivateAvailabilityExceptionPayload, createRecurringAvailabilityDraft } from "./availability-form.js";

describe("T78 availability payload criteria", () => {
  it("resolves the same civil choice using the professional zone rather than the browser zone", () => {
    expect(availabilityWallInstant("2027-01-04T09:00", "America/Sao_Paulo")).toBe("2027-01-04T12:00:00.000Z");
    expect(availabilityWallInstant("2027-01-04T09:00", "America/Manaus")).toBe("2027-01-04T13:00:00.000Z");
    expect(availabilityInstantWall("2027-01-04T13:00:00.000Z", "America/Manaus")).toBe("2027-01-04T09:00");
  });
  it.each(["2027-02-30T09:00", "2027-01-04T24:00", "2027-01-04T09:60", "2027-01-04T09:00:30", ""])("rejects an invalid minute-precision civil input %s", value => {
    expect(() => availabilityWallInstant(value, "America/Sao_Paulo")).toThrow("invalid_availability_wall_time");
  });
  it("rejects a nonexistent or repeated DST time instead of choosing an arbitrary instant", () => {
    expect(() => availabilityWallInstant("2026-03-08T02:30", "America/New_York")).toThrow("ambiguous_or_missing_availability_time");
    expect(() => availabilityWallInstant("2026-11-01T01:30", "America/New_York")).toThrow("ambiguous_or_missing_availability_time");
  });
  it("rejects an invalid IANA zone before producing any write payload", () => {
    expect(() => availabilityWallInstant("2027-01-04T09:00", "Invalid/Zone")).toThrow("invalid_availability_timezone");
  });
  it("preserves the version, absolute validity bounds and midnight end of a recurring row", () => {
    const draft = { timeZone: "America/Manaus", rows: [{ weekday: 1, startTime: "22:00", endTime: "24:00", validFrom: "2027-01-01T00:00:00.000Z", validUntil: "2027-02-01T00:00:00.000Z" }] };
    expect(recurringAvailabilityPayload(draft, 7)).toEqual({ expectedVersion: 7, timeZone: "America/Manaus", rows: [{ weekday: 1, startMinute: 1320, endMinute: 1440, validFrom: draft.rows[0].validFrom, validUntil: draft.rows[0].validUntil }] });
    expect(draft.rows[0].startTime).toBe("22:00");
  });
  it("allows adjacent intervals without inventing overlapping capacity", () => {
    expect(recurringAvailabilityPayload({ timeZone: "America/Sao_Paulo", rows: [{ weekday: 1, startTime: "09:00", endTime: "10:00" }, { weekday: 1, startTime: "10:00", endTime: "11:00" }] }, 2).rows).toEqual([{ weekday: 1, startMinute: 540, endMinute: 600 }, { weekday: 1, startMinute: 600, endMinute: 660 }]);
  });
  it("retains identical wall intervals with disjoint existing validity windows", () => {
    const first = { weekday: 1, startTime: "09:00", endTime: "10:00", validUntil: "2027-02-01T00:00:00Z" }, second = { ...first, validFrom: first.validUntil, validUntil: null };
    expect(recurringAvailabilityPayload({ timeZone: "America/Sao_Paulo", rows: [first, second] }, 2).rows).toHaveLength(2);
  });
  it.each([
    [{ weekday: 7, startTime: "09:00", endTime: "10:00" }],
    [{ weekday: 1, startTime: "10:00", endTime: "09:00" }],
    [{ weekday: 1, startTime: "24:00", endTime: "24:00" }],
    [{ weekday: 1, startTime: "09:00", endTime: "10:00" }, { weekday: 1, startTime: "09:30", endTime: "11:00" }],
  ].map(rows => [rows]))("rejects an invalid or overlapping recurring set %j", rows => {
    expect(() => recurringAvailabilityPayload({ timeZone: "America/Sao_Paulo", rows }, 1)).toThrow();
  });
  it("does not truncate a set beyond the server100-row limit", () => {
    expect(() => recurringAvailabilityPayload({ timeZone: "America/Sao_Paulo", rows: Array.from({ length: 101 }, () => ({ weekday: 1, startTime: "09:00", endTime: "10:00" })) }, 1)).toThrow("invalid_recurring_rows");
  });
  it.each([0, 1.5, NaN])("rejects an invalid CAS version %s", version => {
    expect(() => recurringAvailabilityPayload({ timeZone: "America/Sao_Paulo", rows: [] }, version)).toThrow("invalid_expected_version");
  });
  it.each(["one_off", "block"] as const)("builds a %s with explicit instants and the professional timezone", kind => {
    expect(availabilityExceptionPayload({ kind, startsAt: "2027-01-04T09:00", endsAt: "2027-01-04T10:00", timeZone: "America/Manaus", reason: "Motivo local" }, 8)).toEqual({ expectedVersion: 8, kind, startsAt: "2027-01-04T13:00:00.000Z", endsAt: "2027-01-04T14:00:00.000Z", timeZone: "America/Manaus", reason: "Motivo local", isActive: true });
  });
  it("rejects reversed exception intervals before sending a command", () => {
    expect(() => availabilityExceptionPayload({ kind: "block", startsAt: "2027-01-04T10:00", endsAt: "2027-01-04T09:00", timeZone: "America/Sao_Paulo", reason: "" }, 2)).toThrow("invalid_availability_interval");
  });
  it("opens recurring rows using their real wall minutes and preserves existing absolute bounds", () => {
    const row = { weekday: 2, startMinute: 480, endMinute: 1440, validFrom: "2027-01-01T00:00:00Z", validUntil: null };
    expect(createRecurringAvailabilityDraft("America/Manaus", [row])).toEqual({ timeZone: "America/Manaus", rows: [{ weekday: 2, startTime: "08:00", endTime: "24:00", validFrom: row.validFrom, validUntil: null }] });
  });
  it("deactivates a known exception using the current professional version and preserves its exact historical interval", () => {
    const original = { kind: "block" as const, startsAt: "2027-01-04T12:00:30.000Z", endsAt: "2027-01-04T13:00:30.000Z", timeZone: "America/Sao_Paulo", reason: null };
    const before = structuredClone(original);
    expect(deactivateAvailabilityExceptionPayload(original, 17)).toEqual({ expectedVersion: 17, ...original, isActive: false });
    expect(original).toEqual(before);
  });

  it("displays both local dates across midnight in the explicit Manaus timezone", () => {
    const start = "2030-02-04T03:30:00.000Z", end = "2030-02-04T04:30:00.000Z";
    expect([formatAvailabilityInstant(start, "America/Manaus"), formatAvailabilityInstant(end, "America/Manaus")].join("–")).toBe("03/02/2030 23:30–04/02/2030 00:30");
  });
  it("displays the same UTC interval using the explicit Sao Paulo timezone", () => {
    const start = "2030-02-04T03:30:00.000Z", end = "2030-02-04T04:30:00.000Z";
    expect([formatAvailabilityInstant(start, "America/Sao_Paulo"), formatAvailabilityInstant(end, "America/Sao_Paulo")].join("–")).toBe("04/02/2030 00:30–04/02/2030 01:30");
  });
});
