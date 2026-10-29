import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from "@nestjs/common";

const BAD_REQUEST_CODES = new Set([
  "platform_feedback_empty_treatment",
  "platform_feedback_id",
  "platform_feedback_invalid_assignee",
  "platform_feedback_invalid_limit",
  "platform_feedback_invalid_note",
  "platform_feedback_invalid_priority",
  "platform_feedback_invalid_status",
  "platform_feedback_note_too_long",
  "platform_feedback_assignee_not_found",
]);

const FORBIDDEN_CODES = new Set([
  "platform_feedback_assignee_not_permitted",
]);

export function throwPlatformFeedbackHttpError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  const code = error instanceof Error ? error.message : undefined;
  if (code && BAD_REQUEST_CODES.has(code)) throw new BadRequestException(code);
  if (code && FORBIDDEN_CODES.has(code)) throw new ForbiddenException(code);
  if (code === "platform_feedback_not_found") throw new NotFoundException(code);
  throw error;
}
