import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { PaymentModule } from "../payment/payment.module.js";
import { EmbedTokenService } from "./domain/embed-token.service.js";
import { IssueEmbedSessionUseCase } from "./application/issue-embed-session.use-case.js";
import { EmbedSessionsController } from "./presentation/http/embed-sessions.controller.js";
import { EmbedAuthGuard } from "./presentation/http/embed-auth.guard.js";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./presentation/http/embed-checkout.controller.js";

@Module({
  imports: [AuthModule, CheckoutModule, PaymentModule],
  controllers: [EmbedSessionsController, EmbedCheckoutController],
  providers: [EmbedTokenService, IssueEmbedSessionUseCase, EmbedAuthGuard, EmbedCheckoutGuardHelper]
})
export class EmbedModule {}
