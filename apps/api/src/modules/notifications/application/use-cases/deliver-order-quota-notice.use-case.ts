import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  ORDER_QUOTA_NOTICE_REPOSITORY, ORDER_QUOTA_NOTICE_SENDER, ORDER_QUOTA_NOTICE_VALIDITY,
  type OrderQuotaNoticeRepository, type OrderQuotaNoticeSender, type OrderQuotaNoticeValidity,
  type QuotaDeliveryClaim, type QuotaDeliveryResult,
} from "../../domain/ports/order-quota-notice.port.js";

const RETRY_DELAYS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const MAX_ATTEMPTS = 12;
const SEND_TIMEOUT_MS = 20_000;

@Injectable()
export class DeliverOrderQuotaNoticeUseCase {
  private readonly logger = new Logger(DeliverOrderQuotaNoticeUseCase.name);

  constructor(
    @Inject(ORDER_QUOTA_NOTICE_REPOSITORY) private readonly repository: OrderQuotaNoticeRepository,
    @Inject(ORDER_QUOTA_NOTICE_SENDER) private readonly sender: OrderQuotaNoticeSender,
    @Inject(ORDER_QUOTA_NOTICE_VALIDITY) private readonly validity: OrderQuotaNoticeValidity,
  ) {}

  async execute(batchSize = 20, clock: () => Date = () => new Date()): Promise<number> {
    const unknown = await this.repository.expireSending(clock());
    if (unknown) this.logger.error("order_quota_delivery_expired_sending count=" + unknown);
    let processed = 0;
    while (processed < batchSize) {
      const claim = await this.repository.claimNext(clock());
      if (!claim) break;
      await this.deliver(claim, clock);
      processed++;
    }
    return processed;
  }

  private async deliver(claim: QuotaDeliveryClaim, clock: () => Date): Promise<void> {
    let sending = false;
    let result: QuotaDeliveryResult;
    try {
      if (!await this.validity.isCurrent(claim.notice, clock())) {
        result = { status: "skipped", reason: "stale_notice" };
      } else {
        const prepared = await this.sender.prepare(claim.notice, claim.channel);
        if (!("send" in prepared)) result = prepared;
        else if (!await this.validity.isCurrent(claim.notice, clock())) {
          result = { status: "skipped", reason: "stale_notice" };
        } else {
          if (!await this.repository.beginSending(claim, clock())) return;
          claim.attempts++;
          sending = true;
          result = await boundedSend(prepared.send);
        }
      }
    } catch {
      // Before beginSending there has been no external dispatch. Once sending,
      // an exception cannot prove rejection and must never cause a blind retry.
      result = sending
        ? { status: "unknown", reason: "provider_acceptance_unknown" }
        : { status: "retryable_failed", reason: "preparation_failed" };
    }
    if (result.status === "retryable_failed" && claim.attempts >= MAX_ATTEMPTS) {
      result = { ...result, status: "failed" };
    }
    const now = clock();
    const nextAttemptAt = result.status === "retryable_failed"
      ? new Date(now.getTime() + RETRY_DELAYS[Math.min(Math.max(claim.attempts - 1, 0), RETRY_DELAYS.length - 1)])
      : undefined;
    const saved = await this.repository.finish(claim, result, now, nextAttemptAt);
    if (!saved) this.logger.error("order_quota_delivery_lease_lost id=" + claim.id);
    if (result.status === "unknown" || result.status === "failed" || claim.attempts >= 3) {
      this.logger.error("order_quota_delivery_attention id=" + claim.id + " channel=" + claim.channel
        + " status=" + result.status + " reason=" + (result.reason ?? "none"));
    }
  }
}

async function boundedSend(send: () => Promise<QuotaDeliveryResult>): Promise<QuotaDeliveryResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(send),
      new Promise<QuotaDeliveryResult>((resolve) => {
        timer = setTimeout(() => resolve({ status: "unknown", reason: "provider_timeout" }), SEND_TIMEOUT_MS);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
