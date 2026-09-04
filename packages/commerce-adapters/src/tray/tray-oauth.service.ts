import type { TrayCommerceCredentials } from "./tray-types.js";

export type TrayRefreshResult = {
  access_token: string;
  refresh_token: string;
  date_expiration_access_token: number;
};

/**
 * Handles Tray OAuth token refresh lifecycle.
 * Tray tokens are stored and refreshed per merchant (per api_address).
 * Token refresh is mandatory when code=1000 (expired) or on 401.
 */
export class TrayOAuthService {
  constructor(
    private readonly credentials: TrayCommerceCredentials,
    private readonly fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    if (!credentials.apiAddress) throw new Error("tray_api_address_required");
    if (!credentials.consumerKey) throw new Error("tray_consumer_key_required");
    if (!credentials.consumerSecret)
      throw new Error("tray_consumer_secret_required");
  }

  /**
   * Refresh the access token using the refresh_token.
   * Returns the new tokens and expiry date.
   * On failure, throws an error that should mark the connection degraded.
   */
  async refresh(): Promise<TrayRefreshResult> {
    const url = new URL(`${this.credentials.apiAddress}/auth`);
    url.searchParams.set("consumer_key", this.credentials.consumerKey);
    url.searchParams.set("consumer_secret", this.credentials.consumerSecret);
    url.searchParams.set("refresh_token", this.credentials.refreshToken);

    const response = await this.fetchFn(url.href, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`tray_token_refresh_failed_${response.status}`);
    }

    const json = (await response.json()) as Record<string, unknown>;
    const newAccessToken = String(json.access_token ?? "");
    const newRefreshToken = String(json.refresh_token ?? "");
    const expiresAt = Number(json.date_expiration_access_token ?? 0);

    if (!newAccessToken || !newRefreshToken || !expiresAt) {
      throw new Error("tray_token_refresh_missing_fields");
    }

    return {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      date_expiration_access_token: expiresAt,
    };
  }

  /**
   * Check if the access token is expired (within 5 min buffer).
   */
  isExpired(): boolean {
    const expiresAt = this.credentials.accessTokenExpiresAt;
    if (!expiresAt) return true;
    const now = Math.floor(Date.now() / 1000);
    return now >= expiresAt - 300; // 5-min buffer
  }
}
