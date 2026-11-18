import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FiscalCredentialCipherPort } from "../domain/fiscal-configuration.port.js";
import type { FiscalActor, FiscalTenant } from "../domain/fiscal-repository.port.js";
import { normalizeFiscalTaxId } from "../domain/fiscal-recipient.js";
import type { FiscalOlistOAuthPort, OlistAuthorizationInput } from "../domain/fiscal-olist-oauth.port.js";

const authorizationEndpoint = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth";
const tokenEndpoint = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";
const infoEndpoint = "https://api.tiny.com.br/public-api/v3/info";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const connectionFingerprint = (value: { credentialCipher: string | null; disconnectedAt: Date | null }) => hash(JSON.stringify([value.credentialCipher, value.disconnectedAt?.getTime() ?? null]));
interface PendingAuthorization extends OlistAuthorizationInput { redirectUri: string; expectedConnectionFingerprint?: string }

export function fiscalPublicUrl(value: string | undefined): URL {
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new Error("fiscal_public_url_required"); }
  if (url.username || url.password || url.search || url.hash || url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("fiscal_public_url_invalid");
  return url;
}

/** The callback completes through the authenticated dashboard, never an anonymous code exchange. */
export class FiscalOlistOAuthService implements FiscalOlistOAuthPort {
  constructor(private readonly prisma: PrismaClient, private readonly cipher: FiscalCredentialCipherPort,
    private readonly env: NodeJS.ProcessEnv = process.env, private readonly fetcher: typeof fetch = fetch) {}

  configuration(scope: FiscalTenant) {
    if (!["homologation", "production"].includes(scope.environment)) throw new Error("fiscal_olist_authorization_invalid");
    fiscalPublicUrl(this.env.DASHBOARD_URL);
    const url = fiscalPublicUrl(this.env.API_PUBLIC_URL);
    url.pathname = "/v1/webhooks/fiscal/olist/oauth/callback";
    return { redirectUri: url.toString() };
  }

  /** Public navigation bridge only. Code exchange always requires the authenticated original actor. */
  async callback(state: unknown, code: unknown, error: unknown) {
    if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error("fiscal_olist_authorization_invalid");
    const session = await this.prisma.fiscalOlistOAuthSession.findFirst({ where: { stateHash: hash(state), expiresAt: { gt: new Date() }, claimedAt: null } });
    if (!session) throw new Error("fiscal_olist_authorization_expired_or_used");
    const url = fiscalPublicUrl(this.env.DASHBOARD_URL);
    url.searchParams.set("olist_fiscal", "1"); url.searchParams.set("state", state);
    url.hash = "fiscal-settings?environment=" + session.environment;
    if (typeof error === "string" && error) url.searchParams.set("error", "access_denied");
    else if (typeof code === "string" && code.trim() && code.length <= 4096) url.searchParams.set("code", code);
    else throw new Error("fiscal_olist_authorization_invalid");
    return url.toString();
  }

  async start(scope: FiscalTenant, actor: FiscalActor, input: OlistAuthorizationInput) {
    const issuerTaxId = normalizeFiscalTaxId(input.issuerTaxId);
    if (!actor.actorId || !scope.merchantId || !["homologation", "production"].includes(scope.environment) || issuerTaxId?.length !== 14
      || typeof input.clientId !== "string" || !input.clientId.trim() || input.clientId.length > 256 || /[\r\n]/.test(input.clientId)
      || typeof input.clientSecret !== "string" || !input.clientSecret.trim() || input.clientSecret.length > 4096 || /[\r\n]/.test(input.clientSecret)
      || [input.stockOwner, input.emailOwner, input.whatsappOwner].some(v => !["zyon", "provider"].includes(v))) throw new Error("fiscal_olist_authorization_invalid");
    const previous = input.connectionId ? await this.prisma.fiscalConnection.findFirst({ where: { ...scope, id: input.connectionId, provider: "tiny", issuerTaxId } }) : null;
    if (input.connectionId && !previous) throw new Error("fiscal_connection_not_found");
    const state = randomBytes(32).toString("base64url");
    const redirectUri = this.configuration(scope).redirectUri;
    const pending: PendingAuthorization = { issuerTaxId, clientId: input.clientId.trim(), clientSecret: input.clientSecret,
      stockOwner: input.stockOwner, emailOwner: input.emailOwner, whatsappOwner: input.whatsappOwner, redirectUri,
      ...(previous ? { connectionId: previous.id, expectedConnectionFingerprint: connectionFingerprint(previous) } : {}) };
    await this.prisma.fiscalOlistOAuthSession.deleteMany({ where: { ...scope, expiresAt: { lt: new Date(Date.now() - 86_400_000) } } });
    await this.prisma.fiscalOlistOAuthSession.create({ data: { ...scope, actorId: actor.actorId, stateHash: hash(state),
      credentialCipher: this.cipher.encrypt(JSON.stringify(pending)), expiresAt: new Date(Date.now() + 600_000) } });
    const url = new URL(authorizationEndpoint);
    url.search = new URLSearchParams({ client_id: pending.clientId, redirect_uri: redirectUri, scope: "openid", response_type: "code", state }).toString();
    return { url: url.toString(), state, redirectUri, expiresInSeconds: 600 };
  }

