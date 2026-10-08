import { mergeUrl } from "./url.js";

const sessions = new WeakMap<typeof fetch, Map<string, typeof fetch>>();
const tokens = new WeakMap<typeof fetch, Map<string, string>>();
export const SESSION_TOKEN_CHANGED = "aacp:session_token_changed";
export function getSessionAccessToken(baseUrl: string, fetchImpl: typeof fetch = globalThis.fetch) {
  return tokens.get(fetchImpl)?.get(baseUrl.replace(/\/+$/, "").replace(/\/v1$/, ""));
}

/** Keep the returned session available when the browser cannot send its cookie. */
export function createSessionFetch(baseUrl: string, fetchImpl: typeof fetch): typeof fetch {
  const base = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  let byBase = sessions.get(fetchImpl);
  if (!byBase) {
    byBase = new Map();
    sessions.set(fetchImpl, byBase);
  }
  const existing = byBase.get(base);
  if (existing) return existing;
  let accessToken: string | undefined;
  let byToken = tokens.get(fetchImpl);
  if (!byToken) { byToken = new Map(); tokens.set(fetchImpl, byToken); }
  function updateToken(token?: string) {
    accessToken = token;
    if (token) byToken!.set(base, token); else byToken!.delete(base);
    if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_TOKEN_CHANGED));
  }
  const sessionUrls = new Set(["/auth/register", "/auth/login", "/auth/oauth/callback", "/auth/refresh"].map(path => mergeUrl(baseUrl, path)));
  const logoutUrl = mergeUrl(baseUrl, "/auth/logout");
  const apiPrefix = `${baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/`;

  const sessionFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (accessToken && url.startsWith(apiPrefix) && (!sessionUrls.has(url) || url === mergeUrl(baseUrl, "/auth/refresh")) && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
    const response = await fetchImpl(input, { ...init, headers });
    const activation = url.startsWith(apiPrefix + "merchants/me/stores/") && url.endsWith("/activate");
    if (sessionUrls.has(url) || activation) {
      if (response.ok) {
        const auth = await response.clone().json() as { access_token?: unknown };
        if (typeof auth.access_token === "string" && auth.access_token) updateToken(auth.access_token);
      } else if (response.status === 401) {
        updateToken();
      }
    }
    if (url === logoutUrl && response.ok) updateToken();
    return response;
  };
  byBase.set(base, sessionFetch);
  return sessionFetch;
}
