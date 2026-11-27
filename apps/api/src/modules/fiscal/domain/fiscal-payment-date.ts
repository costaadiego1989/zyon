export function fiscalCalendarDate(instant: string, timeZone: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(instant)) {
    if (
      !Number.isFinite(Date.parse(instant)) ||
      new Date(instant).toISOString().slice(0, 10) !== instant
    )
      throw new Error("fiscal_payment_date_invalid");
    return instant;
  }
  if (
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(instant) ||
    !Number.isFinite(Date.parse(instant))
  )
    throw new Error("fiscal_payment_timestamp_offset_required");
  try {
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(instant));
    return ["year", "month", "day"]
      .map((k) => p.find((p) => p.type === k)!.value)
      .join("-");
  } catch {
    throw new Error("fiscal_payment_timezone_required");
  }
}
/** Offset-free provider timestamps need the explicitly confirmed provider time zone. */
export function fiscalProviderInstant(value: string, timeZone?: string) {
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    if (!Number.isFinite(Date.parse(value)))
      throw new Error("fiscal_payment_date_invalid");
    return new Date(value).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return fiscalCalendarDate(value, "UTC");
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!m || !timeZone)
    throw new Error("fiscal_payment_provider_timezone_required");
  const original = m.slice(1).map(Number);
  const utc = Date.UTC(
    original[0],
    original[1] - 1,
    original[2],
    original[3],
    original[4],
    original[5]
  );
  const parts = (date: number) => {
    try {
      const p = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(date));
      return ["year", "month", "day", "hour", "minute", "second"].map((k) =>
        Number(p.find((p) => p.type === k)!.value)
      );
    } catch {
      throw new Error("fiscal_payment_provider_timezone_required");
    }
  };
  const stamp = (p: number[]) =>
    Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]);
  let result = utc;
  for (let i = 0; i < 3; i++) result = utc - (stamp(parts(result)) - result);
  if (
    parts(result).some((n, i) => n !== original[i]) ||
    [-3600000, 3600000].some((d) =>
      parts(result + d).every((n, i) => n === original[i])
    )
  )
    throw new Error("fiscal_payment_provider_time_ambiguous");
  return new Date(result).toISOString();
}
