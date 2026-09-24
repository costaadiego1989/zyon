import { BadGatewayException, ConflictException, Logger, ServiceUnavailableException } from "@nestjs/common";

type StripeFailure = {
  type?: unknown;
  rawType?: unknown;
  code?: unknown;
  param?: unknown;
  statusCode?: unknown;
  requestId?: unknown;
  message?: unknown;
  raw?: {
    type?: unknown;
    code?: unknown;
    param?: unknown;
    requestId?: unknown;
    message?: unknown;
  };
};

const logger = new Logger("StripeConnect");

/**
 * Converts a Stripe SDK error into a stable, non-sensitive API problem.
 *
 * Stripe's text changes over time, so the API response must not depend on it.
 * We retain only the provider's diagnostic identifiers in server logs; the raw
 * provider message can contain submitted account data and must never reach a
 * merchant response or the application log.
 */
export function stripeConnectError(
  error: unknown,
  operation: "account_creation" | "onboarding_link" = "account_creation",
) {
  const failure = asStripeFailure(error);
  const provider = providerDiagnostic(failure);
  logger.warn({ event: "stripe_connect_provider_error", operation, ...provider });

  const message = readString(failure.message) ?? readString(failure.raw?.message) ?? "";
  const type = readString(failure.type) ?? readString(failure.rawType) ?? readString(failure.raw?.type);
  const code = readString(failure.code) ?? readString(failure.raw?.code);

  if (isConnectRegistrationError(message)) {
    return new ServiceUnavailableException({
      code: "stripe_connect_not_enabled",
      detail: "A conexão Stripe ainda não foi habilitada pela plataforma. Entre em contato com o suporte da Zyon.",
    });
  }

  if (type === "StripeAuthenticationError" || type === "StripePermissionError") {
    return new ServiceUnavailableException({
      code: "stripe_connect_credentials_invalid",
      detail: "A configuração Stripe da plataforma precisa ser revisada pelo suporte da Zyon.",
    });
  }

  if (code === "resource_missing") {
    return new ConflictException({
      code: "stripe_connect_account_unavailable",
      detail: "A conta Stripe vinculada não está disponível. Entre em contato com o suporte da Zyon.",
    });
  }

  if (type === "StripeInvalidRequestError" || type === "invalid_request_error") {
    return new ServiceUnavailableException({
      code: "stripe_connect_configuration_invalid",
      detail: "A configuração da conexão Stripe precisa ser revisada pelo suporte da Zyon.",
    });
  }

  if (type === "StripeRateLimitError" || type === "rate_limit_error") {
    return new ServiceUnavailableException({
      code: "stripe_connect_rate_limited",
      detail: "A Stripe limitou temporariamente novas conexões. Tente novamente em alguns minutos.",
    });
  }

  return new BadGatewayException({
    code: "stripe_connect_unavailable",
    detail: "Não foi possível iniciar a conexão Stripe. Tente novamente em alguns minutos.",
  });
}

function isConnectRegistrationError(message: string): boolean {
  return /(?:signed up|register(?:ed)?)\s+(?:your\s+)?(?:platform\s+)?(?:for|with)?\s*Connect|Connect\s+(?:must|needs? to be)\s+(?:enabled|registered)/i.test(message);
}

function asStripeFailure(error: unknown): StripeFailure {
  return error && typeof error === "object" ? error as StripeFailure : {};
}

function providerDiagnostic(failure: StripeFailure): Record<string, string | number | null> {
  return {
    provider_type: readString(failure.type) ?? readString(failure.rawType) ?? readString(failure.raw?.type) ?? null,
    provider_code: readString(failure.code) ?? readString(failure.raw?.code) ?? null,
    provider_param: readString(failure.param) ?? readString(failure.raw?.param) ?? null,
    provider_status: readStatus(failure.statusCode),
    provider_request_id: readString(failure.requestId) ?? readString(failure.raw?.requestId) ?? null,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
