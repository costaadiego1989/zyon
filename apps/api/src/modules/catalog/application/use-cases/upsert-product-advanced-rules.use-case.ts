import { Inject, Injectable } from "@nestjs/common";
import type { CheckoutSettings } from "@zyon/shared-types";
import type { AdvancedRule } from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";
import {
  CHECKOUT_SETTINGS_REPOSITORY,
  type CheckoutSettingsRepository,
} from "../../../checkout-settings/domain/ports/checkout-settings-repository.port.js";
import { CheckoutSettingsEntity } from "../../../checkout-settings/domain/entities/checkout-settings.entity.js";
import {
  scopeRulesToProduct,
  mergeProductRules,
} from "../../domain/services/product-rule-scoping.service.js";

export interface UpsertProductAdvancedRulesInput {
  merchantId: string;
  productSkus: string[];
  rules: AdvancedRule[];
}

@Injectable()
export class UpsertProductAdvancedRulesUseCase {
  constructor(
    @Inject(CHECKOUT_SETTINGS_REPOSITORY)
    private readonly checkoutSettingsRepo: CheckoutSettingsRepository
  ) {}

  async execute(input: UpsertProductAdvancedRulesInput): Promise<AdvancedRule[]> {
    const { merchantId, productSkus, rules } = input;

    // 1. Auto-scope incoming rules to this product's SKUs.
    const scoped = scopeRulesToProduct(rules, productSkus);

    // 2. Read merchant's current advancedRules (default if absent), merchant-scoped.
    const current: CheckoutSettings =
      (await this.checkoutSettingsRepo.get(merchantId)) ??
      CheckoutSettingsEntity.createDefault({ merchantId }).snapshot();
    const existing = current.advancedRules as unknown as AdvancedRule[];

    // 3. Merge: replace by id, append new, preserve unrelated.
    const merged = mergeProductRules(existing, scoped);

    // 4. Persist merged rules back, scoped to merchant.
    await this.checkoutSettingsRepo.save(
      { ...current, advancedRules: merged as unknown as CheckoutSettings["advancedRules"] },
      current.updatedAt
    );

    // 5. Return merged rules for confirmation.
    return merged;
  }
}
