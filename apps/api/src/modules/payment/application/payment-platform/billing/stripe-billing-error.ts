import { BadGatewayException, ServiceUnavailableException } from "@nestjs/common";

type StripeBillingOperation = "checkout" | "portal";

export function stripeBillingError(error: unknown, operation: StripeBillingOperation = "checkout") {
  const failure = error as { type?: string; code?: string } | null;
  if (failure?.type === "StripeAuthenticationError" || failure?.type === "StripePermissionError") {
    return new ServiceUnavailableException({
      code: "stripe_billing_credentials_invalid",
      detail: "A configuração de assinatura da plataforma precisa ser revisada. Tente novamente em alguns minutos.",
    });
  }
  if (failure?.code === "resource_missing") {
    return new ServiceUnavailableException({
      code: operation === "portal" ? "stripe_billing_portal_unavailable" : "stripe_billing_price_unavailable",
      detail: operation === "portal"
        ? "O gerenciamento da assinatura ainda não está disponível. Tente novamente em alguns minutos."
        : "O plano escolhido ainda não está disponível para assinatura. Tente novamente em alguns minutos.",
    });
  }
  return new BadGatewayException({
    code: "stripe_billing_unavailable",
    detail: "Não foi possível iniciar a assinatura agora. Tente novamente em alguns minutos.",
  });
}
