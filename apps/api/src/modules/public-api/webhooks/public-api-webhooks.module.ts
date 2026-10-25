import { Module } from "@nestjs/common";
import { IntegrationsModule } from "../../integrations/integrations.module.js";
import { WebhooksV1Controller } from "./presentation/http/webhooks-v1.controller.js";

/**
 * Public API v1 — Webhooks submodule.
 *
 * Thin presentation layer that delegates to existing IntegrationsModule use-cases.
 * No business logic here — only HTTP -> use-case -> DTO mapping.
 */
@Module({
  imports: [IntegrationsModule],
  controllers: [WebhooksV1Controller],
})
export class PublicApiWebhooksModule {}
