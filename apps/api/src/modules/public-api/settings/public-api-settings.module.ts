import { Module } from '@nestjs/common';
import { CheckoutSettingsModule } from '../../checkout-settings/checkout-settings.module.js';
import { AgentRulesModule } from '../../agent-rules/agent-rules.module.js';
import { SettingsV1Controller } from './presentation/http/settings-v1.controller.js';

/**
 * Public API v1 — Settings Module
 *
 * Consolidates checkout-settings and agent-rules into unified /v1/settings resource.
 *
 * Exports:
 * - GetCheckoutSettingsUseCase, UpdateCheckoutSettingsUseCase
 * - GetAgentRulesUseCase, UpdateAgentRulesUseCase
 * - SettingsV1Controller
 */
@Module({
  imports: [CheckoutSettingsModule, AgentRulesModule],
  controllers: [SettingsV1Controller],
})
export class PublicApiSettingsModule {}
