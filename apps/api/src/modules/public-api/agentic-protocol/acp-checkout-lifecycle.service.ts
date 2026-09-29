import { commitCheckoutMutation } from "../../checkout/application/services/commit-checkout-mutation.js";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import {
  CHECKOUT_SESSION_REPOSITORY,
  type CheckoutSessionRepository,
} from "../../checkout/domain/ports/checkout-session.repository.port.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository,
} from "../../merchant/domain/ports/merchant-repository.port.js";
import { GetCheckoutSessionUseCase } from "../../checkout/application/use-cases/get-checkout-session.use-case.js";
import { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import { CreatePaymentIntentUseCase } from "../../payment/application/create-payment-intent.use-case.js";
import type { EmbedTokenClaims } from "../../embed/domain/embed-token.service.js";
import { CheckoutSessionMapper } from "./checkout-session.mapper.js";
import { AcpStatusPolicy } from "./acp-status.policy.js";
import { AcpMutabilityPolicy } from "./acp-mutability.policy.js";
import { AcpCheckoutUpdateService } from "./acp-checkout-update.service.js";
import type { UpdateSessionBody } from "./acp-checkout-patch.js";
export type { UpdateSessionBody } from "./acp-checkout-patch.js";
import {
  AcpPaymentOrchestrator,
  type AcpCompleteBody,
  type AcpPaymentMethodInput,
} from "./acp-payment.orchestrator.js";
import { AcpStoreDomainService } from "./acp-store-domain.service.js";

export type CompleteSessionBody = AcpCompleteBody & {
  payment_method?: AcpPaymentMethodInput;
};

export type CompleteSessionResult = {
  order_id: string;
  status: "completed";
  confirmation_url: string;
  session: ReturnType<typeof CheckoutSessionMapper.toAcp>;
};

@Injectable()
export class AcpCheckoutLifecycleService {
  private readonly statusPolicy: AcpStatusPolicy;
  private readonly mutabilityPolicy: AcpMutabilityPolicy;
  private readonly paymentOrchestrator: AcpPaymentOrchestrator;
  private readonly storeDomain: AcpStoreDomainService;

  constructor(
    private readonly getCheckoutSession: GetCheckoutSessionUseCase,
    private readonly completeOrder: CompleteOrderUseCase,
    private readonly createPaymentIntent: CreatePaymentIntentUseCase,
    @Inject(CHECKOUT_SESSION_REPOSITORY)
    private readonly sessions: CheckoutSessionRepository,
    @Inject(MERCHANT_REPOSITORY)
    private readonly merchants: MerchantRepository,
    private readonly checkoutUpdate: AcpCheckoutUpdateService,
  ) {
    this.statusPolicy = new AcpStatusPolicy(sessions);
    this.mutabilityPolicy = new AcpMutabilityPolicy(this.statusPolicy);
    this.paymentOrchestrator = new AcpPaymentOrchestrator(
      createPaymentIntent,
      completeOrder,
    );
    this.storeDomain = new AcpStoreDomainService();
  }

  async getSession(merchantId: string, sessionId: string) {
    const session = await this.getCheckoutSession.execute(merchantId, sessionId);
    const aacpStatus = await this.statusPolicy.derive(session);
    return CheckoutSessionMapper.toAcp({ session, aacpStatus });
  }

  async updateSession(merchantId: string, sessionId: string, body: UpdateSessionBody) {
    return this.checkoutUpdate.execute(merchantId, sessionId, body);
  }

  async cancelSession(merchantId: string, sessionId: string) {
    const session = await this.getCheckoutSession.execute(merchantId, sessionId);
    await this.mutabilityPolicy.assertMutable(session);

    await commitCheckoutMutation(this.sessions, { expected: session, next: session, cancel: true });

    const refreshed = await this.getCheckoutSession.execute(merchantId, sessionId);
    return CheckoutSessionMapper.toAcp({ session: refreshed, aacpStatus: "canceled" });
  }

  async completeSession(
    merchantId: string,
    sessionId: string,
    claims: EmbedTokenClaims,
    body: CompleteSessionBody,
  ): Promise<CompleteSessionResult> {
    if (!claims.scopes?.includes("payment:intents:confirm")) {
      throw new ForbiddenException({
        code: "token_scope_not_granted",
        missing_scopes: ["payment:intents:confirm"],
      });
    }

    const session = await this.getCheckoutSession.execute(merchantId, sessionId);
    await this.mutabilityPolicy.assertMutable(session);

    if ((session.cart?.items?.length ?? 0) === 0) {
      throw new BadRequestException("acp_cart_empty");
    }
    if (!session.shipping) {
      throw new BadRequestException("acp_shipping_required");
    }

    const { orderId } = await this.paymentOrchestrator.createIntentAndComplete(
      merchantId,
      sessionId,
      session,
      body,
      claims,
    );

    const profile = await this.merchants.getProfile(merchantId);
    const confirmationUrl = this.storeDomain.buildConfirmationUrl(profile, orderId);

    const refreshed = await this.getCheckoutSession.execute(merchantId, sessionId);
    const acpSession = CheckoutSessionMapper.toAcp({
      session: refreshed,
      aacpStatus: "completed",
    });

    return {
      order_id: orderId,
      status: "completed" as const,
      confirmation_url: confirmationUrl,
      session: acpSession,
    };
  }

  async assertMutable(session: CheckoutSession): Promise<void> {
    await this.mutabilityPolicy.assertMutable(session);
  }
}
