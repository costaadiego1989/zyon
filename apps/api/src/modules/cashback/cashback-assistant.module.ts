import { Module } from "@nestjs/common";
import { MerchantAssistantModule, MERCHANT_ASSISTANT_RUNTIME } from "../merchant-assistant/merchant-assistant.module.js";
import type { MerchantAssistantIntegrationPort } from "../merchant-assistant/application/assistant-integration.port.js";
import { CashbackCoreModule } from "./cashback.module.js";
import { CashbackService } from "./application/cashback.service.js";
import { CashbackAssistantContext } from "./application/cashback-assistant.context.js";
import { CashbackQueriesService } from "./application/cashback-queries.service.js";
import { CashbackAssistantReportService } from "./application/cashback-assistant-report.service.js";

@Module({ imports: [CashbackCoreModule, MerchantAssistantModule], providers: [
  { provide: CashbackAssistantReportService, useFactory: (queries: CashbackQueriesService) => new CashbackAssistantReportService(queries), inject: [CashbackQueriesService] },
  { provide: CashbackAssistantContext,
  useFactory: (service: CashbackService, assistant: MerchantAssistantIntegrationPort, reports: CashbackAssistantReportService) => {
    const context = new CashbackAssistantContext({ service, reports, conversations: assistant.repo,
      authorizeActor: scope => assistant.authorizeActor(scope), authorizeTool: (scope, name) => assistant.authorizeTool(scope, name) });
    assistant.contexts.register(context); return context;
  }, inject: [CashbackService, MERCHANT_ASSISTANT_RUNTIME, CashbackAssistantReportService] }], exports: [CashbackAssistantContext] })
export class CashbackAssistantModule {}
