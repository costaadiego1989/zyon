import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { AsaasMarketplaceTransferRecoveryAdapter, freezeAsaasMarketplaceWalletReturnRequest,
  validAsaasMarketplaceWalletReturnRequest } from "../infrastructure/asaas-marketplace-transfer-recovery.adapter.js";
import type { AsaasMarketplaceWalletReturnObservation, AsaasMarketplaceWalletReturnRequest } from "../domain/ports/asaas-marketplace-transfer-recovery.port.js";
import { PrismaAsaasMarketplaceWalletReturnRepository, type AsaasWalletReturnActor, type AsaasWalletReturnJournal } from "../infrastructure/repositories/prisma-asaas-marketplace-wallet-return.repository.js";
import { fundingHash } from "../infrastructure/repositories/prisma-marketplace-funding.repository.js";
import { marketplaceCaptureAccount } from "../infrastructure/marketplace-capture-account.js";

type Account = { asaasKey?: string; asaasOrigin?: string };
const cents = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 21_474_836.47 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) throw new ConflictException();
  return Math.round(value * 100);
};

@Injectable()
export class MarketplaceAsaasWalletReturnService {
  constructor(@Inject(PrismaAsaasMarketplaceWalletReturnRepository) private readonly repository: PrismaAsaasMarketplaceWalletReturnRepository,
    private readonly config: { host: Account }, private readonly request: typeof fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly activateRefund?: (hostMerchantId: string, refundPlanId: string) => Promise<unknown>) {}

  async list(actor: AsaasWalletReturnActor, limit = 20, cursor?: string) {
    try {
      const result = await this.repository.listForActor(actor, limit, cursor);
      return { entries: result.entries.map(({ journal, ...entry }) => ({ ...entry, journal: journal ? this.view(journal) : null })),
        next_cursor: result.next_cursor };
    } catch (error) { throw this.publicError(error); }
  }

  async preview(actor: AsaasWalletReturnActor, refundPlanId: string, payoutId: string) {
    try {
      const existing = await this.repository.existing(actor, refundPlanId, payoutId);
      if (existing) return this.view(existing);
      const candidate = await this.repository.candidate(actor, refundPlanId, payoutId);
      return { refund_id: candidate.refund.id, payout_id: candidate.payout.id, amount_cents: candidate.payout.amountCents,
        currency: "BRL" as const, status: "awaiting_consent" as const, can_execute: false };
    } catch (error) { throw this.publicError(error); }
  }

