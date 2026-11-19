/** Current routes do not return audits. Keep private capture/cleanup metadata
 * out of every response now; future41 MUST use this before exposing audits. */
export function publicAppointmentView<T>(value: T): T {
  if (value === null || typeof value !== "object" || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(publicAppointmentView) as T;
  const result: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value)) {
    if (name === "privateLease" || name === "privateLeaseCleanup" || name === "privatePaymentContinuation") continue;
    result[name] = publicAppointmentView(item);
  }
  return result as T;
}
