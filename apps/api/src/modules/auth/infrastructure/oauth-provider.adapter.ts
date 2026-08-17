import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
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
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
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

    if (!tokenRes.ok) {
      this.logger.error(`GitHub token exchange failed: ${tokenRes.status}`);
      throw new InternalServerErrorException("GitHub OAuth token exchange failed");
    }

    const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (tokenBody.error || !tokenBody.access_token) {
      this.logger.error(`GitHub token error: ${tokenBody.error}`);
      throw new InternalServerErrorException("GitHub OAuth token exchange failed");
    }

    // Fetch user profile
    const userRes = await fetch("https://api.github.com/user", {
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

    // GitHub may not return email on /user — fetch from /user/emails
    let email = user.email;
    if (!email) {
      const emailsRes = await fetch("https://api.github.com/user/emails", {
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
      throw new InternalServerErrorException("GitHub account has no verified email");
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
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
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

    if (!tokenRes.ok) {
      this.logger.error(`Google token exchange failed: ${tokenRes.status}`);
      throw new InternalServerErrorException("Google OAuth token exchange failed");
    }

    const tokenBody = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
    };

    if (tokenBody.error || !tokenBody.access_token) {
      throw new InternalServerErrorException("Google OAuth token exchange failed");
    }

    // Fetch user info
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });

    if (!userRes.ok) {
      throw new InternalServerErrorException("Google user info fetch failed");
    }

    const user = (await userRes.json()) as {
      id: string;
      email: string;
      name?: string;
      picture?: string;
    };

    if (!user.email) {
      throw new InternalServerErrorException("Google account has no email");
    }

    return {
      email: user.email,
      name: user.name || user.email.split("@")[0]!,
      avatarUrl: user.picture,
      providerId: user.id,
    };
  }
}
