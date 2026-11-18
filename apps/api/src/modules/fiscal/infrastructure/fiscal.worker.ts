import type { PrismaClient } from "@prisma/client";
import type { FiscalClaimProcessor } from "../domain/fiscal-worker.port.js";
import type { FiscalTenant } from "../domain/fiscal-repository.port.js";
import type { FiscalStockPort } from "../domain/fiscal-stock.port.js";
import { PrismaFiscalRepository } from "./prisma-fiscal.repository.js";

/** No constructor/bootstrap timers or remote side effects. Runtime explicitly schedules runOnce. */
export class FiscalWorker {
  private readonly repository: PrismaFiscalRepository;
  constructor(private readonly prisma: PrismaClient, private readonly issuance: FiscalClaimProcessor, private readonly recovery: FiscalClaimProcessor,
    private readonly stock: FiscalStockPort, private readonly clock: () => Date = () => new Date(), private readonly leaseMs = 120000) { this.repository = new PrismaFiscalRepository(prisma); }
  async runOnce(trustedScope?: FiscalTenant, targetIntentId?: string): Promise<boolean> {
    if (targetIntentId !== undefined && (!trustedScope?.merchantId || !targetIntentId.trim())) throw new Error("fiscal_worker_target_scope_required");
    let scope = trustedScope;
    if (!scope) {
      const row = await this.prisma.fiscalIntent.findFirst({ where: { state: { in: ["queued", "processing", "reconciliation_required", "authorized", "cancelled"] }, nextAttemptAt: { lte: this.clock() }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: this.clock() } }] }, orderBy: { nextAttemptAt: "asc" }, select: { merchantId: true, environment: true } });
      if (!row) return false; scope = row;
    }
    const claim = await this.repository.claim(scope, this.clock(), this.leaseMs, targetIntentId) ?? await this.repository.claimRecovery(scope, this.clock(), this.leaseMs, targetIntentId);
    if (!claim) return false;
    try {
      if (["authorized", "cancelled"].includes(claim.state)) await this.recovery.run(claim);
      else await this.stock.withEffect(scope, claim.id, () => this.issuance.run(claim));
    }
    catch {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM fiscal_intents WHERE id = ${claim.id} AND merchant_id = ${scope!.merchantId} AND environment::text = ${scope!.environment} FOR UPDATE`;
        const current = await tx.fiscalIntent.findFirst({ where: { ...scope, id: claim.id, leaseToken: claim.leaseToken, leaseUntil: { gt: this.clock() } } });
        if (!current) return;
        const state = ["authorized", "cancelled", "suppressed", "not_eligible_before_activation"].includes(current.state) ? current.state : current.writeStartedAt ? "reconciliation_required" : "queued";
        const delay = Math.min(300000, 1000 * 2 ** Math.min(Math.max(current.attempts - 1, 0), 9));
        await tx.fiscalIntent.update({ where: { id: current.id }, data: { state, leaseToken: null, leaseUntil: null, ...(["authorized", "cancelled"].includes(state) ? {} : { version: { increment: 1 } }), nextAttemptAt: new Date(this.clock().getTime() + delay), lastErrorCode: "fiscal_worker_unavailable" } });
        await tx.fiscalEvent.create({ data: { ...scope!, intentId: current.id, actorKind: "worker", action: "worker.retry_scheduled", previousState: current.state, nextState: state, safeReasonCode: "fiscal_worker_unavailable" } });
      });
    }
    return true;
  }
  /** Called by the durable outbox consumer AFTER the evidence transaction commits. */
  async handleStockRelease(trustedMerchantId: string, payload: unknown): Promise<void> {
    const value = payload as { intentId?: string; environment?: "production" | "homologation"; evidenceEventId?: string };
    if (!trustedMerchantId || !value?.intentId || !value.evidenceEventId || !["production", "homologation"].includes(value.environment ?? "")) throw new Error("fiscal_stock_release_request_invalid");
    await this.stock.release({ merchantId: trustedMerchantId, environment: value.environment! }, value.intentId, value.evidenceEventId);
  }
}
