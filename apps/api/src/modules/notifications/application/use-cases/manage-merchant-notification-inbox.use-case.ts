import { Inject, Injectable } from "@nestjs/common";
import { MERCHANT_NOTIFICATION_INBOX_PORT, type MerchantNotificationInboxPort } from "../../domain/ports/merchant-notification-inbox.port.js";

@Injectable()
export class ManageMerchantNotificationInboxUseCase {
  constructor(@Inject(MERCHANT_NOTIFICATION_INBOX_PORT) private readonly inbox: MerchantNotificationInboxPort) {}

  list(merchantId: string, since?: string) {
    const parsedSince = since ? new Date(since) : undefined;
    return this.inbox.list(merchantId, parsedSince && !Number.isNaN(parsedSince.getTime()) ? parsedSince : undefined);
  }

  markRead(merchantId: string, notificationId: string) { return this.inbox.markRead(merchantId, notificationId); }
  markAllRead(merchantId: string) { return this.inbox.markAllRead(merchantId); }
}
