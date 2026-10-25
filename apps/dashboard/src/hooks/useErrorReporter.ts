import { useCallback } from "react";
import {
  getErrorReporter,
  reportError,
  swallowErrors,
  type ErrorContext,
  type ErrorReportPayload,
} from "../lib/observability/error-reporter.js";

/**
 * React hook that exposes a stable error reporter handle.
 *
 * Use `report` for caught errors that already have their own handler — this
 * adds telemetry without changing UX. Use `swallow` to convert a thrown
 * error into a structured report plus a fallback value (formerly a bare
 * `catch {}`).
 */
export function useErrorReporter() {
  const reporter = getErrorReporter();

  const report = useCallback(
    (source: string, error: unknown, context?: ErrorContext) => {
      const payload: ErrorReportPayload = { source, error, context };
      reporter.report(payload);
    },
    [reporter],
  );

  const swallow = useCallback(
    <T>(source: string, fn: () => T | Promise<T>, fallback?: T, context?: ErrorContext) =>
      reporter.swallow(source, fn, fallback, context),
    [reporter],
  );

  return { report, swallow, reportError };
}

export { reportError, swallowErrors };
export type { ErrorContext, ErrorReportPayload };
