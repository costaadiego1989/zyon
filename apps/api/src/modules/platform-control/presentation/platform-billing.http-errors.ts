import { BadRequestException, HttpException } from "@nestjs/common";

const BAD_REQUEST_CODES = new Set([
  "platform_billing_invalid_cursor",
  "platform_billing_invalid_limit",
  "platform_billing_invalid_provider",
  "platform_billing_invalid_status",
  "platform_billing_receivables_invalid_cursor",
  "platform_billing_receivables_invalid_limit",
  "platform_billing_receivables_invalid_status",
]);

export function throwPlatformBillingHttpError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  const code = error instanceof Error ? error.message : undefined;
  if (code && BAD_REQUEST_CODES.has(code)) throw new BadRequestException(code);
  throw error;
}
