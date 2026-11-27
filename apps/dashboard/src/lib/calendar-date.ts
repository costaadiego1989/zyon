/** Validate the calendar portion before Date can normalize an impossible day. */
export function isExistingIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return false;
  const day = value.slice(0, 10), calendar = new Date(day + "T00:00:00.000Z");
  return Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === day
    && Number.isFinite(new Date(value).getTime());
}
