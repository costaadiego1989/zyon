import { chatReceipt, type ChatReceipt } from "./chat-protocol";
import { checkoutPriceReview, type CheckoutPriceReview } from "./checkout-price-review";

export interface CheckoutApiErrorDetails { sku?: string; availableQuantity?: number; fields?: string[] }

export class CheckoutApiError extends Error {
  readonly chatRequest?: ChatReceipt;
  readonly details?: CheckoutApiErrorDetails;
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterSeconds?: number,
    chatRequestOrDetails?: ChatReceipt | CheckoutApiErrorDetails,
    readonly checkoutReview?: CheckoutPriceReview,
    details?: CheckoutApiErrorDetails,
  ) {
    super(`${operation}_failed: ${status}${code ? ` ${code}` : ""}`);
    this.name = "CheckoutApiError";
    this.chatRequest = chatRequestOrDetails && "message_id" in chatRequestOrDetails
      ? chatRequestOrDetails as ChatReceipt : undefined;
    this.details = details ?? (this.chatRequest ? undefined : chatRequestOrDetails as CheckoutApiErrorDetails | undefined);
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
      chatReceipt(body.chat_request),
      response.status === 409 && body.code === "checkout_review_required" ? checkoutPriceReview(body.review) : undefined,
      { ...(Array.isArray(body.fields) ? { fields: body.fields.filter((field): field is string => typeof field === "string" && /^(name|taxId|email|phone|address\.(street|number|complement|neighborhood|city|state|postalCode|cityCode|countryCode))$/.test(field)) } : {}),
        ...(typeof body.sku === "string" ? { sku: body.sku } : {}),
        ...(typeof body.availableQuantity === "number" && Number.isSafeInteger(body.availableQuantity) && body.availableQuantity >= 0
          ? { availableQuantity: body.availableQuantity } : {}) },
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
