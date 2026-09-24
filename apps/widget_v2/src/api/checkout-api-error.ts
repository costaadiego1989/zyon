export class CheckoutApiError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(`${operation}_failed: ${status}${code ? ` ${code}` : ""}`);
    this.name = "CheckoutApiError";
  }

  static async fromResponse(operation: string, response: Response): Promise<CheckoutApiError> {
    const payload = await response.json().catch((): unknown => undefined);
    const body = isRecord(payload) ? payload : {};
    // Nest's default HTTP exception payload uses `message` for a stable
    // machine-readable code. Keep supporting the explicit `code` envelope,
    // but retain that default so callers can recover with useful guidance.
    const code = typeof body.code === "string"
      ? body.code
      : typeof body.message === "string"
        ? body.message
        : undefined;
    return new CheckoutApiError(
      operation,
      response.status,
      code,
      positiveInteger(body.retry_after_seconds) ?? positiveInteger(body.retryAfterSeconds) ?? retryAfterHeader(response),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : undefined;
}

function retryAfterHeader(response: Response): number | undefined {
  const value = Number(response.headers.get("Retry-After"));
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : undefined;
}
