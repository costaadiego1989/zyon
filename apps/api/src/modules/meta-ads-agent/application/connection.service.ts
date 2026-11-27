import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { MetaAdsAsset, MetaAdsConnection, MetaAdsDestination } from "@zyon/shared-types";
import { initialStore, MetaAdsError, type MetaAdsRepository, type CommerceContextPort, type MetaOAuthPort, type CredentialCodecPort, type MetaAdsProviderPort, type MetaAccess, type MetaAdsStoreState, type MetaDiscovery, type Clock } from "../domain/types.js";
import { requireEntitlement, requireIdentifier, stableDigest } from "../domain/offer.js";

interface Selection { accountId: string; pageId?: string | null; catalogId?: string | null; datasetId?: string | null; whatsappId?: string | null; }
interface AccessOptions { destination?: MetaAdsDestination; operation?: "prepare" | "publish" | "optimize"; allowExpired?: boolean; }
const stateHash = (value: string) => createHash("sha256").update(value).digest("hex");
const conversationId = () => { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"; return Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]).join(""); };

export class ConnectionService {
  constructor(private readonly repo: MetaAdsRepository, private readonly commerce: Pick<CommerceContextPort, "getPlan">, private readonly oauth: MetaOAuthPort,
    private readonly codec: CredentialCodecPort, private readonly provider: MetaAdsProviderPort, private readonly redirectUri: string, private readonly clock: Clock = () => new Date()) {}

  private publicView(state: MetaAdsStoreState): MetaAdsConnection {
    const c = state.connection;
    return structuredClone({ status: c.status, epoch: c.epoch, account: c.account, page: c.page, catalog: c.catalog, dataset: c.dataset, whatsapp: c.whatsapp,
      accounts: c.accounts, pages: c.pages, catalogs: c.catalogs, datasets: c.datasets, whatsappNumbers: c.whatsappNumbers, capabilities: c.capabilities,
      lastError: c.lastError, connectedAt: c.connectedAt, expiresAt: c.expiresAt, oauthConfigured: this.oauth.configured() });
  }
  async view(merchantId: string): Promise<MetaAdsConnection> { return this.publicView(await this.repo.read(merchantId)); }

  async begin(merchantId: string, actorId: string): Promise<{ authorizationUrl: string }> {
    requireIdentifier(actorId);
    if (!this.oauth.configured()) throw new MetaAdsError("meta_oauth_not_configured", 503);
    const plan = await this.commerce.getPlan(merchantId); const state = randomBytes(36).toString("base64url");
    const authorizationUrl = this.oauth.authorizationUrl(state, this.redirectUri);
    await this.repo.mutate(merchantId, [], stored => {
      requireEntitlement(plan, stored, this.clock());
      stored.pendingOAuth = { actorId, stateHash: stateHash(state), redirectUri: this.redirectUri, expiresAt: new Date(this.clock().getTime() + 10 * 60000).toISOString() };
      stored.connection.epoch++;
      this.invalidate(stored);
      stored.connection.status = "authorizing";
      return { result: undefined };
    });
    return { authorizationUrl };
  }
  private invalidate(state: MetaAdsStoreState): void {
    for (const proposal of Object.values(state.proposals)) if (["pending_review", "approved"].includes(proposal.status)) proposal.status = "stale";
    for (const execution of Object.values(state.executions)) {
      if (execution.status === "reserved") { execution.status = "failed"; execution.error = "meta_connection_changed"; }
      else if (["sending", "publishing", "active_unconfirmed", "execution_unknown"].includes(execution.status)) { execution.status = "execution_unknown"; execution.error = "meta_connection_changed_reconciliation_required"; }
    }
  }
  private discovered(state: MetaAdsStoreState, discovery: MetaDiscovery, scopes: string[]): void {
    const c = state.connection;
    c.accounts = discovery.accounts; c.pages = discovery.pages; c.catalogs = discovery.catalogs; c.datasets = discovery.datasets; c.whatsappNumbers = discovery.whatsappNumbers;
    c.capabilities = { ...discovery.capabilities };
    if (!scopes.includes("ads_management")) { c.capabilities.prepare = false; c.capabilities.publish = false; c.capabilities.optimize = false; }
    c.status = discovery.errors.length || !c.capabilities.prepare ? "limited" : "connected";
    c.lastError = discovery.errors[0] ?? null;
  }

  async complete(merchantId: string, actorId: string, rawState: string, code: string): Promise<MetaAdsConnection> {
    const plan = await this.commerce.getPlan(merchantId);
    const epoch = await this.repo.mutate(merchantId, [], state => {
      requireEntitlement(plan, state, this.clock());
      const pending = state.pendingOAuth;
      if (!pending || pending.actorId !== actorId || !/^[A-Za-z0-9_-]{32,128}$/.test(rawState) || !/^[a-f0-9]{64}$/.test(pending.stateHash) || !timingSafeEqual(Buffer.from(pending.stateHash, "hex"), Buffer.from(stateHash(rawState), "hex"))) throw new MetaAdsError("meta_oauth_state_invalid", 403);
      if (new Date(pending.expiresAt).getTime() <= this.clock().getTime()) throw new MetaAdsError("meta_oauth_state_expired", 403);
      if (pending.redirectUri !== this.redirectUri) throw new MetaAdsError("meta_oauth_redirect_invalid", 403);
      state.pendingOAuth = null;
      return { result: state.connection.epoch };
    });
    try {
      const token = await this.oauth.exchange(code, this.redirectUri);
      if ((await this.repo.read(merchantId)).connection.epoch !== epoch) throw new MetaAdsError("meta_connection_changed", 409);
      const access: MetaAccess = { merchantId, accessToken: token.accessToken, clientConversationId: conversationId(), connectionEpoch: epoch + 1, accountId: null, pageId: null, catalogId: null, datasetId: null, whatsappId: null };
      const discovery = await this.provider.discover(access);
      const encrypted = this.codec.encrypt(merchantId, token.accessToken);
      return await this.repo.mutate(merchantId, [], state => {
        requireEntitlement(plan, state, this.clock());
        if (state.connection.epoch !== epoch) throw new MetaAdsError("meta_connection_changed", 409);
        this.invalidate(state);
        state.connection = { ...initialStore(merchantId).connection, epoch: epoch + 1, encryptedAccessToken: encrypted, clientConversationId: access.clientConversationId, scopes: token.scopes,
          expiresAt: token.expiresAt, connectedAt: this.clock().toISOString(), oauthConfigured: true };
        this.discovered(state, discovery, token.scopes);
        return { result: this.publicView(state) };
      });
    } catch (error) {
      await this.repo.mutate(merchantId, [], state => {
        if (state.connection.epoch === epoch) {
          state.connection.status = "reconnect_required"; state.connection.lastError = error instanceof MetaAdsError ? error.code : "meta_connection_failed";
          state.connection.encryptedAccessToken = null; state.connection.epoch++; this.invalidate(state);
        }
        return { result: undefined };
      });
      throw error instanceof MetaAdsError ? error : new MetaAdsError("meta_connection_failed", 502);
    }
  }
  private credential(state: MetaAdsStoreState): MetaAccess {
    const c = state.connection;
    if (!["connected", "limited"].includes(c.status) || !c.encryptedAccessToken) throw new MetaAdsError("meta_connection_required", 409);
    if (c.expiresAt && (!Number.isFinite(new Date(c.expiresAt).getTime()) || new Date(c.expiresAt).getTime() <= this.clock().getTime())) throw new MetaAdsError("meta_token_expired", 409);
    return { merchantId: state.merchantId, accessToken: this.codec.decrypt(state.merchantId, c.encryptedAccessToken), clientConversationId: c.clientConversationId, connectionEpoch: c.epoch,
      accountId: c.account?.id ?? null, pageId: c.page?.id ?? null, catalogId: c.catalog?.id ?? null, datasetId: c.dataset?.id ?? null, whatsappId: c.whatsapp?.id ?? null };
  }
  async access(merchantId: string, options: AccessOptions = {}): Promise<MetaAccess> {
    const state = await this.repo.read(merchantId);
    if (options.allowExpired && options.operation) throw new MetaAdsError("addon_not_entitled", 403);
    if (!options.allowExpired) requireEntitlement(await this.commerce.getPlan(merchantId), state, this.clock());
    const access = this.credential(state);
    if (!access.accountId) throw new MetaAdsError("meta_account_required", 409);
    if (options.operation && (!state.connection.scopes.includes("ads_management") || !state.connection.capabilities[options.operation])) throw new MetaAdsError("meta_capability_unavailable", 503);
    if (options.destination) {
      if (!access.pageId) throw new MetaAdsError("meta_page_required", 409);
      if (options.destination === "store" && !access.datasetId) throw new MetaAdsError("meta_dataset_required", 409);
      if (options.destination === "whatsapp" && (!access.whatsappId || state.connection.whatsapp?.pageId !== access.pageId || state.connection.whatsapp?.accountId !== access.accountId || !state.connection.capabilities.whatsapp)) throw new MetaAdsError("meta_whatsapp_not_linked", 403);
    }
    return access;
  }

  async select(merchantId: string, input: Selection): Promise<MetaAdsConnection> {
    const plan = await this.commerce.getPlan(merchantId); const snapshot = await this.repo.read(merchantId);
    requireEntitlement(plan, snapshot, this.clock()); const access = this.credential(snapshot);
    const supplied = { accountId: input.accountId, pageId: input.pageId ?? null, catalogId: input.catalogId ?? null, datasetId: input.datasetId ?? null, whatsappId: input.whatsappId ?? null };
    const known: Record<keyof Selection, MetaAdsAsset[]> = { accountId: snapshot.connection.accounts, pageId: snapshot.connection.pages, catalogId: snapshot.connection.catalogs, datasetId: snapshot.connection.datasets, whatsappId: snapshot.connection.whatsappNumbers };
    for (const [key, value] of Object.entries(supplied)) if (value && !known[key as keyof Selection].some(asset => asset.id === value)) throw new MetaAdsError("meta_asset_forbidden", 403);
    if (!supplied.accountId) throw new MetaAdsError("meta_asset_forbidden", 403);
    const selectedAccess = { ...access, ...supplied };
    const discovery = await this.provider.discover(selectedAccess);
    const find = (assets: MetaAdsAsset[], value: string | null) => {
      if (!value) return null;
      const asset = assets.find(candidate => candidate.id === value && (!candidate.accountId || candidate.accountId === supplied.accountId));
      if (!asset) throw new MetaAdsError("meta_asset_forbidden", 403);
      return asset;
    };
    const account = find(discovery.accounts, supplied.accountId); const page = find(discovery.pages, supplied.pageId);
    const catalog = find(discovery.catalogs, supplied.catalogId); const dataset = find(discovery.datasets, supplied.datasetId);
    const whatsapp = find(discovery.whatsappNumbers, supplied.whatsappId);
    if (whatsapp && (whatsapp.pageId !== page?.id || whatsapp.accountId !== account?.id)) throw new MetaAdsError("meta_whatsapp_not_linked", 403);
    return this.repo.mutate(merchantId, [], state => {
      requireEntitlement(plan, state, this.clock());
      if (state.connection.epoch !== snapshot.connection.epoch) throw new MetaAdsError("meta_connection_changed", 409);
      const before = [state.connection.account, state.connection.page, state.connection.catalog, state.connection.dataset, state.connection.whatsapp].map(asset => asset?.id ?? null);
      if (stableDigest(before) !== stableDigest([account, page, catalog, dataset, whatsapp].map(asset => asset?.id ?? null))) { state.connection.epoch++; this.invalidate(state); }
      this.discovered(state, discovery, state.connection.scopes);
      state.connection.clientConversationId = selectedAccess.clientConversationId;
      Object.assign(state.connection, { account, page, catalog, dataset, whatsapp });
      return { result: this.publicView(state) };
    });
  }

  async disconnect(merchantId: string): Promise<MetaAdsConnection> {
    return this.repo.mutate(merchantId, [], state => {
      state.pendingOAuth = null; state.connection = { ...initialStore(merchantId).connection, epoch: state.connection.epoch + 1 };
      this.invalidate(state);
      return { result: this.publicView(state) };
    });
  }
}
