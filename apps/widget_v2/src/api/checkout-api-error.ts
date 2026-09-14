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
    return new CheckoutApiError(
      operation,
      response.status,
      typeof body.code === "string" ? body.code : undefined,
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
