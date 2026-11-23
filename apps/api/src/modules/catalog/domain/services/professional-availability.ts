import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { assertServiceTimeZone } from "./service-professional-input.js";
import { serviceStartInstant } from "./service-schedule.js";
import { FIXED_SERVICE_TIME_ZONE } from "./fixed-service-time-zone.js";

export interface AvailabilityInterval { startsAt: Date; endsAt: Date }
export interface ProfessionalAvailabilitySource {
  professionalVersion: number;
  policyVersion: number | null;
  timeZone: string;
  durationMinutes: number;
  recurring: Array<{ weekday: number; startMinute: number; endMinute: number; timeZone: string; validFrom: Date | null; validUntil: Date | null }>;
  exceptions: Array<AvailabilityInterval & { kind: "one_off" | "block" }>;
  appointments: AvailabilityInterval[];
}
export interface ProfessionalAvailabilityQuery { fromDate: string; toDate: string; now: Date; expectedVersion?: number }
export interface ProfessionalSlot { startsAt: string; endsAt: string; date: string; startTime: string; timeZone: string; durationMinutes: number }

const minute = 60_000, day = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
  return formatters.get(timeZone)!;
}
export function professionalLocalDate(instant: Date, timeZone: string) { return localParts(instant, timeZone).date; }
function localParts(instant: Date, timeZone: string) {
  const parts = formatter(timeZone).formatToParts(instant), part = (name: string) => parts.find(item => item.type === name)!.value;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}
function dateEpoch(value: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("invalid_availability_date");
  const result = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(result) || new Date(result).toISOString().slice(0, 10) !== value) throw new BadRequestException("invalid_availability_date");
  return result;
}
export function validateAvailabilityWindow(input: ProfessionalAvailabilityQuery) {
  const start = dateEpoch(input.fromDate), end = dateEpoch(input.toDate);
  if (end < start || end - start >= 31 * day || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())
    || (input.expectedVersion !== undefined && (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1))) throw new BadRequestException("invalid_availability_window");
  return { start, end };
}
function boundary(date: string, wallMinute: number, timeZone: string, end: boolean): number | undefined {
  if (wallMinute === 1440) return boundary(new Date(dateEpoch(date) + day).toISOString().slice(0, 10), 0, timeZone, end);
  const time = `${String(Math.floor(wallMinute / 60)).padStart(2, "0")}:${String(wallMinute % 60).padStart(2, "0")}`;
  const exact = serviceStartInstant(date, time, timeZone);
  if (exact) return exact.getTime();
  // Distinguish a DST gap from a repeated wall time without selecting an
  // ambiguous appointment start. Source boundaries clip conservatively.
  const target = Date.parse(`${date}T${time}:00Z`), candidates = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = target + hours * 3_600_000, parts = localParts(new Date(sample), timeZone);
    const offset = Date.parse(parts.date + "T" + parts.time + ":00Z") - sample;
    const candidate = target - offset, local = localParts(new Date(candidate), timeZone);
    if (local.date === date && local.time === time) candidates.add(candidate);
  }
  if (candidates.size) return end ? Math.min(...candidates) : Math.max(...candidates);
  // A missing wall boundary has no elapsed capacity. Advance to the first
  // representable minute; every actual slot start is checked separately.
  for (let next = wallMinute + 1; next <= Math.min(1440, wallMinute + 180); next++) {
    if (next === 1440) return boundary(date, next, timeZone, end);
    const found = serviceStartInstant(date, `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`, timeZone);
    if (found) return found.getTime();
  }
  return undefined;
}
type Range = { start: number; end: number };
function union(input: Range[]): Range[] {
  const result: Range[] = [];
  for (const item of input.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = result.at(-1);
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else result.push({ ...item });
  }
  return result;
}
function interval(value: AvailabilityInterval): Range {
  const start = value.startsAt?.getTime(), end = value.endsAt?.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new ServiceUnavailableException("availability_invalid_source");
  return { start, end };
}

function firstEndingAfter(ranges: Range[], point: number): Range | undefined {
  let low = 0, high = ranges.length;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (ranges[middle]!.end <= point) low = middle + 1; else high = middle; }
  return ranges[low];
}
type Origin = Range & { anchor: number };

/** New selections use Brasilia's civil date window. Each historical recurring
 * row still owns its original IANA conversion inside the generic resolver. */
