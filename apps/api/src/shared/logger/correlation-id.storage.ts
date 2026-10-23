import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * AsyncLocalStorage-backed accessor for the current request's correlation id.
 *
 * Both middleware entrypoints preserve the public correlation contract here.
 * Logs use the independent generated requestId, not caller-controlled content.
 */
export class CorrelationIdStorage {
  private static readonly storage = new AsyncLocalStorage<{ correlationId: string; requestId: string }>();

  static run<T>(correlationId: string, fn: () => T, requestId: string = randomUUID()): T {
    return this.storage.run({ correlationId, requestId }, fn);
  }

  static get(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }

  static getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  static getOrThrow(): string {
    const value = this.get();
    if (!value) {
      throw new Error("correlation_id_missing_from_async_storage");
    }
    return value;
  }

  static isValid(candidate: string): boolean {
    return CORRELATION_ID_PATTERN.test(candidate);
  }

  static readonly HEADER = "x-correlation-id";
  static readonly PATTERN = CORRELATION_ID_PATTERN;
}
