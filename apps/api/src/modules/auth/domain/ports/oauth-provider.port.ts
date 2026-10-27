export const OAUTH_PROVIDER_PORT = Symbol("OAUTH_PROVIDER_PORT");

export type OAuthProvider = "github" | "google" | "microsoft" | "facebook";
export interface OAuthExchangeOptions { codeVerifier?: string; }

export interface OAuthUserProfile {
  email: string;
  name: string;
  avatarUrl?: string;
  providerId: string;
  /** Only an explicit provider guarantee permits linking an existing account by email. */
  emailVerified?: boolean;
}

export interface OAuthProviderPort {
  exchangeCodeForProfile(
    provider: OAuthProvider,
    code: string,
    options?: OAuthExchangeOptions,
  ): Promise<OAuthUserProfile>;
}
