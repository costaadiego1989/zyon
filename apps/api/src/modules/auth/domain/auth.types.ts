export interface AuthMerchant {
  id: string;
  name: string;
}

export interface AuthUser {
  id: string;
  merchantId: string;
  email: string;
  passwordHash: string;
  role: "owner" | "admin";
}

export interface AuthenticatedPrincipal {
  userId: string;
  merchantId: string;
  email: string;
  role: AuthUser["role"];
}

export interface AuthTokens {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
}
