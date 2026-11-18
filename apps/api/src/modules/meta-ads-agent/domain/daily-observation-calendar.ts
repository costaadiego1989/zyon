import { MetaAdsError } from './types.js';
import { requireIdentifier, stableDigest } from './offer.js';

export interface ClosedObservationDay {
  localDay: string; timezone: string; since: string; until: string;
  startsAt: string; endsAt: string; eligibleAt: string; analysisSince: string; analysisUntil: string;
}
function formatter(timezone: string): Intl.DateTimeFormat {
  try {
    if (typeof timezone !== 'string' || !timezone || timezone !== timezone.trim()) throw new Error();
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch { throw new MetaAdsError('meta_timezone_unavailable', 409); }
}
function civil(format: Intl.DateTimeFormat, instant: number): string {
  const parts = format.formatToParts(new Date(instant));
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}
function validDate(day: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) throw new MetaAdsError('meta_calendar_invalid');
}
export function shiftObservationDate(day: string, days: number): string {
  validDate(day); if (!Number.isSafeInteger(days)) throw new MetaAdsError('meta_calendar_invalid');
  return new Date(Date.parse(day) + days * 86400000).toISOString().slice(0, 10);
}
/** Find the first actual instant of a civil day. DST may skip midnight or an entire day. */
function boundary(day: string, format: Intl.DateTimeFormat): number {
  let low = Date.parse(day) - 36 * 3600000, high = Date.parse(day) + 36 * 3600000;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (civil(format, middle) < day) low = middle + 1; else high = middle; }
  return low;
}
export function observationPeriod(localDay: string, timezone: string): ClosedObservationDay {
  validDate(localDay); const format = formatter(timezone), start = boundary(localDay, format), end = boundary(shiftObservationDate(localDay, 1), format);
  if (civil(format, start) !== localDay || start >= end) throw new MetaAdsError('meta_calendar_day_absent');
  return { localDay, timezone, since: localDay, until: localDay, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), eligibleAt: new Date(end).toISOString(), analysisSince: shiftObservationDate(localDay, -13), analysisUntil: localDay };
}
export function latestClosedObservationDay(now: Date, timezone: string): ClosedObservationDay {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new MetaAdsError('meta_calendar_invalid');
  const format = formatter(timezone), today = civil(format, now.getTime());
  return observationPeriod(civil(format, boundary(today, format) - 1), timezone);
}
export function closedObservationDays(now: Date, timezone: string, after?: string, limit = 31): ClosedObservationDay[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new MetaAdsError('meta_calendar_invalid');
  const latest = latestClosedObservationDay(now, timezone); if (after === undefined) return [latest]; validDate(after);
  const days: ClosedObservationDay[] = [];
  for (let day = shiftObservationDate(after, 1); day <= latest.localDay && days.length < limit; day = shiftObservationDate(day, 1)) {
    try { days.push(observationPeriod(day, timezone)); } catch (error) { if (!(error instanceof MetaAdsError) || error.code !== 'meta_calendar_day_absent') throw error; }
  }
  return days;
}
export function dailyObservationKey(merchantId: string, accountId: string, day: Pick<ClosedObservationDay, 'localDay' | 'timezone'>): string {
  requireIdentifier(merchantId); requireIdentifier(accountId); validDate(day.localDay); formatter(day.timezone);
  return `daily-${stableDigest({ merchantId, accountId, localDay: day.localDay, timezone: day.timezone })}`;
}
