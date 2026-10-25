import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaReturnNoticeRepository } from "../../infrastructure/repositories/prisma-return-notice.repository.js";
import { ReturnNoticeSender } from "../../infrastructure/adapters/return-notice.sender.js";
import type { ReturnNoticeResult } from "../../domain/return-notice.js";

@Injectable()
export class ReturnNoticeJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReturnNoticeJob.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopping = false;
  constructor(private readonly repository: PrismaReturnNoticeRepository, private readonly sender: ReturnNoticeSender) {}
  onModuleInit(): void {
    this.timer = setInterval(() => { void this.runOnce(); }, 5_000);
    this.timer.unref();
    void this.runOnce();
  }
  async onModuleDestroy(): Promise<void> { this.stopping = true; if (this.timer) clearInterval(this.timer); await this.running; }
  runOnce(): Promise<void> {
    if (this.stopping || this.running) return this.running ?? Promise.resolve();
    this.running = this.run().catch(() => this.logger.error("return_notice_delivery_failed")).finally(() => { this.running = undefined; });
    return this.running;
  }
  private async run(): Promise<void> {
    await this.repository.expireSending(new Date());
    for (let index = 0; index < 40; index++) {
      const claim = await this.repository.claim(new Date());
      if (!claim || this.stopping) break;
      let result: ReturnNoticeResult;
      let sending = false;
      try {
        if (Date.now() - claim.createdAt.getTime() > 7 * 86400000) result = { status: "skipped", reason: "notice_expired" };
        else {
          const prepared = await this.sender.prepare(claim);
          if (!("send" in prepared)) result = prepared;
          else if (!await this.repository.begin(claim, new Date())) continue;
          else { sending = true; result = await sendReturnNoticeWithDeadline(prepared.send); }
        }
      } catch {
        result = { status: sending ? "unknown" : "retryable_failed", reason: sending ? "provider_acceptance_unknown" : "preparation_failed" };
      }
      if (result.status === "retryable_failed" && claim.attempts >= 12) result = { ...result, status: "failed" };
      const saved = await this.repository.finish(claim, result, new Date());
      if (!saved || result.status === "failed" || result.status === "unknown")
        this.logger.warn(`return_notice_attention id=${claim.id} channel=${claim.channel} status=${result.status}`);
    }
  }
}
export async function sendReturnNoticeWithDeadline(send: () => Promise<ReturnNoticeResult>): Promise<ReturnNoticeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(send), new Promise<ReturnNoticeResult>(resolve => {
      timer = setTimeout(() => resolve({ status: "unknown", reason: "provider_timeout" }), 40_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