export function resolveNewProfessionalAvailability(source: ProfessionalAvailabilitySource, input: ProfessionalAvailabilityQuery) {
  assertServiceTimeZone(source.timeZone);
  return resolveProfessionalAvailability({ ...source, timeZone: FIXED_SERVICE_TIME_ZONE }, input);
}

export function resolveProfessionalAvailability(source: ProfessionalAvailabilitySource, input: ProfessionalAvailabilityQuery) {
  const window = validateAvailabilityWindow(input);
  assertServiceTimeZone(source.timeZone);
  if (!Number.isInteger(source.durationMinutes) || source.durationMinutes < 5 || source.durationMinutes > 480 || source.recurring.length > 100 || source.exceptions.length > 5000 || source.appointments.length > 10000) throw new ServiceUnavailableException("availability_source_limit");
  const base = { professionalVersion: source.professionalVersion, policyVersion: source.policyVersion, timeZone: source.timeZone, durationMinutes: source.durationMinutes, asOf: input.now.toISOString() };
  if (input.expectedVersion !== undefined && input.expectedVersion !== source.professionalVersion) return { ...base, status: "stale" as const, dates: [] as string[], slots: [] as ProfessionalSlot[] };
  const origins: Origin[] = [];
  // Source dates belong to each rule's zone, rather than the presentation
  // zone. Two days cover supported offset differences and an eight-hour end.
  for (let date = window.start - 2 * day; date <= window.end + 2 * day; date += day) {
    const text = new Date(date).toISOString().slice(0, 10), weekday = new Date(date).getUTCDay();
    for (const row of source.recurring) if (row.weekday === weekday) {
      const anchor = boundary(text, row.startMinute, row.timeZone, false), end = boundary(text, row.endMinute, row.timeZone, true);
      if (anchor === undefined || end === undefined || anchor >= end) continue;
      const clipped = { anchor, start: Math.max(anchor, row.validFrom?.getTime() ?? -Infinity), end: Math.min(end, row.validUntil?.getTime() ?? Infinity) };
      if (clipped.start < clipped.end) origins.push(clipped);
    }
  }
  for (const value of source.exceptions) if (value.kind === "one_off") { const range = interval(value); origins.push({ ...range, anchor: range.start }); }
  const coverage = union(origins.map(({ start, end }) => ({ start, end })));
  const blocked = union([...source.exceptions.filter(item => item.kind === "block").map(interval), ...source.appointments.map(interval)]);
  const duration = source.durationMinutes * minute, phases = new Map<number, Range[]>();
  // Same elapsed phase means the original anchors describe the exact same
  // grid. Merging start ranges deduplicates work without moving an anchor.
  for (const origin of origins) {
    if (origin.anchor % minute !== 0) continue;
    const phase = ((origin.anchor % duration) + duration) % duration;
    const ranges = phases.get(phase) ?? []; ranges.push({ start: origin.start, end: origin.end }); phases.set(phase, ranges);
  }
  const lower = boundary(input.fromDate, 0, source.timeZone, false), upper = boundary(input.toDate, 1440, source.timeZone, true);
  const slots: ProfessionalSlot[] = [], seen = new Set<string>(); let scanned = 0;
  if (lower !== undefined && upper !== undefined) for (const [phase, ranges] of phases) for (const range of union(ranges)) {
    const first = phase + Math.ceil((Math.max(range.start, lower, input.now.getTime() + 1) - phase) / duration) * duration;
    for (let start = first; start < range.end && start < upper; start += duration) {
      if (++scanned > 50_000) throw new ServiceUnavailableException("availability_candidate_limit");
      const end = start + duration, offered = firstEndingAfter(coverage, start);
      if (!offered || offered.start > start || offered.end < end) continue;
      const occupied = firstEndingAfter(blocked, start);
      if (occupied && occupied.start < end) continue;
      const local = localParts(new Date(start), source.timeZone);
      if (local.date < input.fromDate || local.date > input.toDate || !serviceStartInstant(local.date, local.time, source.timeZone)) continue;
      const startsAt = new Date(start).toISOString(), endsAt = new Date(end).toISOString(), key = startsAt + "/" + endsAt;
      if (seen.has(key)) continue; seen.add(key);
      slots.push({ startsAt, endsAt, date: local.date, startTime: local.time, timeZone: source.timeZone, durationMinutes: source.durationMinutes });
      if (slots.length > 10000) throw new ServiceUnavailableException("availability_slot_limit");
    }
  }
  slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { ...base, status: slots.length ? "ready" as const : "empty" as const, dates: [...new Set(slots.map(slot => slot.date))], slots };
}
