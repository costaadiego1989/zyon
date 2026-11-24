/** T78 keeps the existing server duration field and preserves historical slots. */
export function withServiceDuration(metadata: Record<string, unknown>, durationMinutes: number): Record<string, unknown> {
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) throw new Error("invalid_service_duration");
  const raw = metadata.serviceSchedule;
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray((raw as Record<string, unknown>).slots))) throw new Error("historical_service_schedule_needs_review");
  const schedule = raw === undefined ? { timeZone: "America/Sao_Paulo", slots: [] } : raw as Record<string, unknown>;
  return { ...metadata, serviceSchedule: { ...schedule, durationMinutes } };
}

/** Keep invalid user input in draft metadata so the existing form validator blocks Save. */
export function withServiceDurationDraft(metadata: Record<string, unknown>, input: string): Record<string, unknown> {
  const duration = input.trim() ? Number(input) : NaN;
  if (Number.isSafeInteger(duration) && duration >= 5 && duration <= 480) return withServiceDuration(metadata, duration);
  const raw = metadata.serviceSchedule;
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray((raw as Record<string, unknown>).slots))) throw new Error("historical_service_schedule_needs_review");
  const schedule = raw === undefined ? { timeZone: "America/Sao_Paulo", slots: [] } : raw as Record<string, unknown>;
  return { ...metadata, serviceSchedule: { ...schedule, durationMinutes: duration } };
}
