/**
 * Error reporter — interface + console implementation.
 *
 * Centralizes error telemetry for the dashboard. Pages and hooks call
 * `reportError` instead of swallowing caught errors silently. The default
 * implementation logs structured info to the browser console; production
 * deployments can swap in a Sentry/Datadog adapter without touching call
 * sites.
 */

export type ErrorContext = Record<string, unknown>;

export interface ErrorReportPayload {
  /** Stable identifier — typically the originating module or feature. */
  source: string;
  /** Original error object (Error, DashboardHttpError, fetch failure, etc). */
  error: unknown;
  /** Optional structured context (merchantId, action, ids, flags). */
  context?: ErrorContext;
  /** Optional severity hint — defaults to "error". */
  severity?: "debug" | "info" | "warning" | "error" | "fatal";
  /** Optional caller-provided tags for grouping/searching. */
  tags?: Record<string, string>;
}

export interface ErrorReporter {
  report(payload: ErrorReportPayload): void;
  /**
   * Run `fn` and report any thrown error via this reporter.
   * Returns the function's result or `fallback` when it throws.
   */
  swallow<T>(source: string, fn: () => T | Promise<T>, fallback?: T, context?: ErrorContext): Promise<T | undefined>;
}

function summarize(payload: ErrorReportPayload): Record<string, unknown> {
  const err = payload.error;
  let name: string | undefined;
  let message: string | undefined;
  let stack: string | undefined;
  let status: number | undefined;
  let responseBody: unknown;

  if (err instanceof Error) {
    name = err.name;
    message = err.message;
    stack = err.stack;
  } else if (typeof err === "string") {
    message = err;
  } else {
    message = String(err);
  }

  const dashboardErr = err as { status?: number; responseBody?: unknown };
  if (typeof dashboardErr?.status === "number") status = dashboardErr.status;
  if (dashboardErr?.responseBody !== undefined) responseBody = dashboardErr.responseBody;

  return {
    source: payload.source,
    severity: payload.severity ?? "error",
    tags: payload.tags,
    context: payload.context,
    error: {
      name,
      message,
      status,
      responseBody,
      stack,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Console-backed reporter. Suitable for dev, tests, and prod fallback.
 * Safe to call from anywhere — never throws.
 */
export const consoleErrorReporter: ErrorReporter = {
  report(payload) {
    try {
      const summary = summarize(payload);
      const level = payload.severity ?? "error";
      const tag = `[error-reporter] ${payload.source}`;
      const args: unknown[] = [tag, summary];
      if (level === "debug" || level === "info") {
        // eslint-disable-next-line no-console
        console.info(...args);
      } else if (level === "warning") {
        // eslint-disable-next-line no-console
        console.warn(...args);
      } else {
        // eslint-disable-next-line no-console
        console.error(...args);
      }
    } catch {
      // Reporter must never throw — last-resort swallow.
    }
  },

  async swallow(source, fn, fallback, context) {
    try {
      return await fn();
    } catch (err) {
      consoleErrorReporter.report({ source, error: err, context });
      return fallback;
    }
  },
};

/** Process-wide reporter handle. Replaced by tests via `setErrorReporter`. */
let currentReporter: ErrorReporter = consoleErrorReporter;

export function getErrorReporter(): ErrorReporter {
  return currentReporter;
}

export function setErrorReporter(reporter: ErrorReporter): void {
  currentReporter = reporter;
}

export function reportError(payload: ErrorReportPayload): void {
  currentReporter.report(payload);
}

export async function swallowErrors<T>(
  source: string,
  fn: () => T | Promise<T>,
  fallback?: T,
  context?: ErrorContext,
): Promise<T | undefined> {
  return currentReporter.swallow(source, fn, fallback, context);
}