  /** Explicit seller consent, separate from submission. No POST is made. */
  async approve(actor: AsaasWalletReturnActor, refundPlanId: string, payoutId: string, expectedAmountCents: number) {
    try {
      const existing = await this.repository.existing(actor, refundPlanId, payoutId);
      if (existing) { this.expected(existing, expectedAmountCents); return this.view(existing); }
      const candidate = await this.repository.candidate(actor, refundPlanId, payoutId);
      if (candidate.payout.amountCents !== expectedAmountCents) throw new ConflictException();
      const environment = candidate.funding.environment as "test" | "live";
      const sellerKey = await this.repository.sellerConnection(actor.sellerMerchantId, environment, candidate.payout.destination);
      const seller: Account = { asaasKey: sellerKey, asaasOrigin: this.config.host.asaasOrigin };
      const hostAccount = marketplaceCaptureAccount("asaas", environment, this.config.host.asaasKey, this.config.host.asaasOrigin);
      if (hostAccount.accountFingerprint !== candidate.funding.accountFingerprint) throw new ConflictException();
      const sellerAccount = marketplaceCaptureAccount("asaas", environment, seller.asaasKey, seller.asaasOrigin);
      // The collector wallet is read with the ORIGINAL collector key. It is
      // not the host merchant's beneficiary wallet from destinations[].
      const hostWalletId = await this.wallet(this.config.host), sellerWalletId = await this.wallet(seller);
      if (sellerWalletId !== candidate.payout.destination || sellerWalletId === hostWalletId) throw new ConflictException();
      const original = await this.get(this.config.host, `/transfers/${encodeURIComponent(candidate.payout.providerTransferId!)}`);
      if (original.object !== "transfer" || original.id !== candidate.payout.providerTransferId || original.externalReference !== candidate.payout.reference ||
        original.status !== "DONE" || cents(original.value) !== candidate.payout.amountCents ||
        typeof original.dateCreated !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(original.dateCreated) ||
        original.walletId !== undefined && original.walletId !== sellerWalletId) throw new ConflictException();
      const authorizationId = `awra_${fundingHash([candidate.refund.id, candidate.payout.id, actor.sellerMerchantId])}`;
      const frozen = freezeAsaasMarketplaceWalletReturnRequest({ version: 1, kind: "authorized_wallet_return", provider: "asaas", environment,
        paymentMethod: candidate.payment.method as "pix" | "card", currency: "BRL", fundingPlanId: candidate.funding.paymentIntentId,
        refundPlanId: candidate.refund.id, returnId: candidate.refund.returnId, instructionsHash: candidate.funding.instructionsHash,
        allocationHash: candidate.refund.allocationHash,
        host: { merchantId: candidate.funding.hostMerchantId, accountFingerprint: hostAccount.accountFingerprint, walletId: hostWalletId },
        seller: { merchantId: actor.sellerMerchantId, accountFingerprint: sellerAccount.accountFingerprint, walletId: sellerWalletId },
        capture: candidate.budget.capture, originalPayout: { id: candidate.payout.id, providerTransferId: candidate.payout.providerTransferId!,
          reference: candidate.payout.reference, amountCents: candidate.payout.amountCents, dateCreated: original.dateCreated },
        amountCents: candidate.payout.amountCents, authorization: { id: authorizationId, sellerMerchantId: actor.sellerMerchantId,
          actorId: actor.userId, authorizedAt: this.now().toISOString() } });
      return this.view(await this.repository.authorize(actor, frozen, this.config.host.asaasOrigin!));
    } catch (error) { throw this.publicError(error); }
  }

  async execute(actor: AsaasWalletReturnActor, id: string, expectedAmountCents: number, expectedRequestHash: string) {
    try {
      const row = await this.repository.requireForActor(actor, id);
      this.expected(row, expectedAmountCents, expectedRequestHash);
      if (["returned", "failed"].includes(row.status)) return this.view(row);
      if (row.status !== "claimed") return this.observe(actor, id);
      const adapter = await this.adapter(row.request);
      const submitted = await adapter.submit(row.request);
      if (submitted.state === "not_submitted") return { ...this.view(await this.repository.requireForActor(actor, id)), can_execute: false,
        observation: "not_submitted" as const };
      await this.repository.record(id, submitted);
      return this.view(await this.repository.requireForActor(actor, id));
    } catch (error) { throw this.publicError(error); }
  }

  /** Refresh never consumes consent and never issues a seller POST. */
  async observe(actor: AsaasWalletReturnActor, id: string) {
    try {
      const row = await this.repository.requireForActor(actor, id);
      if (row.status === "claimed" || row.status === "failed") return this.view(row);
      const observation = await this.observeJournal(row);
      return { ...this.view(await this.repository.requireForActor(actor, id)), observation: observation.state };
    } catch (error) { throw this.publicError(error); }
  }

  /** Restart workers observe consumed claims and retry host activation after a
   * committed return. Unsubmitted consent never permits the first POST. */
  async recover(limit = 20) {
    const rows = await this.repository.listUnresolved(limit);
    let reconciled = 0, failed = 0;
    for (const row of rows) {
      try { if ((await this.observeJournal(row)).state !== "unknown") reconciled++; } catch { failed++; }
    }
    return { attempted: rows.length, reconciled, failed };
  }

