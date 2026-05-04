import { Inject, Injectable } from "@nestjs/common";
import type { MerchantNegotiationPolicy } from "@aacp/negotiation-engine";
import { DEFAULT_MERCHANT_NEGOTIATION_POLICY } from "../domain/negotiation-defaults.js";
import { assertValidMerchantNegotiationPolicy } from "../domain/merchant-negotiation-policy.entity.js";
import { NEGOTIATION_STORE, type NegotiationStore } from "../domain/ports/negotiation-store.port.js";

@Injectable()
export class GetMerchantNegotiationPolicyUseCase {
  constructor(@Inject(NEGOTIATION_STORE) private readonly store: NegotiationStore) {}

  async executeResolved(merchantId: string): Promise<MerchantNegotiationPolicy> {
    const row = await this.store.getMerchantPolicy(merchantId);
    return row ?? DEFAULT_MERCHANT_NEGOTIATION_POLICY;
  }

  /** Raw persistido ou null quando ainda não guardado — útil para o dashboard saber estado. */
  async executeStored(merchantId: string): Promise<{ stored: MerchantNegotiationPolicy | null }> {
    const row = await this.store.getMerchantPolicy(merchantId);
    return { stored: row ?? null };
  }
}

@Injectable()
export class UpsertMerchantNegotiationPolicyUseCase {
  constructor(@Inject(NEGOTIATION_STORE) private readonly store: NegotiationStore) {}

  async execute(input: {
    merchantId: string;
    policy: MerchantNegotiationPolicy;
  }): Promise<MerchantNegotiationPolicy> {
    assertValidMerchantNegotiationPolicy(input.policy);
    await this.store.upsertMerchantPolicy(input.merchantId, input.policy);
    return input.policy;
  }
}
