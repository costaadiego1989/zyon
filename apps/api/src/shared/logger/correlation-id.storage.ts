import { AsyncLocalStorage } from "node:async_hooks";

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * AsyncLocalStorage-backed accessor for the current request's correlation id.
 *
 * The middleware (and pino-http's `genReqId`) populates this slot so that any
 * downstream service — repositories, use-cases, error filters — can attach
 * the active correlation id to its log lines without threading it through
 * every function signature.
 */
export class CorrelationIdStorage {
  private static readonly storage = new AsyncLocalStorage<string>();

  static run<T>(correlationId: string, fn: () => T): T {
    return this.storage.run(correlationId, fn);
  }

  static get(): string | undefined {
    return this.storage.getStore();
  }

  static getOrThrow(): string {
    const value = this.storage.getStore();
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