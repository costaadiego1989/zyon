export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 200;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Extracts an HTTP status embedded in adapter error messages of the form
 * `shopify_<op>_failed_<status>`. Returns undefined for network/parse errors.
 */
function statusFromError(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const match = error.message.match(/_(\d{3})$/);
  if (!match) return undefined;
  return Number(match[1]);
}

/** Retryable: network errors (no status), HTTP 429, and 5xx. Permanent: 4xx. */
export function isRetryableCommerceError(error: unknown): boolean {
  const status = statusFromError(error);
  if (status === undefined) return true;
  if (status === 429) return true;
  return status >= 500 && status <= 599;
}

export async function retryWithBackoff<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableCommerceError(error)) {
        throw error;
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