  private async observeJournal(row: AsaasWalletReturnJournal): Promise<AsaasMarketplaceWalletReturnObservation> {
    const observation = await (await this.adapter(row.request)).reconcile(row.request, row.provider_return_transfer_id ?? undefined);
    if (row.status === "returned" && observation.state === "returned" && (!row.proof ||
      observation.amountCents !== row.amount_cents ||
      fundingHash({ ...observation.proof, observedAt: row.proof.observedAt }) !== fundingHash(row.proof))) return { state: "unknown" };
    if (row.status !== "returned") await this.repository.record(row.id, observation);
    if (observation.state === "returned" && this.activateRefund) {
      // Wallet evidence has committed before host activation. The callback must
      // establish the verified host tenant context and retain every financial
      // fence in its own transaction; it does not execute a buyer PSP refund.
      await this.activateRefund(row.host_merchant_id, row.refund_plan_id);
    }
    return observation;
  }

  /** The buyer-refund adapter calls this immediately before its POST. Every
   * stored certificate and live GET receipt must still match. No journal,
   * claim, payout, fee, debt or hold is changed by this verification. */
  async verifyRefundReturns(requests: AsaasMarketplaceWalletReturnRequest[]): Promise<boolean> {
    try {
      if (!Array.isArray(requests) || !requests.length || requests.length > 2000 ||
        new Set(requests.map(row => row.requestHash)).size !== requests.length ||
        new Set(requests.map(row => row.originalPayout.id)).size !== requests.length) return false;
      for (const supplied of requests) {
        const request = structuredClone(supplied);
        if (!validAsaasMarketplaceWalletReturnRequest(request)) return false;
        const certified = await this.repository.certifiedForRequest(request);
        if (!certified) return false;
        const observed = await (await this.adapter(request)).reconcile(request, certified.providerTransferId);
        if (observed.state !== "returned" || observed.amountCents !== certified.amountCents ||
          fundingHash({ ...observed.proof, observedAt: certified.proof.observedAt }) !== fundingHash(certified.proof)) return false;
      }
      return true;
    } catch { return false; }
  }

  private async adapter(request: AsaasMarketplaceWalletReturnRequest) {
    const sellerKey = await this.repository.sellerConnection(request.seller.merchantId, request.environment, request.seller.walletId);
    return new AsaasMarketplaceTransferRecoveryAdapter({ host: this.config.host,
      seller: { asaasKey: sellerKey, asaasOrigin: this.config.host.asaasOrigin } }, this.repository, this.request, this.now);
  }
  private async wallet(account: Account): Promise<string> {
    const response = await this.get(account, "/wallets/");
    const data = response.data as Array<{ id?: unknown; object?: unknown }> | undefined;
    if (response.object !== "list" || response.hasMore !== false || response.totalCount !== 1 || !Array.isArray(data) || data.length !== 1 ||
      data[0].object !== "wallet" || typeof data[0].id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(data[0].id)) throw new ConflictException();
    return data[0].id;
  }
  private async get(account: Account, path: string): Promise<Record<string, unknown>> {
    const response = await this.request(`${new URL(account.asaasOrigin!).origin}/v3${path}`, {
      headers: { access_token: account.asaasKey!, accept: "application/json", "user-agent": "ZyonMarketplace/1.0" },
      redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new ServiceUnavailableException();
    return response.json();
  }
  private expected(row: AsaasWalletReturnJournal, amount: number, requestHash?: string): void {
    if (amount !== row.amount_cents || requestHash !== undefined && requestHash !== row.request_hash) throw new ConflictException();
  }
  private view(row: AsaasWalletReturnJournal) {
    return { id: row.id, refund_id: row.refund_plan_id, payout_id: row.payout_id, amount_cents: row.amount_cents, currency: "BRL" as const,
      request_hash: row.request_hash, status: row.status, can_execute: row.status === "claimed", certificate_hash: row.certificate_hash };
  }
  private publicError(error: unknown): Error {
    if (error instanceof BadRequestException) return new BadRequestException("invalid_marketplace_wallet_return_page");
    if (error instanceof NotFoundException) return new NotFoundException("marketplace_wallet_return_not_found");
    if (error instanceof ConflictException) return new ConflictException("marketplace_wallet_return_unavailable");
    return new ServiceUnavailableException("marketplace_wallet_return_temporarily_unavailable");
  }
}
