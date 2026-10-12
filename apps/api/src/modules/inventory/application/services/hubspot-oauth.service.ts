import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import { REDIS_CLIENT_TOKEN } from "../../../../shared/cache/redis.module.js";
import { CRM_CONNECTION_REPOSITORY, type CrmConnectionRepositoryPort, type CrmConnectionRow, publicCrmConnection } from "../../domain/ports/crm-connection-repository.port.js";
import { encryptCrmSecret, decryptCrmSecret } from "../../infrastructure/adapters/crm-secret-cipher.js";
import { CrmAdapterFactory } from "../../infrastructure/adapters/crm-adapter.factory.js";

const SCOPES = ["crm.objects.contacts.read", "crm.objects.contacts.write", "crm.objects.deals.read", "crm.objects.deals.write"];
const TOKEN_URL = "https://api.hubspot.com/oauth/2026-09/token";
const CONSUME_STATE = `
local value = redis.call('GET', KEYS[1])
if not value then return nil end
local item = cjson.decode(value)
if item.merchantId ~= ARGV[1] or item.userId ~= ARGV[2] then return nil end
redis.call('DEL', KEYS[1])
return value`;
const RELEASE_LOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

type Principal = { merchantId: string; userId: string };
type TokenPair = { access_token: string; refresh_token: string; expires_in: number };

function configuredUrl(value: string | undefined): string {
  try {
    const url = new URL(value ?? "");
    const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.username || url.password || url.hash || url.search || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw new Error();
    return url.toString();
  } catch { throw new ServiceUnavailableException("crm_oauth_unavailable"); }
}

@Injectable()
export class HubSpotOAuthService {
  constructor(
    @Inject(CRM_CONNECTION_REPOSITORY) private readonly repo: CrmConnectionRepositoryPort,
    private readonly adapters: CrmAdapterFactory,
    @Optional() @Inject(REDIS_CLIENT_TOKEN) private readonly redis?: Redis | null,
  ) {}

  private config() {
    const clientId = process.env.HUBSPOT_CLIENT_ID?.trim();
    const clientSecret = process.env.HUBSPOT_CLIENT_SECRET?.trim();
    const redirectUri = configuredUrl(process.env.HUBSPOT_REDIRECT_URI);
    const dashboardUrl = configuredUrl(process.env.DASHBOARD_URL);
    if (!clientId || !clientSecret || !this.redis || (process.env.NODE_ENV === "production" && !process.env.AACP_CRM_ENC_KEY?.trim())) {
      throw new ServiceUnavailableException("crm_oauth_unavailable");
    }
    return { clientId, clientSecret, redirectUri, dashboardUrl };
  }

  dashboardRedirect(result: "connected" | "denied" | "failed"): string {
    const url = new URL(configuredUrl(process.env.DASHBOARD_URL));
    url.searchParams.set("crm_oauth", result);
    url.hash = "crm-integrations";
    return url.toString();
  }

  async authorize(principal: Principal): Promise<{ url: string }> {
    const config = this.config();
    const state = randomBytes(32).toString("base64url");
    try {
      await this.redis!.set(this.stateKey(state), JSON.stringify({ merchantId: principal.merchantId, userId: principal.userId }), "EX", 600);
    } catch { throw new ServiceUnavailableException("crm_oauth_unavailable"); }
    const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri,
      scope: SCOPES.join(" "), state });
    return { url: `https://app.hubspot.com/oauth/authorize?${query}` };
  }

  private stateKey(state: string) {
    return `zyon:crm:hubspot:oauth-state:${createHash("sha256").update(state).digest("hex")}`;
  }

  async complete(principal: Principal, state: string, code?: string, denied = false) {
    this.config();
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new BadRequestException("crm_oauth_state_invalid");
    let consumed: unknown;
    try { consumed = await this.redis!.eval(CONSUME_STATE, 1, this.stateKey(state), principal.merchantId, principal.userId); }
    catch { throw new ServiceUnavailableException("crm_oauth_unavailable"); }
    if (!consumed) throw new BadRequestException("crm_oauth_state_invalid");
    if (denied) return null;
    if (!code || code.length > 4096) throw new BadRequestException("crm_oauth_code_invalid");
    const tokens = await this.tokens({ grant_type: "authorization_code", code });
    const adapter = this.adapters.create({ provider: "hubspot", accessToken: tokens.access_token });
    if (!(await adapter.validateCredentials())) throw new BadRequestException("crm_credentials_invalid");
    const row = await this.repo.upsert(principal.merchantId, "hubspot", {
      status: "connected", accessTokenCipher: encryptCrmSecret(tokens.access_token),
      refreshTokenCipher: encryptCrmSecret(tokens.refresh_token),
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000), config: { authType: "oauth" },
    });
    return publicCrmConnection(row);
  }

  private async tokens(fields: Record<string, string>): Promise<TokenPair> {
    const config = this.config();
    try {
      const response = await fetch(TOKEN_URL, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ ...fields, client_id: config.clientId, client_secret: config.clientSecret,
          ...(fields.grant_type === "authorization_code" ? { redirect_uri: config.redirectUri } : {}) }).toString() });
      if (!response.ok) throw new Error();
      const data = await response.json() as TokenPair;
      if (typeof data.access_token !== "string" || !data.access_token || typeof data.refresh_token !== "string" || !data.refresh_token ||
          !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error();
      return data;
    } catch { throw new BadRequestException("crm_oauth_token_failed"); }
  }

  async accessToken(connection: CrmConnectionRow): Promise<string> {
    if (connection.provider !== "hubspot" || connection.config?.authType !== "oauth" || !connection.accessTokenCipher) {
      throw new BadRequestException("crm_oauth_connection_invalid");
    }
    if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() > Date.now() + 90000) {
      return decryptCrmSecret(connection.accessTokenCipher);
    }
    this.config();
    const key = `zyon:crm:hubspot:refresh:${connection.merchantId}:${connection.id}`;
    const lease = randomBytes(24).toString("base64url");
    if (!(await this.redis!.set(key, lease, "EX", 30, "NX"))) throw new ServiceUnavailableException("crm_oauth_refresh_busy");
    try {
      const current = await this.repo.findByProvider(connection.merchantId, "hubspot");
      // A disconnected or reconfigured connection must never be recreated by an in-flight refresh.
      if (!current || current.id !== connection.id || current.config?.authType !== "oauth" || !current.accessTokenCipher) {
        throw new BadRequestException("crm_oauth_connection_invalid");
      }
      if (current.tokenExpiresAt && current.tokenExpiresAt.getTime() > Date.now() + 90000) return decryptCrmSecret(current.accessTokenCipher);
      if (!current.refreshTokenCipher) throw new BadRequestException("crm_oauth_connection_invalid");
      const tokens = await this.tokens({ grant_type: "refresh_token", refresh_token: decryptCrmSecret(current.refreshTokenCipher) });
      const saved = await this.repo.updateOAuthTokens(connection.merchantId, current.id, current.accessTokenCipher, {
        accessTokenCipher: encryptCrmSecret(tokens.access_token), refreshTokenCipher: encryptCrmSecret(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      });
      if (!saved) throw new BadRequestException("crm_oauth_connection_changed");
      return tokens.access_token;
    } finally {
      // Release only our lease. A Redis failure here must not replace a successful token exchange.
      try { await this.redis!.eval(RELEASE_LOCK, 1, key, lease); } catch {}
    }
  }
}
