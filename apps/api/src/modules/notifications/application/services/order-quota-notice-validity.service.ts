import { Injectable } from "@nestjs/common";
import { OrderQuotaService } from "../../../payment/application/services/order-quota.service.js";
import type { OrderQuotaNotice, OrderQuotaNoticeValidity } from "../../domain/ports/order-quota-notice.port.js";

/** Prevents a delayed transport from sending advice for a superseded episode. */
@Injectable()
export class OrderQuotaNoticeValidityService implements OrderQuotaNoticeValidity {
  constructor(private readonly quotas: OrderQuotaService) {}

  async isCurrent(notice: OrderQuotaNotice, now: Date): Promise<boolean> {
    const snapshot = await this.quotas.getSnapshot(notice.merchantId, now);
    if (snapshot.periodStart !== notice.periodStart.toISOString()) return false;
    const metadata = isRecord(notice.metadata) ? notice.metadata : {};
    const expectedDeadline = typeof metadata.graceExpiresAt === "string" ? metadata.graceExpiresAt : undefined;

    if (notice.milestone === "suspended") return snapshot.state === "suspended";
    if (notice.milestone === "reopened") return snapshot.canAcceptOrders;
    return snapshot.state === "grace"
      && (!expectedDeadline || snapshot.graceExpiresAt === expectedDeadline);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
