import { BadRequestException } from "@nestjs/common";

export const FIXED_SERVICE_TIME_ZONE = "America/Sao_Paulo";

/** New-write envelope only. Historical IANA validators/readers stay unchanged. */
export function defaultNewServiceTimeZone(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const input = raw as Record<string, unknown>;
  return input.timeZone === undefined ? { ...input, timeZone: FIXED_SERVICE_TIME_ZONE } : raw;
}

/** Call after the existing authorization/resource/version admission. */
export function assertNewServiceTimeZone(value: unknown): typeof FIXED_SERVICE_TIME_ZONE {
  if (value !== FIXED_SERVICE_TIME_ZONE) throw new BadRequestException("new_service_timezone_must_be_brasilia");
  return FIXED_SERVICE_TIME_ZONE;
}
