import type {
  PlatformFeedback,
  PlatformFeedbackPriority,
  PlatformFeedbackStatus,
} from "../platform-feedback.js";

export const PLATFORM_FEEDBACK_REPOSITORY = Symbol("PLATFORM_FEEDBACK_REPOSITORY");

export type PlatformFeedbackPage = {
  items: PlatformFeedback[];
  nextCursor?: string;
};

export type PlatformFeedbackQuery = {
  cursor?: string;
  limit: number;
  status?: PlatformFeedbackStatus;
  category?: string;
};

export type ChangePlatformFeedbackTreatment = {
  feedbackId: string;
  actorOperatorId: string;
  status?: PlatformFeedbackStatus;
  priority?: PlatformFeedbackPriority;
  assignedOperatorId?: string | null;
  note?: string;
  correlationId: string;
  environment: string;
};

export type PlatformFeedbackReadAudit = {
  actorOperatorId: string;
  action: "feedback.queue.read" | "feedback.detail.read";
  targetType: "platform_feedback_queue" | "merchant_platform_feedback";
  targetId?: string;
  correlationId: string;
  environment: string;
  details?: Record<string, string | number>;
};

export interface PlatformFeedbackRepository {
  list(input: PlatformFeedbackQuery): Promise<PlatformFeedbackPage>;
  findById(id: string): Promise<PlatformFeedback | undefined>;
  recordRead(input: PlatformFeedbackReadAudit): Promise<void>;
  changeTreatment(input: ChangePlatformFeedbackTreatment): Promise<PlatformFeedback>;
}
