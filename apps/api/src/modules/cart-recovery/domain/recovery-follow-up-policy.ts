const HOUR_MS = 60 * 60 * 1000;

/** Offsets are relative to acceptance of the first message, never to scan time. */
export function recoveryFollowUpSchedule(firstSentAt: Date) {
  return [
    { step: 1, dueAt: new Date(firstSentAt.getTime() + 24 * HOUR_MS), expiresAt: new Date(firstSentAt.getTime() + 72 * HOUR_MS) },
    { step: 2, dueAt: new Date(firstSentAt.getTime() + 72 * HOUR_MS), expiresAt: new Date(firstSentAt.getTime() + 96 * HOUR_MS) },
  ];
}
