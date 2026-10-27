import { BadRequestException, HttpException } from "@nestjs/common";

const BAD_REQUEST_CODES = new Set([
  "platform_ai_usage_invalid_from",
  "platform_ai_usage_invalid_limit",
  "platform_ai_usage_invalid_period",
  "platform_ai_usage_invalid_to",
]);

export function throwPlatformAiUsageHttpError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  const code = error instanceof Error ? error.message : undefined;
  if (code && BAD_REQUEST_CODES.has(code)) throw new BadRequestException(code);
  throw error;
}
