import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { AsaasWalletReturnActor } from "../infrastructure/repositories/prisma-asaas-marketplace-wallet-return.repository.js";
import { PrismaAsaasMarketplaceResidualWalletReturnRepository, asaasResidualWalletReturnSource,
  type AsaasResidualWalletReturnJournal } from "../infrastructure/repositories/prisma-asaas-marketplace-residual-wallet-return.repository.js";
import { AsaasMarketplaceTransferRecoveryAdapter, freezeAsaasMarketplaceWalletReturnRequest,
  validAsaasMarketplaceWalletReturnRequest } from "../infrastructure/asaas-marketplace-transfer-recovery.adapter.js";
import type { AsaasMarketplaceWalletReturnRequest, AsaasMarketplaceWalletReturnObservation } from "../domain/ports/asaas-marketplace-transfer-recovery.port.js";
import { marketplaceCaptureAccount } from "../infrastructure/marketplace-capture-account.js";
import { fundingHash } from "../infrastructure/repositories/prisma-marketplace-funding.repository.js";

type Account = { asaasKey?: string; asaasOrigin?: string };
@Injectable()
export class MarketplaceAsaasResidualWalletReturnService {
  constructor(private readonly repository: PrismaAsaasMarketplaceResidualWalletReturnRepository,
    private readonly config: { host: Account }, private readonly request: typeof fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly activateRefund?: (hostMerchantId: string, refundPlanId: string) => Promise<unknown>) {}
  async list(actor: AsaasWalletReturnActor, limit = 20, cursor?: string) {
    try {
      const result = await this.repository.listForActor(actor, limit, cursor);
      return { entries: result.entries.map(({ journal, ...entry }) => ({ ...entry, journal: journal ? this.view(journal) : null })), next_cursor: result.next_cursor };
    } catch (error) { throw this.publicError(error); }
  }
  async preview(actor: AsaasWalletReturnActor, refundId: string, residualOperationId: string) {
    try {
      const existing = await this.repository.existing(actor, refundId, residualOperationId);
      if (existing) return this.view(existing);
      const data = await this.repository.candidate(actor, refundId, residualOperationId);
      return { refund_id: refundId, payout_id: data.operation.id, residual_plan_id: data.plan.id, residual_generation: 1 as const,
        source_kind: "residual" as const, amount_cents: data.operation.amountCents, currency: "BRL" as const,
        status: "awaiting_consent" as const, can_execute: false };
    } catch (error) { throw this.publicError(error); }
  }
  /** Explicit seller owner/admin consent is bound to one whole native outbound.
   * The original seller payout is already returned and cannot fund this again. */
  async approve(actor: AsaasWalletReturnActor, refundId: string, residualOperationId: string, amount: number) {
    try {
      const existing = await this.repository.existing(actor, refundId, residualOperationId);
      if (existing) { this.expected(existing, amount); return this.view(existing); }
      const data = await this.repository.candidate(actor, refundId, residualOperationId);
      if (data.operation.amountCents !== amount) throw new ConflictException();
      const environment = data.budget.capture.environment, host = data.basis.asaasFunding.host;
      if (marketplaceCaptureAccount("asaas", environment, this.config.host.asaasKey, this.config.host.asaasOrigin).accountFingerprint !== host.accountFingerprint) throw new ConflictException();
      const seller = await this.repository.sellerConnection(actor.sellerMerchantId, environment, data.sellerAccount.walletId, data.sellerAccount.accountFingerprint);
      const hostWallet = await this.wallet(this.config.host), sellerWallet = await this.wallet(seller);
      if (hostWallet !== host.walletId || sellerWallet !== data.sellerAccount.walletId || sellerWallet === hostWallet) throw new ConflictException();
      const native = await this.get(this.config.host, `/transfers/${encodeURIComponent(data.operation.providerTransferId!)}`);
      if (native.object !== "transfer" || native.id !== data.operation.providerTransferId || native.status !== "DONE" || native.authorized !== true ||
          native.externalReference !== data.operation.reference || typeof native.value !== "number" || Math.round(native.value * 100) !== amount ||
          Math.abs(native.value * 100 - amount) > 0.000001 || typeof native.dateCreated !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(native.dateCreated) ||
          native.walletId !== undefined && native.walletId !== sellerWallet) throw new ConflictException();
      const frozen = freezeAsaasMarketplaceWalletReturnRequest({ version: 2, kind: "authorized_wallet_return", provider: "asaas", environment,
        paymentMethod: data.payment.method as "pix" | "card", currency: "BRL", fundingPlanId: data.funding.paymentIntentId,
        refundPlanId: refundId, returnId: data.refund.returnId, instructionsHash: data.funding.instructionsHash, allocationHash: data.refund.allocationHash,
        host, seller: { merchantId: actor.sellerMerchantId, accountFingerprint: data.sellerAccount.accountFingerprint, walletId: sellerWallet },
        capture: data.budget.capture, originalPayout: { id: data.operation.id, providerTransferId: data.operation.providerTransferId!,
          reference: data.operation.reference, amountCents: amount, dateCreated: native.dateCreated }, residual: asaasResidualWalletReturnSource(data),
        amountCents: amount, authorization: { id: `awresauth_${fundingHash([refundId, residualOperationId, actor.sellerMerchantId])}`,
          sellerMerchantId: actor.sellerMerchantId, actorId: actor.userId, authorizedAt: this.now().toISOString() } });
      return this.view(await this.repository.authorize(actor, frozen));
    } catch (error) { throw this.publicError(error); }
  }
  async execute(actor: AsaasWalletReturnActor, journalId: string, amount: number, requestHash: string) {
    try {
      const row = await this.repository.requireForActor(actor, journalId); this.expected(row, amount, requestHash);
      if (["returned", "failed"].includes(row.status)) return this.view(row);
      if (row.status !== "claimed") return this.observe(actor, journalId);
      const result = await (await this.adapter(row.request)).submit(row.request);
      if (result.state === "not_submitted") return { ...this.view(await this.repository.requireForActor(actor, journalId)), can_execute: false,
        observation: "not_submitted" as const };
      await this.repository.record(journalId, result);
      return this.view(await this.repository.requireForActor(actor, journalId));
    } catch (error) { throw this.publicError(error); }
  }
  async observe(actor: AsaasWalletReturnActor, journalId: string) {
    try {
      const row = await this.repository.requireForActor(actor, journalId);
      if (["claimed", "failed"].includes(row.status)) return this.view(row);
      const observation = await this.observeJournal(row);
      return { ...this.view(await this.repository.requireForActor(actor, journalId)), observation: observation.state };
    } catch (error) { throw this.publicError(error); }
  }
  async recover(limit = 20) {
    const rows = await this.repository.listUnresolved(limit); let reconciled = 0, failed = 0;
    for (const row of rows) { try { if ((await this.observeJournal(row)).state !== "unknown") reconciled++; } catch { failed++; } }
    return { attempted: rows.length, reconciled, failed };
  }
  private async observeJournal(row: AsaasResidualWalletReturnJournal): Promise<AsaasMarketplaceWalletReturnObservation> {
    const observation = await (await this.adapter(row.request)).reconcile(row.request, row.provider_return_transfer_id ?? undefined);
    if (row.status === "returned" && observation.state === "returned" && (!row.proof || observation.amountCents !== row.amount_cents ||
      fundingHash({ ...observation.proof, observedAt: row.proof.observedAt }) !== fundingHash(row.proof))) return { state: "unknown" };
    if (row.status !== "returned") await this.repository.record(row.id, observation);
    if (observation.state === "returned" && this.activateRefund) await this.activateRefund(row.host_merchant_id, row.refund_plan_id);
    return observation;
  }
  async verifyRefundReturns(requests: AsaasMarketplaceWalletReturnRequest[]): Promise<boolean> {
    try {
      if (!Array.isArray(requests) || requests.length !== 1) return false;
      const request = structuredClone(requests[0]);
      if (request.version !== 2 || !validAsaasMarketplaceWalletReturnRequest(request)) return false;
      const stored = await this.repository.certifiedForRequest(request);
      if (!stored) return false;
      const native = await (await this.adapter(request)).reconcile(request, stored.proof.providerTransferId);
      return native.state === "returned" && native.amountCents === request.amountCents &&
        fundingHash({ ...native.proof, observedAt: stored.proof.observedAt }) === fundingHash(stored.proof);
    } catch { return false; }
  }
  private async adapter(request: AsaasMarketplaceWalletReturnRequest) {
    return new AsaasMarketplaceTransferRecoveryAdapter({ host: this.config.host, seller: await this.repository.sellerConnection(
      request.seller.merchantId, request.environment, request.seller.walletId, request.seller.accountFingerprint) }, this.repository, this.request, this.now);
  }
  private async get(account: Account, path: string): Promise<Record<string, unknown>> {
    const response = await this.request(`${new URL(account.asaasOrigin!).origin}/v3${path}`, { headers: {
      access_token: account.asaasKey!, accept: "application/json", "user-agent": "ZyonMarketplace/1.0" }, redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new ServiceUnavailableException(); return response.json();
  }
  private async wallet(account: Account) {
    const result = await this.get(account, "/wallets/"); const data = result.data as Array<{ object?: unknown; id?: unknown }>;
    if (result.object !== "list" || result.hasMore !== false || result.totalCount !== 1 || !Array.isArray(data) || data.length !== 1 ||
        data[0].object !== "wallet" || typeof data[0].id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(data[0].id)) throw new ConflictException();
    return data[0].id;
  }
  private expected(row: AsaasResidualWalletReturnJournal, amount: number, hash?: string) {
    if (amount !== row.amount_cents || hash !== undefined && hash !== row.request_hash) throw new ConflictException();
  }
  private view(row: AsaasResidualWalletReturnJournal) {
    return { id: row.id, refund_id: row.refund_plan_id, payout_id: row.residual_operation_id, residual_plan_id: row.residual_plan_id,
      residual_generation: 1 as const, source_kind: "residual" as const, amount_cents: row.amount_cents, currency: "BRL" as const,
      request_hash: row.request_hash, status: row.status, can_execute: row.status === "claimed", certificate_hash: row.certificate_hash };
  }
  private publicError(error: unknown): Error {
    if (error instanceof BadRequestException) return new BadRequestException("invalid_marketplace_wallet_return_page");
    if (error instanceof NotFoundException) return new NotFoundException("marketplace_wallet_return_not_found");
    if (error instanceof ConflictException) return new ConflictException("marketplace_wallet_return_unavailable");
    return new ServiceUnavailableException("marketplace_wallet_return_temporarily_unavailable");
  }
}
