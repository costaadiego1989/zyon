import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";

const BAD_REQUEST_CODES = new Set([
  "platform_operator_id",
  "platform_operator_invalid_action",
  "platform_operator_invalid_role",
  "platform_operator_target_id",
  "platform_operator_unexpected_role",
]);

const CONFLICT_CODES = new Set([
  "platform_operator_last_admin_protected",
  "platform_operator_no_change",
]);

export function throwPlatformOperatorDirectoryHttpError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  const code = error instanceof Error ? error.message : undefined;
  if (code && BAD_REQUEST_CODES.has(code)) throw new BadRequestException(code);
  if (code && CONFLICT_CODES.has(code)) throw new ConflictException(code);
  if (code === "platform_operator_actor_no_longer_admin" || code === "platform_operator_self_management_forbidden") {
    throw new ForbiddenException(code);
  }
  if (code === "platform_operator_not_found") throw new NotFoundException(code);
  throw error;
}
