/**
 * Lightweight error reporter for the widget runtime.
 *
 * In production, this posts errors to the API telemetry endpoint.
 * Can be replaced with Sentry SDK when ready:
 *   import * as Sentry from "@sentry/react";
 *   Sentry.init({ dsn: '...', tracesSampleRate: 0.1 });
 *
 * For now, batches errors and sends to /embed/telemetry (fire-and-forget).
 */

let apiBase = "";
let merchantId = "";
const queue: ErrorEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

interface ErrorEntry {
  message: string;
  stack?: string;
  component?: string;
  timestamp: number;
}

export function initErrorReporter(opts: { apiBaseUrl: string; merchantId: string }): void {
  apiBase = opts.apiBaseUrl.replace(/\/$/, "");
  merchantId = opts.merchantId;

  // Catch unhandled promise rejections.
  if (typeof window !== "undefined") {
    window.addEventListener("unhandledrejection", (event) => {
      reportError(event.reason instanceof Error ? event.reason : new Error(String(event.reason)), "unhandledrejection");
    });
  }
}

export function reportError(error: Error, component?: string): void {
  if (!apiBase) {
    console.error("[aacp]", error);
    return;
  }

  queue.push({
    message: error.message,
    stack: error.stack?.slice(0, 500),
    component,
    timestamp: Date.now(),
  });

  // Batch flush every 3s.
  if (!flushTimer) {
    flushTimer = setTimeout(flush, 3000);
  }
}

function flush(): void {
  flushTimer = null;
  if (queue.length === 0) return;

  const batch = queue.splice(0, 10);
  const url = `${apiBase}/embed/telemetry`;

  // Fire-and-forget.
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merchant_id: merchantId, type: "errors", entries: batch }),
    keepalive: true,
  }).catch(() => {
    // Silently drop — never crash the widget for telemetry.
  });
}
