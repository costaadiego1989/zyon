import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import type { OAuthExchangeOptions, OAuthProvider, OAuthProviderPort, OAuthUserProfile } from "../domain/ports/oauth-provider.port.js";

@Injectable()
export class OAuthProviderAdapter implements OAuthProviderPort {
  private readonly logger = new Logger("OAuthProviderAdapter");
  private readonly discoveryCache = new Map<string, { expiresAt: number; tokenEndpoint: string; userInfoEndpoint: string }>();

  async exchangeCodeForProfile(
    provider: OAuthProvider,
    code: string,
    options: OAuthExchangeOptions = {},
  ): Promise<OAuthUserProfile> {
    switch (provider) {
      case "github": return this.exchangeGithub(code);
      case "google": return this.exchangeGoogle(code, options);
      case "microsoft": return this.exchangeMicrosoft(code, options);
      case "facebook": return this.exchangeFacebook(code);
      default: throw new UnauthorizedException("unsupported_oauth_provider");
    }
  }

  private async exchangeGithub(code: string): Promise<OAuthUserProfile> {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const redirectUri = process.env.OAUTH_REDIRECT_URI;

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException("GitHub OAuth not configured");
    }

    // Exchange code for access token
    const tokenRes = await this.request("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenRes.ok || tokenBody.error || !tokenBody.access_token) {
      this.tokenError("GitHub", tokenRes.status, tokenBody.error);
    }