  private async json(url: string, init: RequestInit) {
    const response = await this.fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    if (!response.ok || text.length > 1024 * 1024) throw new Error("fiscal_olist_authorization_failed");
    try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new Error("fiscal_olist_authorization_failed"); }
  }

  async complete(scope: FiscalTenant, actor: FiscalActor, state: string, code: string) {
    if (!actor.actorId || typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state) || typeof code !== "string" || !code.trim() || code.length > 4096) throw new Error("fiscal_olist_authorization_invalid");
    const where = { ...scope, actorId: actor.actorId, stateHash: hash(state), expiresAt: { gt: new Date() } };
    const session = await this.prisma.fiscalOlistOAuthSession.findFirst({ where });
    if (!session || session.claimedAt || !session.credentialCipher) throw new Error("fiscal_olist_authorization_expired_or_used");
    const claim = await this.prisma.fiscalOlistOAuthSession.updateMany({ where: { ...where, claimedAt: null }, data: { claimedAt: new Date(), credentialCipher: null } });
    if (claim.count !== 1) throw new Error("fiscal_olist_authorization_expired_or_used");
    // Claim and erase before IO. A timeout requires fresh authorization, never replaying a possibly consumed code.
    try {
      const pending = JSON.parse(this.cipher.decrypt(session.credentialCipher)) as PendingAuthorization;
      const result = await this.json(tokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: pending.clientId, client_secret: pending.clientSecret, redirect_uri: pending.redirectUri, code }).toString() });
      if (typeof result.access_token !== "string" || !result.access_token || result.access_token.length > 16000
        || typeof result.refresh_token !== "string" || !result.refresh_token || result.refresh_token.length > 16000
        || !Number.isSafeInteger(result.expires_in) || Number(result.expires_in) <= 0 || Number(result.expires_in) > 31_536_000
        || typeof result.token_type !== "string" || result.token_type.toLowerCase() !== "bearer") throw new Error("fiscal_olist_authorization_failed");
      const info = await this.json(infoEndpoint, { headers: { authorization: "Bearer " + result.access_token } });
      if (normalizeFiscalTaxId(String(info.cpfCnpj ?? "")) !== pending.issuerTaxId) throw new Error("fiscal_olist_issuer_mismatch");
      return await this.prisma.$transaction(async tx => {
        let notificationToken: string | undefined;
        let isActive = false;
        if (pending.connectionId) {
          await tx.$queryRaw`SELECT id FROM fiscal_connections WHERE id = ${pending.connectionId} AND merchant_id = ${scope.merchantId} AND environment = ${scope.environment}::"FiscalEnvironment" FOR UPDATE`;
          const previous = await tx.fiscalConnection.findFirst({ where: { ...scope, id: pending.connectionId, provider: "tiny", issuerTaxId: pending.issuerTaxId } });
          if (!previous || connectionFingerprint(previous) !== pending.expectedConnectionFingerprint) throw new Error("fiscal_olist_connection_changed");
          isActive = previous.isActive;
          if (previous.credentialCipher) {
            try {
              const old = JSON.parse(this.cipher.decrypt(previous.credentialCipher)) as { notificationToken?: string };
              if (/^[A-Za-z0-9_-]{43}$/.test(old.notificationToken ?? "")) notificationToken = old.notificationToken;
            } catch { /* A legacy credential must not prevent a fresh verified authorization. */ }
          }
        }
        const credentialCipher = this.cipher.encrypt(JSON.stringify({ contract: "olist_oauth_v3", environment: scope.environment, issuerTaxId: pending.issuerTaxId,
          token: result.access_token, refreshToken: result.refresh_token, expiresAt: new Date(Date.now() + Number(result.expires_in) * 1000).toISOString(),
          clientId: pending.clientId, clientSecret: pending.clientSecret, ...(notificationToken ? { notificationToken } : {}) }));
        const data = { credentialCipher, readiness: [], isActive, disconnectedAt: null };
        const connection = pending.connectionId
          ? await tx.fiscalConnection.update({ where: { id: pending.connectionId }, data })
          : await tx.fiscalConnection.create({ data: { ...scope, ...data, provider: "tiny", issuerTaxId: pending.issuerTaxId,
              stockOwner: pending.stockOwner, emailOwner: pending.emailOwner, whatsappOwner: pending.whatsappOwner } });
        await tx.fiscalOlistOAuthSession.update({ where: { stateHash: session.stateHash }, data: { completedAt: new Date(), resultConnectionId: connection.id } });
        await tx.merchantAuditEvent.create({ data: { merchantId: scope.merchantId, actorType: actor.actorKind, actorId: actor.actorId!,
          action: "fiscal.olist.authorize", resourceType: "fiscal_connection", resourceId: connection.id, metadata: { provider: "tiny", environment: scope.environment, result: "inspection_required" } } });
        return { connectionId: connection.id, provider: "tiny" as const, environment: scope.environment, isActive: connection.isActive };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      throw new Error(["fiscal_olist_issuer_mismatch", "fiscal_olist_connection_changed"].includes(message) ? message : "fiscal_olist_authorization_failed");
    }
  }
}
