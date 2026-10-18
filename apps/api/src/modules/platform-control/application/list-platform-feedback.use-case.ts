import { Inject, Injectable } from "@nestjs/common";
import { isPlatformFeedbackStatus } from "../domain/platform-feedback.js";
import {
  PLATFORM_FEEDBACK_REPOSITORY,
  type PlatformFeedbackReadAudit,
  type PlatformFeedbackRepository,
} from "../domain/ports/platform-feedback-repository.port.js";

@Injectable()
export class ListPlatformFeedbackUseCase {
  constructor(
    @Inject(PLATFORM_FEEDBACK_REPOSITORY) private readonly feedback: PlatformFeedbackRepository,
  ) {}

  async execute(
    input: { cursor?: string; limit?: string; status?: string; category?: string },
    audit: Omit<PlatformFeedbackReadAudit, "action" | "targetType" | "details">,
  ) {
    const query = {
      cursor: optionalText(input.cursor),
      limit: pageSize(input.limit),
      status: statusFilter(input.status),
      category: optionalText(input.category),
    };
    const page = await this.feedback.list(query);
    await this.feedback.recordRead({
      ...audit,
      action: "feedback.queue.read",
      targetType: "platform_feedback_queue",
      details: {
        itemCount: page.items.length,
        limit: query.limit,
        ...(query.status ? { status: query.status } : {}),
        ...(query.category ? { category: query.category } : {}),
      },
    });
    return page;
  }

  async findById(
    id: string,
    audit: Omit<PlatformFeedbackReadAudit, "action" | "targetType" | "targetId">,
  ) {
    const feedbackId = requiredText(id, "platform_feedback_id");
    const feedback = await this.feedback.findById(feedbackId);
    if (!feedback) return undefined;
    await this.feedback.recordRead({
      ...audit,
      action: "feedback.detail.read",
      targetType: "merchant_platform_feedback",
      targetId: feedbackId,
    });
    return feedback;
  }
}

function pageSize(value: string | undefined): number {
  if (value === undefined) return 50;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) throw new Error("platform_feedback_invalid_limit");
  return parsed;
}

function statusFilter(value: string | undefined) {
  const status = optionalText(value);
  if (!status) return undefined;
  if (!isPlatformFeedbackStatus(status)) throw new Error("platform_feedback_invalid_status");
  return status;
}

function optionalText(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function requiredText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}
