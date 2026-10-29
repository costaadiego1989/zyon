import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaPlanNoticeRepository } from "../../infrastructure/repositories/prisma-plan-notice.repository.js";
import { PlanNoticeSender } from "../../infrastructure/adapters/plan-notice.sender.js";
import type { QuotaDeliveryResult } from "../../domain/ports/order-quota-notice.port.js";

@Injectable()
export class PlanNoticeJob implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private lastScan = 0;
  private readonly logger = new Logger(PlanNoticeJob.name);
  constructor(private readonly repo: PrismaPlanNoticeRepository, private readonly sender: PlanNoticeSender) {}
  onModuleInit() { void this.run(); this.timer = setInterval(() => void this.run(), 60_000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async run(clock: () => Date = () => new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      if (clock().getTime() - this.lastScan >= 5 * 60_000) {
        try {
          const scanned = await this.repo.scan(clock()); this.lastScan = clock().getTime();
          this.logger.log(`plan_notice_scan subscriptions=${scanned}`);
        } catch { this.logger.error("plan_notice_scan_failed"); }
      }
      const unknown = await this.repo.expireSending(clock());
      if (unknown) this.logger.error(`plan_notice_unknown_after_restart count=${unknown}`);
      for (let i = 0; i < 40; i++) {
        const claim = await this.repo.claim(clock());
        if (!claim) break;
        let result: QuotaDeliveryResult;
        let sending = false;
        try {
          if (!await this.repo.current(claim.notice, clock())) result = { status: "skipped", reason: "renewed_or_stale_notice" };
          else {
            const prepared = await this.sender.prepare(claim.notice, claim.channel);
            if (!("send" in prepared)) result = prepared;
            else if (!await this.repo.current(claim.notice, clock())) result = { status: "skipped", reason: "renewed_or_stale_notice" };
            else {
              if (!await this.repo.begin(claim, clock())) continue;
              sending = true;
              result = await sendWithDeadline(prepared.send);
            }
          }
        } catch { result = { status: sending ? "unknown" : "retryable_failed", reason: sending ? "provider_acceptance_unknown" : "preparation_failed" }; }
        if (result.status === "retryable_failed" && claim.attempts >= 12) result = { ...result, status: "failed" };
        const saved = await this.repo.finish(claim, result, clock());
        if (!saved || ["failed", "unknown"].includes(result.status) || claim.attempts >= 3) {
          this.logger.error(`plan_notice_attention id=${claim.id} channel=${claim.channel} status=${result.status} reason=${result.reason ?? "lease_lost"}`);
        }
      }
    } catch { this.logger.error("plan_notice_delivery_failed"); }
    finally { this.running = false; }
  }
}
async function sendWithDeadline(send: () => Promise<QuotaDeliveryResult>): Promise<QuotaDeliveryResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(send), new Promise<QuotaDeliveryResult>(resolve => {
      timer = setTimeout(() => resolve({ status: "unknown", reason: "provider_timeout" }), 40_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
