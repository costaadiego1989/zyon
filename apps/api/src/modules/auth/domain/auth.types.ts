/**
 * Closes M12: explicit TenantRole union decoupled from AuthUser.
 * Closes M6, H2: AuthResponse + toAuthResponse moved to domain layer.
 * Closes L16: BearerTokenView extracted.
 */

export type TenantRole = "owner" | "admin";

export interface AuthMerchant {
  id: string;
  name: string;
}

export interface AuthUser {
  id: string;
  merchantId: string;
  email: string;
  passwordHash?: string;
  role: TenantRole;
  oauthProvider?: string;
  oauthProviderId?: string;
}

export interface AuthenticatedPrincipal {
  userId: string;
  merchantId: string;
  email: string;
  role: TenantRole;
}

export interface AuthTokens {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
}

/** Extracted view for bearer token fields only (L16). */
export interface BearerTokenView {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
}

/** Full auth response combining identity and token info. */
export interface AuthResponse extends BearerTokenView {
  merchant_id: string;
  user_id: string;
  email: string;
}

/** Cookie configuration value object (H7). */
export interface CookieConfig {
  cookieName: string;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
  domain?: string;
  partitioned?: boolean;
}
