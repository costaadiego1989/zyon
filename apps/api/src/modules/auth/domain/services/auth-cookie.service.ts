import type { AuthResponse } from "../../application/register-merchant.use-case.js";

export class AuthCookieService {
  constructor(
    private readonly cookieName = process.env.AUTH_COOKIE_NAME ?? "aacp_access_token",
    private readonly secure = process.env.NODE_ENV === "production"
  ) {}

  create(auth: AuthResponse): string {
    const parts = [
      `${this.cookieName}=${auth.access_token}`,
      "HttpOnly",
      "SameSite=Lax",
      "Path=/",
      `Max-Age=${auth.expires_in}`
    ];
    if (this.secure) parts.push("Secure");
    return parts.join("; ");
  }

  clear(): string {
    const parts = [
      `${this.cookieName}=`,
      "HttpOnly",
      "SameSite=Lax",
      "Path=/",
      "Max-Age=0"
    ];
    if (this.secure) parts.push("Secure");
    return parts.join("; ");
  }

  read(cookieHeader?: string): string | undefined {
    if (!cookieHeader) return undefined;
    const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
    const prefix = `${this.cookieName}=`;
    const found = cookies.find((cookie) => cookie.startsWith(prefix));
    return found?.slice(prefix.length);
  }
}
