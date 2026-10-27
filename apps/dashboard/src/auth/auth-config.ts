export function requiresAuthCaptcha(siteKey: string | undefined, production: boolean): boolean {
  return production || Boolean(siteKey?.trim());
}

export function isAuthCaptchaReady(siteKey: string | undefined, token: string | null | undefined, production: boolean): boolean {
  return !requiresAuthCaptcha(siteKey, production) || Boolean(siteKey?.trim() && token?.trim());
}

export type SocialLoginProvider = "google" | "microsoft" | "facebook";
export type OAuthProvider = SocialLoginProvider | "github";

const PROVIDERS = {
  google: { label: "Google", url: "https://accounts.google.com/o/oauth2/v2/auth", scope: "openid email profile" },
  microsoft: { label: "Microsoft", url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", scope: "openid profile email" },
  facebook: { label: "Facebook", url: "https://www.facebook.com/v26.0/dialog/oauth", scope: "public_profile,email" },
  github: { label: "GitHub", url: "https://github.com/login/oauth/authorize", scope: "user:email" },
} as const;

export function buildOAuthAuthorizationUrl(provider: OAuthProvider, options: {
  clientId?: string; origin: string; state: string; redirectUri?: string; facebookVersion?: string; codeChallenge?: string;
}): string {
  const { label, url: endpoint, scope } = PROVIDERS[provider];
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
  const url = new URL(endpoint);
  if (provider === "facebook" && options.facebookVersion?.trim()) {
    if (!/^v\d+\.0$/.test(options.facebookVersion.trim())) throw unavailable();
    url.pathname = `/${options.facebookVersion.trim()}/dialog/oauth`;
  }
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect.href);
  url.searchParams.set("state", options.state);
  url.searchParams.set("scope", scope);
  if (provider !== "github") url.searchParams.set("response_type", "code");
  if (provider === "microsoft" && !options.codeChallenge) throw unavailable();
  if ((provider === "google" || provider === "microsoft") && options.codeChallenge) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(options.codeChallenge)) throw unavailable();
    url.searchParams.set("code_challenge", options.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (provider === "microsoft") {
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("prompt", "select_account");
  }
  if (provider === "google") {
    url.searchParams.set("prompt", "select_account");
  }
  return url.href;
}

/** Bind the callback to the provider selected in this browser, including legacy GitHub attempts. */
export function readOAuthCallback(search: string, savedState: string | null, savedProvider: string | null, codeVerifier?: string | null) {
  const params = new URLSearchParams(search);
  if (params.has("error")) throw new Error("A autorização foi cancelada. Inicie o login novamente.");
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || !savedProvider || !Object.hasOwn(PROVIDERS, savedProvider)) {
    throw new Error("O retorno do provedor está incompleto. Tente novamente.");
  }
  if (!savedState || state !== savedState || (params.has("provider") && params.get("provider") !== savedProvider)) {
    throw new Error("A sessão de login expirou. Tente novamente.");
  }
  if (savedProvider === "microsoft" && (!codeVerifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier))) {
    throw new Error("A sessão de login expirou. Tente novamente.");
  }
  const needsProof = savedProvider === "google" || savedProvider === "microsoft";
  return { code, state, provider: savedProvider as OAuthProvider, ...(needsProof && codeVerifier ? { code_verifier: codeVerifier } : {}) };
}

export async function generateOAuthProofKey() {
  const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const codeVerifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return { codeVerifier, codeChallenge: encode(new Uint8Array(digest)) };
}
