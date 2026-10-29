export const PLATFORM_FEEDBACK_STATUSES = [
  "new",
  "acknowledged",
  "planned",
  "in_progress",
  "resolved",
  "declined",
] as const;

export const PLATFORM_FEEDBACK_PRIORITIES = ["low", "normal", "high", "critical"] as const;

export type PlatformFeedbackStatus = (typeof PLATFORM_FEEDBACK_STATUSES)[number];
export type PlatformFeedbackPriority = (typeof PLATFORM_FEEDBACK_PRIORITIES)[number];

export type PlatformFeedbackNote = {
  id: string;
  operatorId: string;
  operatorEmail?: string;
  message: string;
  createdAt: Date;
};

// The treatment row holds the current state. These entries are read from the
// immutable platform audit log, so a later edit can never rewrite its trail.
export type PlatformFeedbackTreatmentAudit = {
  id: string;
  actorOperatorId?: string;
  actorOperatorEmail?: string;
  occurredAt: Date;
  previous: {
    status?: PlatformFeedbackStatus;
    priority?: PlatformFeedbackPriority;
    assignedOperatorId?: string | null;
  };
  current: {
    status?: PlatformFeedbackStatus;
    priority?: PlatformFeedbackPriority;
    assignedOperatorId?: string | null;
  };
  noteAdded: boolean;
};

export type PlatformFeedback = {
  id: string;
  merchantId: string;
  merchantName?: string;
  authorUserId: string;
  authorEmail?: string;
  category: string;
  message: string;
  createdAt: Date;
  treatment: {
    status: PlatformFeedbackStatus;
    priority: PlatformFeedbackPriority;
    assignedOperatorId?: string;
    firstReadAt?: Date;
    resolvedAt?: Date;
    updatedAt?: Date;
    assignedOperatorEmail?: string;
    latestNote?: PlatformFeedbackNote;
    notes?: PlatformFeedbackNote[];
    auditHistory?: PlatformFeedbackTreatmentAudit[];
  };
};

export function isPlatformFeedbackStatus(value: string): value is PlatformFeedbackStatus {
  return PLATFORM_FEEDBACK_STATUSES.includes(value as PlatformFeedbackStatus);
}

export function isPlatformFeedbackPriority(value: string): value is PlatformFeedbackPriority {
  return PLATFORM_FEEDBACK_PRIORITIES.includes(value as PlatformFeedbackPriority);
}
