export type TenantRole = "owner" | "admin" | "staff";

export interface AuthMerchant {
  id: string;
  name: string;
  oauthRegistrationPending?: boolean;
  ownerName?: string;
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

export interface BearerTokenView {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
}

export interface AuthResponse extends BearerTokenView {
  merchant_id: string;
  user_id: string;
  email: string;
}

export interface CookieConfig {
  cookieName: string;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
  domain?: string;
  partitioned?: boolean;
  cookieMaxAgeSeconds?: number;
}
