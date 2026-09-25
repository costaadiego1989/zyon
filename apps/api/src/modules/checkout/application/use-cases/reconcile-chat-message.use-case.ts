import { Injectable } from "@nestjs/common";
import type { ChatMessageReference } from "@zyon/shared-types";
import { CheckoutChatRequestService } from "../../infrastructure/prisma/checkout-chat-request.service.js";

/** Tenant/session authorization belongs to the transport. This use case only
 * reconciles durable text evidence; it has no provider or commercial ports. */
@Injectable()
export class ReconcileChatMessageUseCase {
  constructor(private readonly requests: CheckoutChatRequestService) {}
  execute(input: ChatMessageReference) { return this.requests.reconcile(input); }
  readState(merchantId: string, sessionId: string, messageId?: string) {
    return this.requests.readState(merchantId, sessionId, messageId);
  }
}
