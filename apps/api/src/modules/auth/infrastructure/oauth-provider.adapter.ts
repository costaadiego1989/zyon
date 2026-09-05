import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { OAuthProviderPort, OAuthUserProfile } from "../domain/ports/oauth-provider.port.js";

@Injectable()
export class OAuthProviderAdapter implements OAuthProviderPort {
  private readonly logger = new Logger("OAuthProviderAdapter");

  async exchangeCodeForProfile(
    provider: "github" | "google",
    code: string
  ): Promise<OAuthUserProfile> {
    if (provider === "github") {
      return this.exchangeGithub(code);
    }
    return this.exchangeGoogle(code);
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
    };
  }

  private async exchangeGoogle(code: string): Promise<OAuthUserProfile> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.OAUTH_REDIRECT_URI;

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException("Google OAuth not configured");
    }

    // Exchange code for tokens
    const tokenRes = await this.request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri || "",
        grant_type: "authorization_code",
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
    const userRes = await this.request("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });

    if (!userRes.ok) {
      throw new InternalServerErrorException("Google user info fetch failed");
    }

    const user = (await userRes.json()) as {
      id: string;
      email: string;
      verified_email?: boolean;
      name?: string;
      picture?: string;
    };

    if (!user.email || user.verified_email !== true) {
      throw new UnauthorizedException({ code: "oauth_email_not_verified", message: "Confirme seu e-mail no Google antes de entrar." });
    }

    return {
      email: user.email,
      name: user.name || user.email.split("@")[0]!,
      avatarUrl: user.picture,
      providerId: user.id,
    };
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(7_000) });
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
