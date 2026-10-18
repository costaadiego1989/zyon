import { BadRequestException, HttpException } from "@nestjs/common";

const BAD_REQUEST_CODES = new Set([
  "platform_audit_invalid_action",
  "platform_audit_invalid_actor_operator_id",
  "platform_audit_invalid_cursor",
  "platform_audit_invalid_from",
  "platform_audit_invalid_limit",
  "platform_audit_invalid_period",
  "platform_audit_invalid_to",
]);

export function throwPlatformAuditHttpError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  const code = error instanceof Error ? error.message : undefined;
  if (code && BAD_REQUEST_CODES.has(code)) throw new BadRequestException(code);
  throw error;
}
