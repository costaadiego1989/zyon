export const OAUTH_PROVIDER_PORT = Symbol("OAUTH_PROVIDER_PORT");

export interface OAuthUserProfile {
  email: string;
  name: string;
  avatarUrl?: string;
  providerId: string;
}

export interface OAuthProviderPort {
  exchangeCodeForProfile(
    provider: "github" | "google",
    code: string
  ): Promise<OAuthUserProfile>;
}
