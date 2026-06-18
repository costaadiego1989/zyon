import { SetMetadata } from "@nestjs/common";

export const IDEMPOTENCY_OPTIONS = "aacp:idempotency-options";

export interface IdempotencyOptions {
  ttlSeconds?: number;
  doNotPersistBody?: boolean;
  redactResponseFields?: string[];
}

export function Idempotent(
  options: IdempotencyOptions = {},
): MethodDecorator {
  return SetMetadata(IDEMPOTENCY_OPTIONS, options);
}
