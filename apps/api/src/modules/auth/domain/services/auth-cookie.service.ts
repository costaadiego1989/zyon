import type { AuthResponse, CookieConfig } from "../auth.types.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { OAuthProvider } from "../ports/oauth-provider.port.js";

/**
 * H7: CookieConfig value object replaces hardcoded sameSite/secure.
 * M6: Imports AuthResponse from domain layer (not application/).
 */
export class AuthCookieService {
  private readonly config: CookieConfig;

  constructor(
    cookieNameOrConfig?: string | CookieConfig,
    secure?: boolean
  ) {
    // H7: Support both old positional signature and new config object for backward compat
    if (typeof cookieNameOrConfig === "object" && cookieNameOrConfig !== null) {
      this.config = cookieNameOrConfig;
    } else {
      // Legacy: (cookieName, secure)
      const secureCookies = secure ?? process.env.NODE_ENV === "production";
      const configuredSameSite = process.env.AUTH_COOKIE_SAME_SITE?.trim().toLowerCase();
      const sameSite = configuredSameSite === "strict" ? "Strict"
        : configuredSameSite === "none" && secureCookies ? "None" : "Lax";
      this.config = {
        cookieName: cookieNameOrConfig ?? process.env.AUTH_COOKIE_NAME ?? "aacp_access_token",
        secure: secureCookies,
        sameSite,
        domain: undefined,
        partitioned: undefined,
        cookieMaxAgeSeconds: 30 * 24 * 3600, // 30d — matches the refresh grace window
      };
    }
  }

  create(auth: AuthResponse): string {
    const parts = [
      `${this.config.cookieName}=${auth.access_token}`,
      "HttpOnly",
      `SameSite=${this.config.sameSite}`,
      "Path=/",
      // Cookie lives as long as the refresh window (default 30d), NOT the 1h token
      // exp, so the browser keeps the cookie and /auth/refresh can mint a fresh
      // token while the old one is expired-but-within-grace.
      `Max-Age=${this.config.cookieMaxAgeSeconds ?? auth.expires_in}`
    ];
    if (this.config.secure) parts.push("Secure");
    if (this.config.domain) parts.push(`Domain=${this.config.domain}`);
    if (this.config.partitioned) parts.push("Partitioned");
    return parts.join("; ");
  }

  clear(): string {
    const parts = [
      `${this.config.cookieName}=`,
      "HttpOnly",
      `SameSite=${this.config.sameSite}`,
      "Path=/",
      "Max-Age=0"
    ];
    if (this.config.secure) parts.push("Secure");
    if (this.config.domain) parts.push(`Domain=${this.config.domain}`);
    if (this.config.partitioned) parts.push("Partitioned");
    return parts.join("; ");
  }

  read(cookieHeader?: string): string | undefined {
    if (!cookieHeader) return undefined;
    const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
    const prefix = `${this.config.cookieName}=`;
    const found = cookies.find((cookie) => cookie.startsWith(prefix));
    // L2: No decoding currently; assert contract in tests
    return found?.slice(prefix.length);
  }

  createOAuthState(provider: OAuthProvider): { state: string; cookie: string } {
    const state = randomBytes(32).toString("base64url");
    return { state, cookie: this.oauthCookie(`${provider}.${state}`, 600) };
  }

  matchesOAuthState(provider: string, state: string, cookieHeader?: string): boolean {
    if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state) || !cookieHeader) return false;
    const prefix = `${this.oauthCookieName()}=`;
    const matches = cookieHeader.split(";").map(cookie => cookie.trim()).filter(cookie => cookie.startsWith(prefix));
    if (matches.length !== 1) return false;
    const received = Buffer.from(matches[0]!.slice(prefix.length));
    const expected = Buffer.from(`${provider}.${state}`);
    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  clearOAuthState(): string { return this.oauthCookie("", 0); }

  private oauthCookieName() { return this.config.secure ? "__Host-zyon_oauth_state" : "zyon_oauth_state"; }

  private oauthCookie(value: string, maxAge: number): string {
    const parts = [`${this.oauthCookieName()}=${value}`, "HttpOnly", `SameSite=${this.config.sameSite}`, "Path=/", `Max-Age=${maxAge}`];
    if (this.config.secure) parts.push("Secure");
    if (this.config.partitioned) parts.push("Partitioned");
    // A host-only cookie prevents a sibling subdomain from planting a known state.
    return parts.join("; ");
  }
}
