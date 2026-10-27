import { Injectable } from "@nestjs/common";

export interface HttpClientOptions {
  timeout?: number;
  retries?: number;
  circuitBreakerThreshold?: number;
  fetchFn?: typeof fetch;
}

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  correlationId?: string;
  target?: string;
}

export class CircuitOpenError extends Error {
  constructor() {
    super("circuit_breaker_open");
    this.name = "CircuitOpenError";
  }
}

export class MaxRetriesExceededError extends Error {
  constructor(public readonly lastError: Error) {
    super(`max_retries_exceeded: ${lastError.message}`);
    this.name = "MaxRetriesExceededError";
  }
}

const HALF_OPEN_AFTER_MS = 30_000;

@Injectable()
export class HttpClientService {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  private readonly timeout: number;
  private readonly retries: number;
  private readonly threshold: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpClientOptions = {}) {
    this.timeout = options.timeout ?? 10_000;
    this.retries = options.retries ?? 3;
    this.threshold = options.circuitBreakerThreshold ?? 5;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async fetch(url: string, options: HttpRequestOptions = {}): Promise<Response> {
    this.checkCircuit();

    const headers: Record<string, string> = {
      ...options.headers,
      ...(options.correlationId ? { "x-correlation-id": options.correlationId } : {}),
    };

    let lastError: Error = new Error("no_attempts_made");

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await this.fetchFn(url, {
          method: options.method ?? "GET",
          headers,
          body: options.body,
          signal: controller.signal,
        });

        if (response.status >= 500) {
          throw new Error(`server_error_${response.status}`);
        }

        this.onSuccess();
        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isRetryable = this.isRetryable(lastError, undefined);

        if (!isRetryable || attempt === this.retries) {
          this.onFailure();
          break;
        }

        await this.backoff(attempt);
      } finally {
        clearTimeout(timer);
      }
    }

    throw new MaxRetriesExceededError(lastError);
  }

  private checkCircuit(): void {
    if (this.openedAt === null) return;
    const elapsed = Date.now() - this.openedAt;
    if (elapsed >= HALF_OPEN_AFTER_MS) {
      this.openedAt = null;
      this.consecutiveFailures = 0;
    } else {
      throw new CircuitOpenError();
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  private onFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.threshold) {
      this.openedAt = Date.now();
    }
  }

  private isRetryable(err: Error, _statusCode: number | undefined): boolean {
    const msg = err.message;
    if (msg.startsWith("server_error_")) return true;
    if (msg.includes("fetch") || msg.includes("network") || msg.includes("abort")) return true;
    return false;
  }

  private backoff(attempt: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.min(100 * 2 ** attempt, 2000)));
  }

  /** Returns a function compatible with `typeof fetch` for use with adapters that inject their fetch impl. */
  toFetch(): typeof fetch {
    return (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const headers: Record<string, string> = {};
      if (init?.headers) {
        const h = init.headers;
        if (h instanceof Headers) {
          h.forEach((v, k) => { headers[k] = v; });
        } else if (Array.isArray(h)) {
          for (const [k, v] of h) headers[k] = v;
        } else {
          Object.assign(headers, h);
        }
      }
      return this.fetch(url, {
        method: init?.method,
        headers,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
    };
  }
}
