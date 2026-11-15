import { createHmac } from "node:crypto";
import { MetaAdsError, type MetaOAuthPort } from "../domain/types.js";
import type { MetaAdsEnvironment } from "../domain/offer.js";

const scopes = ["ads_mcp_management", "ads_management", "catalog_management", "business_management", "pages_show_list", "instagram_basic"];
export class MetaOAuthAdapter implements MetaOAuthPort {
  constructor(private readonly env: MetaAdsEnvironment, private readonly request: typeof fetch = fetch) {}

  configured(): boolean {
    try {
      const redirect = new URL(this.env.META_ADS_OAUTH_REDIRECT_URI ?? "");
      return /^\d+$/.test(this.env.META_ADS_OAUTH_APP_ID ?? "") && Boolean(this.env.META_ADS_OAUTH_APP_SECRET) &&
        /^v\d+\.0$/.test(this.env.META_ADS_GRAPH_API_VERSION ?? "") && !redirect.username && !redirect.password && !redirect.hash && (!redirect.search || redirect.search === "?tab=meta-ads-agent") &&
        (redirect.protocol === "https:" || (redirect.protocol === "http:" && ["localhost", "127.0.0.1"].includes(redirect.hostname)));
    } catch { return false; }
  }
  private validateRedirect(redirectUri: string): void {
    if (!this.configured()) throw new MetaAdsError("meta_oauth_not_configured", 503);
    if (redirectUri !== this.env.META_ADS_OAUTH_REDIRECT_URI) throw new MetaAdsError("meta_oauth_redirect_invalid", 400);
  }

  authorizationUrl(state: string, redirectUri: string): string {
    this.validateRedirect(redirectUri);
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new MetaAdsError("meta_oauth_state_invalid");
    const url = new URL(`https://www.facebook.com/${this.env.META_ADS_GRAPH_API_VERSION}/dialog/oauth`);
    url.search = new URLSearchParams({ client_id: this.env.META_ADS_OAUTH_APP_ID!, redirect_uri: redirectUri, response_type: "code", state, scope: scopes.join(",") }).toString();
    if (this.env.META_ADS_OAUTH_CONFIG_ID) url.searchParams.set("config_id", this.env.META_ADS_OAUTH_CONFIG_ID);
    return url.href;
  }

  async exchange(code: string, redirectUri: string) {
    this.validateRedirect(redirectUri);
    if (!code || code.length > 4096) throw new MetaAdsError("meta_oauth_code_invalid");
    const base = `https://graph.facebook.com/${this.env.META_ADS_GRAPH_API_VERSION}`;
    const exchange = async (parameters: Record<string, string>): Promise<string> => {
      const result = await this.json(`${base}/oauth/access_token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.env.META_ADS_OAUTH_APP_ID!, client_secret: this.env.META_ADS_OAUTH_APP_SECRET!, ...parameters }) });
      if (typeof result.access_token !== "string" || !result.access_token) throw new MetaAdsError("meta_oauth_exchange_failed", 502);
      return result.access_token;
    };
    const shortToken = await exchange({ code, redirect_uri: redirectUri });
    const accessToken = await exchange({ grant_type: "fb_exchange_token", fb_exchange_token: shortToken });
    const appToken = `${this.env.META_ADS_OAUTH_APP_ID}|${this.env.META_ADS_OAUTH_APP_SECRET}`;
    const debugUrl = new URL(`${base}/debug_token`);
    debugUrl.searchParams.set("input_token", accessToken);
    debugUrl.searchParams.set("appsecret_proof", createHmac("sha256", this.env.META_ADS_OAUTH_APP_SECRET!).update(appToken).digest("hex"));
    const result = await this.json(debugUrl.href, { headers: { Authorization: `Bearer ${appToken}` } });
    const data = result.data as { is_valid?: boolean; app_id?: string | number; scopes?: unknown; expires_at?: unknown } | undefined;
    const granted = Array.isArray(data?.scopes) ? data.scopes.filter((value): value is string => typeof value === "string") : [];
    if (data?.is_valid !== true || String(data.app_id) !== this.env.META_ADS_OAUTH_APP_ID || !granted.includes("ads_mcp_management") ||
      !(granted.includes("ads_read") || granted.includes("ads_management"))) throw new MetaAdsError("meta_oauth_permission_denied", 403);
    const expiry = typeof data.expires_at === "number" && data.expires_at > 0 ? new Date(data.expires_at * 1000).toISOString() : null;
    return { accessToken, scopes: granted, expiresAt: expiry };
  }

  private async json(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    try {
      const response = await this.request(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20000) });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || "error" in body) throw new Error();
      return body as Record<string, unknown>;
    } catch { throw new MetaAdsError("meta_oauth_exchange_failed", 502); }
  }
}
