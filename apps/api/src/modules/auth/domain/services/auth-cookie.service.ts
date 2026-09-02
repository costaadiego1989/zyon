import type { AuthResponse, CookieConfig } from "../auth.types.js";

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
      this.config = {
        cookieName: cookieNameOrConfig ?? process.env.AUTH_COOKIE_NAME ?? "aacp_access_token",
        secure: secure ?? process.env.NODE_ENV === "production",
        sameSite: "Lax",
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
}
