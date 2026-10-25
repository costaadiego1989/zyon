import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiKeyAccessPolicy } from "../domain/api-key-access-policy.js";
import { ApiKeyService } from "../domain/api-key.service.js";
import type { MerchantApiKeyContext } from "../domain/integrations.types.js";
import {
  INTEGRATIONS_REPOSITORY,
  type IntegrationsRepository,
} from "../domain/ports/integrations.repository.port.js";
import { BillingPlanMeteringService } from "../../payment/domain/billing-plan-guard.js";
import { BILLING_PLANS } from "../../payment/domain/billing-plans.js";

@Injectable()
export class AuthenticateMerchantApiKeyService {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY)
    private readonly repository: IntegrationsRepository,
    private readonly apiKeys: ApiKeyService,
    private readonly accessPolicy: ApiKeyAccessPolicy,
    @Optional() private readonly billingMetering?: BillingPlanMeteringService,
  ) {}

  async execute(rawKey: string, clientIp?: string): Promise<MerchantApiKeyContext> {
    const keyEnvironment = this.apiKeys.environment(rawKey);
    if (!keyEnvironment) {
      throw new UnauthorizedException("invalid_api_key");
    }

    const now = new Date().toISOString();
    const apiKey = await this.repository.findActiveApiKeyByHash(
      this.apiKeys.hash(rawKey),
      now,
    );
    if (!apiKey) {
      throw new UnauthorizedException("invalid_api_key");
    }
    if (keyEnvironment !== "legacy" && keyEnvironment !== apiKey.environment) {
      throw new UnauthorizedException("invalid_api_key_environment");
    }

    this.accessPolicy.assertClientIpAllowed(apiKey.allowedCidrs, clientIp);

    // Feature gate: REST v1 pública exige plano Growth+ (publicApiV1). Starter
    // (Free) usa só widget/embed. Bloqueia uso de API key sem o plano.
    if (this.billingMetering) {
      const plan = await this.billingMetering.getEffectivePlan(apiKey.merchantId);
      if (!BILLING_PLANS[plan].features.publicApiV1) {
        throw new ForbiddenException({
          code: "plan_feature_unavailable",
          feature: "publicApiV1",
          plan,
          required_plan: "growth",
        });
      }
    }

    await this.repository.touchApiKeyLastUsed(apiKey.id, now);

    return {
      id: apiKey.id,
      merchantId: apiKey.merchantId,
      scopes: apiKey.scopes,
      environment: apiKey.environment,
      allowedCidrs: apiKey.allowedCidrs,
      expiresAt: apiKey.expiresAt,
    };
  }
}
