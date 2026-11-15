import { BadRequestException } from "@nestjs/common";
import { assertServiceTimeZone } from "./service-professional-input.js";

export interface RecurringAvailabilityInput {
  timeZone: string;
  rows: Array<{ weekday: number; startMinute: number; endMinute: number; validFrom?: string | null; validUntil?: string | null }>;
}

export function parseServiceInstant(value: unknown, code = "invalid_availability_instant"): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new BadRequestException(code);
  const result = new Date(value);
  const date = new Date(value.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(result.getTime()) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new BadRequestException(code);
  return result;
}

export function assertAvailabilityMinutePrecision(instant: Date): void {
  if (instant.getUTCSeconds() !== 0 || instant.getUTCMilliseconds() !== 0) throw new BadRequestException("availability_minute_precision_required");
}

export function validateRecurringAvailability(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("invalid_recurring_availability");
  const input = raw as RecurringAvailabilityInput;
  if (Object.keys(input).some(key => !["timeZone", "rows"].includes(key))) throw new BadRequestException("invalid_recurring_availability");
  assertServiceTimeZone(input.timeZone);
  if (!Array.isArray(input.rows) || input.rows.length > 100) throw new BadRequestException("invalid_recurring_rows");
  const rows = input.rows.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(key => !["weekday", "startMinute", "endMinute", "validFrom", "validUntil"].includes(key))
      || !Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6 || !Number.isInteger(row.startMinute) || !Number.isInteger(row.endMinute)
      || row.startMinute < 0 || row.endMinute > 1440 || row.endMinute <= row.startMinute) throw new BadRequestException("invalid_recurring_interval");
    const validFrom = row.validFrom == null ? null : parseServiceInstant(row.validFrom);
    const validUntil = row.validUntil == null ? null : parseServiceInstant(row.validUntil);
    for (const instant of [validFrom, validUntil]) if (instant) assertAvailabilityMinutePrecision(instant);
    if (validFrom && validUntil && validFrom >= validUntil) throw new BadRequestException("invalid_recurring_validity");
    return { weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute, validFrom, validUntil, timeZone: input.timeZone };
  });
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i]!, b = rows[j]!;
    if (a.weekday === b.weekday && a.startMinute < b.endMinute && b.startMinute < a.endMinute
      && (a.validFrom?.getTime() ?? -Infinity) < (b.validUntil?.getTime() ?? Infinity)
      && (b.validFrom?.getTime() ?? -Infinity) < (a.validUntil?.getTime() ?? Infinity)) throw new BadRequestException("overlapping_recurring_intervals");
  }
  return { timeZone: input.timeZone, rows };
}
