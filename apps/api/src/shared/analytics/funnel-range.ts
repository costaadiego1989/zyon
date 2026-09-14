import { BadRequestException } from "@nestjs/common";

/** Date-only filters and "today" use UTC, independently of the server timezone.
 * Explicit ISO timestamps retain their instant instead of being rounded to a day.
 */
export function resolveFunnelRange(
  period: "today" | "7d" | "30d" | "90d",
  range?: { from?: string; to?: string },
  now = new Date(),
): { from: Date; to: Date } {
  if (range?.from || range?.to) {
    if (!range.from || !range.to) throw new BadRequestException("funnel_range_incomplete");
    const parse = (value: string, end: boolean): Date => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const day = new Date(value + "T00:00:00.000Z");
        if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) {
          throw new BadRequestException("funnel_range_invalid");
        }
        if (end) day.setUTCHours(23, 59, 59, 999);
        return day;
      }
      const instant = new Date(value);
      if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(instant.getTime())) {
        throw new BadRequestException("funnel_range_invalid");
      }
      const calendarDay = new Date(value.slice(0, 10) + "T00:00:00.000Z");
      if (!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== value.slice(0, 10)) {
        throw new BadRequestException("funnel_range_invalid");
      }
      return instant;
    };
    const from = parse(range.from, false);
    const to = parse(range.to, true);
    if (from > to) throw new BadRequestException("funnel_range_reversed");
    return { from, to };
  }
  const from = new Date(now);
  if (period === "today") from.setUTCHours(0, 0, 0, 0);
  else from.setUTCDate(from.getUTCDate() - ({ "7d": 7, "30d": 30, "90d": 90 }[period] ?? 7));
  return { from, to: new Date(now) };
}