    // Fetch user profile
    const userRes = await this.request("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenBody.access_token}`,
        Accept: "application/json",
      },
    });

    if (!userRes.ok) {
      throw new InternalServerErrorException("GitHub user fetch failed");
    }

    const user = (await userRes.json()) as {
      id: number;
      email?: string | null;
      name?: string | null;
      avatar_url?: string;
      login: string;
    };

    // Account linking requires an explicitly verified provider email.
    let email: string | null = null;
    {
      const emailsRes = await this.request("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${tokenBody.access_token}`,
          Accept: "application/json",
        },
      });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        const primary = emails.find((e) => e.primary && e.verified);
        email = primary?.email ?? emails.find((e) => e.verified)?.email ?? null;
      }
    }

    if (!email) {
      throw new UnauthorizedException({ code: "oauth_email_not_verified", message: "Confirme seu e-mail no GitHub antes de entrar." });
    }

    return {
      email,
      name: user.name || user.login,
      avatarUrl: user.avatar_url,
      providerId: String(user.id),
      emailVerified: true,
    };
  }

  private async exchangeGoogle(code: string, options: OAuthExchangeOptions): Promise<OAuthUserProfile> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.OAUTH_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) this.configurationError();
    const endpoints = await this.oidcEndpoints("google");

    // Exchange code for tokens
    const tokenRes = await this.request(endpoints.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri || "",
        grant_type: "authorization_code",
        ...(options.codeVerifier ? { code_verifier: options.codeVerifier } : {}),
      }),
    });

    const tokenBody = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
    };

    if (!tokenRes.ok || tokenBody.error || !tokenBody.access_token) {
      this.tokenError("Google", tokenRes.status, tokenBody.error);
    }

    // Fetch user info
    const userRes = await this.request(endpoints.userInfoEndpoint, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });

    if (!userRes.ok) {
      throw new InternalServerErrorException("Google user info fetch failed");
    }

    const user = (await userRes.json()) as {
      sub?: string;
      email: string;
      email_verified?: boolean;
      hd?: string;
      name?: string;
      picture?: string;
    };

    if (!user.sub || !user.email || user.email_verified !== true) {
      throw new UnauthorizedException({ code: "oauth_email_not_verified", message: "Confirme seu e-mail no Google antes de entrar." });
    }

    return {
      email: user.email,
      name: user.name || user.email.split("@")[0]!,
      avatarUrl: user.picture,
      providerId: user.sub,
      // A verified external email on a Google account is not an ownership guarantee.
      emailVerified: user.email.toLowerCase().endsWith("@gmail.com") || Boolean(user.hd),
    };
  }

  private async exchangeMicrosoft(code: string, options: OAuthExchangeOptions): Promise<OAuthUserProfile> {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const redirectUri = process.env.OAUTH_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) this.configurationError();
    if (!options.codeVerifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(options.codeVerifier)) {
      throw new UnauthorizedException({ code: "oauth_proof_key_required", message: "A sessão de login expirou. Inicie uma nova tentativa." });
    }
    const endpoints = await this.oidcEndpoints("microsoft");

    const tokenRes = await this.request(endpoints.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code,
        redirect_uri: redirectUri, grant_type: "authorization_code", scope: "openid profile email", code_verifier: options.codeVerifier }),
    });
    const token = await tokenRes.json() as { access_token?: string; error?: string };
    if (!tokenRes.ok || token.error || !token.access_token) this.tokenError("Microsoft", tokenRes.status, token.error);

    // UserInfo validates the opaque Microsoft access token at the provider. Never
    // authorize from an unverified JWT payload or from preferred_username/email.
    const userRes = await this.request(endpoints.userInfoEndpoint, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const user = await userRes.json() as { sub?: string; email?: string; name?: string };
    if (!userRes.ok || !user.sub) this.tokenError("Microsoft", userRes.status);
    return this.socialProfile(user.sub, user.email, user.name);
  }

  private async exchangeFacebook(code: string): Promise<OAuthUserProfile> {
    const clientId = process.env.FACEBOOK_CLIENT_ID;
    const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;
    const redirectUri = process.env.OAUTH_REDIRECT_URI;
    const version = process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";
    if (!clientId || !clientSecret || !redirectUri || !/^v\d+\.0$/.test(version)) this.configurationError();
    const base = `https://graph.facebook.com/${version}`;
    const tokenRes = await this.request(`${base}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    });
    const token = await tokenRes.json() as { access_token?: string; error?: { code?: number } };
    if (!tokenRes.ok || token.error || !token.access_token) {
      this.tokenError("Facebook", tokenRes.status, token.error?.code === 100 || token.error?.code === 190 ? "invalid_grant" : undefined);
    }

    const debugUrl = new URL(`${base}/debug_token`);
    debugUrl.searchParams.set("input_token", token.access_token);
    const appToken = `${clientId}|${clientSecret}`;
    this.addFacebookProof(debugUrl, appToken, clientSecret);
    const debugRes = await this.request(debugUrl.href, {
      headers: { Authorization: `Bearer ${appToken}` },
    });
    const debug = await debugRes.json() as { data?: { is_valid?: boolean; app_id?: string | number; user_id?: string } };
    if (!debugRes.ok || debug.data?.is_valid !== true || String(debug.data.app_id) !== clientId || !debug.data.user_id) {
      this.tokenError("Facebook", debugRes.status, "invalid_grant");
    }

    const userUrl = new URL(`${base}/me`);
    userUrl.searchParams.set("fields", "id,name,email");
    this.addFacebookProof(userUrl, token.access_token, clientSecret);
    const userRes = await this.request(userUrl.href, { headers: { Authorization: `Bearer ${token.access_token}` } });
    const user = await userRes.json() as { id?: string; email?: string; name?: string };
    if (!userRes.ok || user.id !== debug.data.user_id) this.tokenError("Facebook", userRes.status);
    return this.socialProfile(user.id, user.email, user.name);
  }

  private socialProfile(providerId: string, email?: string, name?: string): OAuthUserProfile {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw new UnauthorizedException({ code: "oauth_email_required", message: "Não recebemos um e-mail deste provedor. Autorize o compartilhamento do e-mail ou use outra opção de acesso." });
    }
    return { providerId, email, name: name || email.split("@")[0]!, emailVerified: false };
  }

  private addFacebookProof(url: URL, token: string, secret: string) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    url.searchParams.set("appsecret_time", timestamp);
    url.searchParams.set("appsecret_proof", createHmac("sha256", secret).update(`${token}|${timestamp}`).digest("hex"));
  }

  private configurationError(): never {
    throw new ServiceUnavailableException({ code: "oauth_configuration_error", message: "O login deste provedor está temporariamente indisponível. Use outra opção de acesso." });
  }

  private async oidcEndpoints(provider: "google" | "microsoft") {
    const cached = this.discoveryCache.get(provider);
    if (cached && cached.expiresAt > Date.now()) return cached;
    const config = provider === "google"
      ? { url: "https://accounts.google.com/.well-known/openid-configuration", tokenOrigin: "https://oauth2.googleapis.com", userInfoOrigin: "https://openidconnect.googleapis.com" }
      : { url: "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration", tokenOrigin: "https://login.microsoftonline.com", userInfoOrigin: "https://graph.microsoft.com" };
    const response = await this.request(config.url, {});
    if (!response.ok) this.configurationError();
    const document = await response.json() as { token_endpoint?: string; userinfo_endpoint?: string };
    const trustedEndpoint = (value: string | undefined, origin: string) => {
      try {
        const url = new URL(value ?? "");
        if (url.origin === origin && !url.username && !url.password && !url.hash) return url.href;
      } catch { /* Invalid provider metadata must not receive tokens or secrets. */ }
      return this.configurationError();
    };
    const maxAge = response.headers.get("cache-control")?.match(/(?:^|[,\s])max-age=(\d+)/i)?.[1];
    const lifetime = Math.min(Number(maxAge ?? 3600), 86400) * 1000;
    const endpoints = {
      tokenEndpoint: trustedEndpoint(document.token_endpoint, config.tokenOrigin),
      userInfoEndpoint: trustedEndpoint(document.userinfo_endpoint, config.userInfoOrigin),
      expiresAt: Date.now() + lifetime,
    };
    this.discoveryCache.set(provider, endpoints);
    return endpoints;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(7_000) });
    } catch {
      throw new ServiceUnavailableException({ code: "oauth_provider_unavailable", message: "O provedor de login não respondeu. Inicie o login novamente." });
    }
  }

  private tokenError(provider: string, status: number, error?: string): never {
    const reason = error && /^[a-z_]+$/.test(error) ? error : "unknown";
    this.logger.warn(`${provider} token exchange rejected: status=${status} reason=${reason}`);
    if (reason === "invalid_grant" || reason === "bad_verification_code") {
      throw new UnauthorizedException({ code: "oauth_code_expired", message: "Esta autorização expirou ou já foi usada. Clique em Tentar novamente e entre pelo provedor." });
    }
    if (reason === "invalid_client" || reason === "incorrect_client_credentials" || reason === "redirect_uri_mismatch") {
      throw new ServiceUnavailableException({ code: "oauth_configuration_error", message: "O login deste provedor está temporariamente indisponível. Tente novamente mais tarde." });
    }
    throw new ServiceUnavailableException({ code: "oauth_provider_rejected", message: "O provedor não autorizou o login. Inicie uma nova tentativa." });
  }
}
