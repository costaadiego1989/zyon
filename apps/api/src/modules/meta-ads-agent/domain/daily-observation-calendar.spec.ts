import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closedObservationDays, dailyObservationKey, latestClosedObservationDay } from './daily-observation-calendar.js';

test('ADAS-41 closed day becomes due at local midnight in the account timezone', () => {
  const day = latestClosedObservationDay(new Date('2026-11-16T03:00:00Z'), 'America/Sao_Paulo');
  assert.equal(day.localDay, '2026-11-15'); assert.equal(day.since, '2026-11-15'); assert.equal(day.until, '2026-11-15');
  assert.equal(day.startsAt, '2026-11-15T03:00:00.000Z'); assert.equal(day.endsAt, '2026-11-16T03:00:00.000Z');
  assert.equal(day.eligibleAt, day.endsAt); assert.equal(day.analysisSince, '2026-11-02'); assert.equal(day.analysisUntil, day.localDay);
  assert.equal(latestClosedObservationDay(new Date('2026-11-16T02:59:59.999Z'), 'America/Sao_Paulo').localDay, '2026-11-14');
});
test('ADAS-41 same instant has distinct closed dates in independent IANA zones', () => {
  const now = new Date('2026-11-16T03:00:00Z');
  assert.equal(latestClosedObservationDay(now, 'America/Los_Angeles').localDay, '2026-11-14');
  assert.equal(latestClosedObservationDay(now, 'America/Sao_Paulo').localDay, '2026-11-15');
});
test('ADAS-41 DST spring day has 23 actual hours and autumn day has 25', () => {
  const spring = latestClosedObservationDay(new Date('2026-03-09T04:00:00Z'), 'America/New_York');
  assert.equal(spring.localDay, '2026-03-08'); assert.equal(spring.startsAt, '2026-03-08T05:00:00.000Z'); assert.equal(Date.parse(spring.endsAt) - Date.parse(spring.startsAt), 23 * 3600000);
  const autumn = latestClosedObservationDay(new Date('2026-11-02T05:00:00Z'), 'America/New_York');
  assert.equal(autumn.localDay, '2026-11-01'); assert.equal(autumn.endsAt, '2026-11-02T05:00:00.000Z'); assert.equal(Date.parse(autumn.endsAt) - Date.parse(autumn.startsAt), 25 * 3600000);
});
test('ADAS-41 non-hour offsets and month or year changes preserve calendar days', () => {
  assert.equal(latestClosedObservationDay(new Date('2026-11-16T18:15:00Z'), 'Asia/Kathmandu').endsAt, '2026-11-16T18:15:00.000Z');
  assert.equal(latestClosedObservationDay(new Date('2026-11-01T03:00:00Z'), 'America/Sao_Paulo').localDay, '2026-10-31');
  assert.equal(latestClosedObservationDay(new Date('2027-01-01T03:00:00Z'), 'America/Sao_Paulo').localDay, '2026-12-31');
});
test('ADAS-41 invalid timezone or instant fails explicitly without UTC fallback', () => {
  for (const zone of ['', 'unknown', 'America/Invalid']) assert.throws(() => latestClosedObservationDay(new Date('2026-11-16T03:00:00Z'), zone), { code: 'meta_timezone_unavailable' });
  assert.throws(() => latestClosedObservationDay(new Date('invalid'), 'UTC'), { code: 'meta_calendar_invalid' });
});
test('ADAS-42 catch-up paginates missed days without admitting an open day or repeating a completed one', () => {
  const now = new Date('2026-11-16T03:00:00Z');
  const first = closedObservationDays(now, 'America/Sao_Paulo', '2026-11-12', 2);
  assert.deepEqual(first.map(day => day.localDay), ['2026-11-13', '2026-11-14']);
  assert.deepEqual(closedObservationDays(now, 'America/Sao_Paulo', first.at(-1)!.localDay, 2).map(day => day.localDay), ['2026-11-15']);
  assert.deepEqual(closedObservationDays(now, 'America/Sao_Paulo', '2026-11-15'), []);
  assert.equal(closedObservationDays(now, 'America/Sao_Paulo')[0].localDay, '2026-11-15');
});
test('ADAS-42 logical daily identity binds merchant account day and timezone independently', () => {
  const day = latestClosedObservationDay(new Date('2026-11-16T03:00:00Z'), 'America/Sao_Paulo');
  const key = dailyObservationKey('store-a', '100', day);
  assert.equal(key, dailyObservationKey('store-a', '100', { ...day }));
  assert.notEqual(key, dailyObservationKey('store-b', '100', day)); assert.notEqual(key, dailyObservationKey('store-a', '101', day));
  assert.notEqual(key, dailyObservationKey('store-a', '100', { ...day, timezone: 'UTC' }));
});
test('ADAS-41 a skipped civil day is not fabricated as a zero-duration reporting period', () => {
  const day = latestClosedObservationDay(new Date('2011-12-30T10:00:00Z'), 'Pacific/Apia');
  assert.equal(day.localDay, '2011-12-29'); assert.equal(day.endsAt, '2011-12-30T10:00:00.000Z');
});
