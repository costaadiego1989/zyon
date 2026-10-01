import { mergeUrl } from "./url.js";

/** Keep the returned session available when the browser cannot send its cookie. */
export function createSessionFetch(baseUrl: string, fetchImpl: typeof fetch): typeof fetch {
  let accessToken: string | undefined;
  const sessionUrls = new Set(["/auth/register", "/auth/login", "/auth/oauth/callback", "/auth/refresh"].map(path => mergeUrl(baseUrl, path)));
  const logoutUrl = mergeUrl(baseUrl, "/auth/logout");
  const apiPrefix = `${baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/`;

  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (accessToken && url.startsWith(apiPrefix) && !sessionUrls.has(url) && !headers.has("Authorization")) {
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
}
