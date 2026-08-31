import {
  BadGatewayException,
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  BillingSubscriptionSnapshot,
  PaymentConnectionSnapshot,
} from "../../domain/payment-platform.types.js";
import type { PaymentPlatformRepository } from "../../domain/ports/payment-platform-repository.port.js";
import type { BillingTrialJobQueue } from "../../domain/ports/billing-trial-job-queue.port.js";

export async function scheduleTrialExpiration(
  queue: BillingTrialJobQueue | undefined,
  subscription: BillingSubscriptionSnapshot,
): Promise<void> {
  if (subscription.status !== "trialing" || !subscription.trialEndsAt) return;
  if (!queue) {
    if (process.env.BILLING_TRIAL_QUEUE_REQUIRED === "true") {
      throw new ServiceUnavailableException("billing_trial_queue_not_configured");
    }
    Logger.warn("billing_trial_queue_fallback: using persisted trial without expiration worker", "PaymentPlatform");
    return;
  }
  await queue.scheduleTrialExpiration({
    merchantId: subscription.merchantId,
    trialEndsAt: subscription.trialEndsAt,
  });
}

export async function requiredConnection(
  repository: PaymentPlatformRepository,
  merchantId: string,
  provider: "stripe" | "asaas",
): Promise<PaymentConnectionSnapshot> {
  const connection = await repository.getConnection(merchantId, provider);
  if (!connection) {
    throw new NotFoundException(`${provider}_connection_not_found`);
  }
  return connection;
}

export async function requiredAsaasSecret(
  repository: PaymentPlatformRepository,
  merchantId: string,
): Promise<string> {
  const secret = await repository.getConnectionSecret(
    merchantId,
    "asaas",
  );
  if (!secret) throw new ConflictException("asaas_api_key_not_available");
  if (secret.trim().startsWith("{")) {
    const parsed = JSON.parse(secret) as { apiKey?: string };
    if (!parsed.apiKey) throw new ConflictException("asaas_api_key_not_available");
    return parsed.apiKey;
  }
  return secret;
}

export function providerGatewayError(
  provider: "stripe" | "asaas" | "mercadopago",
  error: unknown,
): BadGatewayException {
  return new BadGatewayException({
    code: `${provider}_platform_failed`,
    detail: `${provider} rejected the request or could not be reached.`,
    provider_code: providerErrorCode(error),
  });
}

export function providerErrorCode(error: unknown): string {
  return error instanceof Error
    ? error.message.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 120)
    : "provider_error";
}
