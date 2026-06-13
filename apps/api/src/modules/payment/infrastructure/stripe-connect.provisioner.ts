import { Inject, Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import { isStripeConfigured, readStripeConnection } from "./stripe-env.js";

export type ProvisionStripeConnectInput = {
  merchantId: string;
  merchantName: string;
  email: string;
};

export async function provisionStripeConnectForMerchant(
  merchants: MerchantRepository,
  input: ProvisionStripeConnectInput
): Promise<string | undefined> {
  if (!isStripeConfigured()) return undefined;

  const existing = await merchants.getStripeConnectAccountId(input.merchantId);
  if (existing) return existing;

  const { secretKey } = readStripeConnection();
  if (!secretKey) return undefined;

  const stripe = new Stripe(secretKey, { apiVersion: "2026-04-22.dahlia" });
  const account = await stripe.accounts.create({
    type: "express",
    country: "BR",
    email: input.email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    business_profile: { name: input.merchantName },
    metadata: { merchant_id: input.merchantId }
  });

  await merchants.setStripeConnectAccountId(input.merchantId, account.id);
  return account.id;
}

@Injectable()
export class StripeConnectProvisioner {
  constructor(@Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository) {}

  async provisionForMerchant(input: ProvisionStripeConnectInput): Promise<string | undefined> {
    return provisionStripeConnectForMerchant(this.merchants, input);
  }
}
