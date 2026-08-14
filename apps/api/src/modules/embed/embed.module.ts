import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { PaymentModule } from "../payment/payment.module.js";
import { EmbedTokenService } from "./domain/embed-token.service.js";
import { IssueEmbedSessionUseCase } from "./application/issue-embed-session.use-case.js";
import { UpdateEmbedCustomerUseCase } from "./application/update-embed-customer.use-case.js";
import { EmbedSessionsController } from "./presentation/http/embed-sessions.controller.js";
import { EmbedSessionIssuerGuard } from "./presentation/http/embed-session-issuer.guard.js";
import { EmbedAuthGuard } from "./presentation/http/embed-auth.guard.js";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./presentation/http/embed-checkout.controller.js";
import { WidgetCatalogController } from "../catalog/presentation/http/widget-catalog.controller.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { InstallationsModule } from "../installations/installations.module.js";

@Module({
  imports: [AuthModule, CheckoutModule, MerchantModule, PaymentModule, IntegrationsModule, CatalogModule, InstallationsModule],
  controllers: [EmbedSessionsController, EmbedCheckoutController, WidgetCatalogController],
  providers: [EmbedTokenService, IssueEmbedSessionUseCase, UpdateEmbedCustomerUseCase, EmbedAuthGuard, EmbedSessionIssuerGuard, EmbedCheckoutGuardHelper],
  exports: [EmbedTokenService, EmbedAuthGuard, EmbedCheckoutGuardHelper]
})
export class EmbedModule {}
