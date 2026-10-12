export const DASHBOARD_TIME_ZONE = "America/Sao_Paulo";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DASHBOARD_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});
const instantFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DASHBOARD_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function businessDateKey(date: Date): string {
  const parts = dateFormatter.formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addBusinessDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** Resolve calendar midnight with the named timezone, never the server's TZ. */
export function businessDayStart(day: string): Date {
  const target = new Date(`${day}T00:00:00.000Z`).getTime();
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = instantFormatter.formatToParts(new Date(instant));
    const part = (type: string) => Number(parts.find(item => item.type === type)!.value);
    const local = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    const correction = target - local;
    instant += correction;
    if (!correction) break;
  }
  return new Date(instant);
}

export function resolveBusinessPeriod(period: "today" | "7d" | "30d" | "90d", now = new Date()) {
  const days = ({ today: 1, "7d": 7, "30d": 30, "90d": 90 } as const)[period] ?? 7;
  const firstDay = addBusinessDays(businessDateKey(now), -(days - 1));
  const dates = Array.from({ length: days }, (_, index) => addBusinessDays(firstDay, index));
  return { from: businessDayStart(firstDay), to: new Date(now), days, dates };
}
