export function requiresAuthCaptcha(siteKey: string | undefined, production: boolean): boolean {
  return production || Boolean(siteKey?.trim());
}

export function isAuthCaptchaReady(siteKey: string | undefined, token: string | null | undefined, production: boolean): boolean {
  return !requiresAuthCaptcha(siteKey, production) || Boolean(siteKey?.trim() && token?.trim());
}

export function buildOAuthAuthorizationUrl(provider: "google" | "github", options: {
  clientId?: string; origin: string; state: string; redirectUri?: string;
}): string {
  const label = provider === "google" ? "Google" : "GitHub";
  const unavailable = () => new Error(`O login com ${label} está indisponível por configuração. Tente novamente mais tarde.`);
  const clientId = options.clientId?.trim();
  if (!clientId || ["undefined", "null"].includes(clientId) || !options.state?.trim()) throw unavailable();
  let redirect: URL, origin: URL;
  try {
    origin = new URL(options.origin);
    redirect = new URL(options.redirectUri?.trim() || "/auth/oauth/callback", origin);
  } catch { throw unavailable(); }
  const localHttp = origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.protocol !== "https:" && !localHttp || redirect.origin !== origin.origin ||
      redirect.pathname !== "/auth/oauth/callback" || redirect.username || redirect.password || redirect.search || redirect.hash) throw unavailable();
  const url = new URL(provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect.href);
  url.searchParams.set("state", options.state);
  url.searchParams.set("scope", provider === "google" ? "openid email profile" : "user:email");
  if (provider === "google") {
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  return url.href;
}

