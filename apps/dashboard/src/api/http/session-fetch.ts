import { mergeUrl } from "./url.js";

const sessions = new WeakMap<typeof fetch, Map<string, typeof fetch>>();

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
    if (sessionUrls.has(url)) {
      if (response.ok) {
        const auth = await response.clone().json() as { access_token?: unknown };
        if (typeof auth.access_token === "string" && auth.access_token) accessToken = auth.access_token;
      } else if (response.status === 401) {
        accessToken = undefined;
      }
    }
    if (url === logoutUrl && response.ok) accessToken = undefined;
    return response;
  };
  byBase.set(base, sessionFetch);
  return sessionFetch;
}
