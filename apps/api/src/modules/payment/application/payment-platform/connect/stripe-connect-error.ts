import { BadGatewayException, ConflictException, ServiceUnavailableException } from "@nestjs/common";

export function stripeConnectError(error: unknown) {
  const failure = error as { type?: string; code?: string; message?: string } | null;
  if (/only create new accounts if.*signed up for Connect/i.test(failure?.message ?? "")) {
    return new ServiceUnavailableException({
      code: "stripe_connect_not_enabled",
      detail: "A conexão Stripe ainda não foi habilitada pela plataforma. Entre em contato com o suporte da Zyon.",
    });
  }
  if (failure?.type === "StripeAuthenticationError" || failure?.type === "StripePermissionError") {
    return new ServiceUnavailableException({ code: "stripe_connect_credentials_invalid", detail: "A configuração Stripe da plataforma precisa ser revisada pelo suporte da Zyon." });
  }
  if (failure?.code === "resource_missing") {
    return new ConflictException({ code: "stripe_connect_account_unavailable", detail: "A conta Stripe vinculada não está disponível. Entre em contato com o suporte da Zyon." });
  }
  return new BadGatewayException({ code: "stripe_connect_unavailable", detail: "Não foi possível iniciar a conexão Stripe. Tente novamente em alguns minutos." });
}
