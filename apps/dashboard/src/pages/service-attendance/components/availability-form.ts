import type { ServiceRecurringAvailabilityInput, ServiceAvailabilityExceptionInput, ServiceRecurringAvailabilityDTO, ServiceAvailabilityExceptionDTO } from "../../../api/endpoints/service-attendance.js";

export interface RecurringRowDraft { weekday: number; startTime: string; endTime: string; validFrom?: string | null; validUntil?: string | null }
export interface RecurringAvailabilityDraft { timeZone: string; rows: RecurringRowDraft[] }
export interface AvailabilityExceptionDraft { kind: "one_off" | "block"; startsAt: string; endsAt: string; timeZone: string; reason: string }

function zoneFormatter(timeZone: string) {
  try {
    if (!timeZone || timeZone.length > 80) throw new Error();
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch { throw new Error("invalid_availability_timezone"); }
}
function civilAt(instant: number, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(new Date(instant)), part = (key: string) => parts.find(item => item.type === key)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
/** Form conversion only. The API still validates zone, capacity and conflicts. */
export function availabilityWallInstant(value: string, timeZone: string): string {
  const formatter = zoneFormatter(timeZone);
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("invalid_availability_wall_time");
  const wall = Date.parse(value + ":00Z");
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== value) throw new Error("invalid_availability_wall_time");
  const candidates = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = wall + hours * 3_600_000, offset = Date.parse(civilAt(sample, formatter) + ":00Z") - sample;
    const candidate = wall - offset;
    if (civilAt(candidate, formatter) === value) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new Error("ambiguous_or_missing_availability_time");
  return new Date([...candidates][0]!).toISOString();
}
export function availabilityInstantWall(value: string, timeZone: string): string {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new Error("invalid_availability_instant");
  return civilAt(instant, zoneFormatter(timeZone));
}
/** Presentation only; the existing IANA conversion remains the authority. */
export function formatAvailabilityInstant(value: string, timeZone: string): string {
  const [date, time] = availabilityInstantWall(value, timeZone).split("T");
  return `${date!.split("-").reverse().join("/")} ${time}`;
}
function expected(version: number) {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("invalid_expected_version");
}
function minutes(value: string, end = false): number {
  if (end && value === "24:00") return 1440;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("invalid_recurring_interval");
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
export function recurringAvailabilityPayload(draft: RecurringAvailabilityDraft, version: number): ServiceRecurringAvailabilityInput {
  expected(version); zoneFormatter(draft.timeZone);
  if (!Array.isArray(draft.rows) || draft.rows.length > 100) throw new Error("invalid_recurring_rows");
  const rows = draft.rows.map(row => {
    const startMinute = minutes(row.startTime), endMinute = minutes(row.endTime, true);
    if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6 || startMinute >= endMinute) throw new Error("invalid_recurring_interval");
    for (const value of [row.validFrom, row.validUntil]) if (value != null && (!Number.isFinite(Date.parse(value)) || Date.parse(value) % 60_000 !== 0)) throw new Error("invalid_recurring_validity");
    if (row.validFrom && row.validUntil && Date.parse(row.validFrom) >= Date.parse(row.validUntil)) throw new Error("invalid_recurring_validity");
    return { weekday: row.weekday, startMinute, endMinute, ...(row.validFrom === undefined ? {} : { validFrom: row.validFrom }), ...(row.validUntil === undefined ? {} : { validUntil: row.validUntil }) };
  });
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i]!, b = rows[j]!;
    if (a.weekday === b.weekday && a.startMinute < b.endMinute && b.startMinute < a.endMinute
      && (a.validFrom ? Date.parse(a.validFrom) : -Infinity) < (b.validUntil ? Date.parse(b.validUntil) : Infinity)
      && (b.validFrom ? Date.parse(b.validFrom) : -Infinity) < (a.validUntil ? Date.parse(a.validUntil) : Infinity)) throw new Error("overlapping_recurring_intervals");
  }
  return { expectedVersion: version, timeZone: draft.timeZone, rows };
}
export function availabilityExceptionPayload(draft: AvailabilityExceptionDraft, version: number): ServiceAvailabilityExceptionInput {
  expected(version);
  if (!["one_off", "block"].includes(draft.kind) || typeof draft.reason !== "string" || draft.reason.length > 1200) throw new Error("invalid_availability_exception");
  const startsAt = availabilityWallInstant(draft.startsAt, draft.timeZone), endsAt = availabilityWallInstant(draft.endsAt, draft.timeZone);
  if (startsAt >= endsAt) throw new Error("invalid_availability_interval");
  return { expectedVersion: version, kind: draft.kind, startsAt, endsAt, timeZone: draft.timeZone, reason: draft.reason, isActive: true };
}

export function createRecurringAvailabilityDraft(timeZone: string, rows: Array<Pick<ServiceRecurringAvailabilityDTO, "weekday" | "startMinute" | "endMinute" | "validFrom" | "validUntil">>): RecurringAvailabilityDraft {
  const wall = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return { timeZone, rows: rows.map(row => ({ weekday: row.weekday, startTime: wall(row.startMinute), endTime: wall(row.endMinute), validFrom: row.validFrom, validUntil: row.validUntil })) };
}
/** Removal preserves the actual old interval, including preexisting seconds or zone. */
export function deactivateAvailabilityExceptionPayload(original: Pick<ServiceAvailabilityExceptionDTO, "kind" | "startsAt" | "endsAt" | "timeZone" | "reason">, version: number): ServiceAvailabilityExceptionInput {
  expected(version);
  return { expectedVersion: version, kind: original.kind, startsAt: original.startsAt, endsAt: original.endsAt, timeZone: original.timeZone, reason: original.reason, isActive: false };
}
