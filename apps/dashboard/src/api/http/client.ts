/**
 * Core HTTP client for dashboard API.
 * Handles fetch, silent token refresh on 401, idempotency injection,
 * JSON deserialization, and session-expired event emission.
 */
import { DashboardHttpError, DashboardJsonParseError } from "./error.js";
import { mergeUrl } from "./url.js";
import { createIdempotencyKey } from "./idempotency.js";

export const SESSION_EXPIRED_EVENT = "aacp:session_expired";

function emitSessionExpired() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function silentRefresh(apiBaseUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetchImpl(mergeUrl(apiBaseUrl, "/auth/refresh"), {
        method: "POST",
        credentials: "include"
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function dashboardFetch(
  apiBaseUrl: string,
  path: string,
  init: Omit<RequestInit, "credentials"> & { jsonBody?: unknown } = {},
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<Response> {
  const { jsonBody, body, headers: headersInit, ...rest } = init;
  const headers = new Headers(headersInit ?? undefined);

  let finalBody = body ?? null;
  if (jsonBody !== undefined) {
    headers.set("Content-Type", "application/json");
    finalBody = JSON.stringify(jsonBody);
  }
  const method = (rest.method ?? "GET").toUpperCase();
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    !path.includes("/auth/") &&
    !headers.has("Idempotency-Key")
  ) {
    headers.set("Idempotency-Key", createIdempotencyKey());
  }

  const doFetch = () =>
    fetchImpl(mergeUrl(apiBaseUrl, path), {
      ...rest,
      headers,
      body: finalBody,
      credentials: "include"
    });

  const res = await doFetch();

  if (res.status === 401 && !path.includes("/auth/")) {
    const refreshed = await silentRefresh(apiBaseUrl, fetchImpl);
    if (refreshed) {
      const retryRes = await doFetch();
      if (retryRes.status === 401) {
        emitSessionExpired();
      }
      return retryRes;
    }
    emitSessionExpired();
  }

  return res;
}

export async function dashboardJson<T>(
  apiBaseUrl: string,
  path: string,
  init: Omit<RequestInit, "credentials"> & { jsonBody?: unknown } = {},
  fetchImpl?: typeof fetch
): Promise<T> {
  const res = await dashboardFetch(apiBaseUrl, path, init, fetchImpl);
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401 && !path.includes("/embed/")) {
      emitSessionExpired();
    }
    throw new DashboardHttpError(res.status, text);
  }
  if (text === "") return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new DashboardJsonParseError(text);
  }
}
