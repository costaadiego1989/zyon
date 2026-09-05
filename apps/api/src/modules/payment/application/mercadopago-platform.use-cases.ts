import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../domain/ports/payment-platform-repository.port.js";
import type { PaymentConnectionSnapshot } from "../domain/payment-platform.types.js";
import { paymentConnectReturn, type PaymentConnectReturn } from "./payment-platform/connect/payment-connect-return.js";
import {
  encryptPaymentSecret,
  decryptPaymentSecret,
} from "../infrastructure/payment-secret-cipher.js";
import {
  readMercadoPagoOAuthConfig,
  isMercadoPagoOAuthConfigured,
} from "../infrastructure/mercadopago-oauth-env.js";

const MP_AUTH_URL = "https://auth.mercadopago.com/authorization";
const MP_TOKEN_URL = "https://api.mercadopago.com/oauth/token";
const MP_USER_URL = "https://api.mercadopago.com/users/me";

// ── Helpers ────────────────────────────────────────────────────────────────────

function encryptState(merchantId: string, returnTo: PaymentConnectReturn): string {
  return encryptPaymentSecret(JSON.stringify({ merchantId, returnTo, expiresAt: Date.now() + 15 * 60_000 }));
}

export function readMercadoPagoOAuthState(state: string): { merchantId: string; returnTo: PaymentConnectReturn } {
  try {
    const payload = JSON.parse(decryptPaymentSecret(state));
    if (typeof payload.merchantId !== "string" || payload.merchantId.length < 8 || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) throw new Error("invalid_state");
    return { merchantId: payload.merchantId, returnTo: paymentConnectReturn(payload.returnTo) };
  } catch {
    throw new BadRequestException("mercadopago_oauth_state_invalid");
  }
}

async function requiredConnection(
  repository: PaymentPlatformRepository,
  merchantId: string,
): Promise<PaymentConnectionSnapshot> {
  const connection = await repository.getConnection(merchantId, "mercadopago");
  if (!connection) {
    throw new NotFoundException("mercadopago_connection_not_found");
  }
  return connection;
}

function requiredOAuthConfig() {
  const config = readMercadoPagoOAuthConfig();
  if (!config.appId || !config.clientSecret || !config.redirectUri) {
    throw new ConflictException("mercadopago_oauth_not_configured");
  }
  return config as { appId: string; clientSecret: string; redirectUri: string };
}

// ── Use Cases ──────────────────────────────────────────────────────────────────

@Injectable()
export class CreateMercadoPagoOAuthLinkUseCase {
  private readonly logger = new Logger(CreateMercadoPagoOAuthLinkUseCase.name);

  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  async execute(merchantId: string, returnTo?: PaymentConnectReturn): Promise<{ url: string }> {
    const config = requiredOAuthConfig();

    const state = encryptState(merchantId, paymentConnectReturn(returnTo));
    const params = new URLSearchParams({
      client_id: config.appId,
      response_type: "code",
      platform_id: "mp",
      state,
      redirect_uri: config.redirectUri,
    });

    const url = `${MP_AUTH_URL}?${params.toString()}`;
    this.logger.log(`OAuth link generated for merchant=${merchantId}`);
    return { url };
  }
}

@Injectable()
export class HandleMercadoPagoOAuthCallbackUseCase {
  private readonly logger = new Logger(HandleMercadoPagoOAuthCallbackUseCase.name);

  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  async execute(input: {
    code: string;
    state: string;
  }): Promise<{ merchantId: string; returnTo: PaymentConnectReturn; connection: PaymentConnectionSnapshot }> {
    const config = requiredOAuthConfig();

    const { merchantId, returnTo } = readMercadoPagoOAuthState(input.state);

    // Exchange code for access_token
    const tokenResponse = await fetch(MP_TOKEN_URL, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.appId,
        client_secret: config.clientSecret,
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: config.redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      this.logger.error(
        `Token exchange failed: status=${tokenResponse.status}`,
      );
      throw new BadGatewayException("mercadopago_token_exchange_failed");
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user_id: number;
    };
    if (!tokenData.access_token || !tokenData.refresh_token || !Number.isFinite(tokenData.expires_in) || tokenData.expires_in <= 0 || !Number.isSafeInteger(tokenData.user_id) || tokenData.user_id <= 0) {
      throw new BadGatewayException("mercadopago_token_response_invalid");
    }

    // Store the connection
    const secretPayload = JSON.stringify({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      obtainedAt: new Date().toISOString(),
    });

    await this.repository.saveConnection({
      merchantId,
      provider: "mercadopago",
      environment: "live",
      status: "active",
      externalAccountId: String(tokenData.user_id),
      secret: secretPayload,
      chargesEnabled: true,
      payoutsEnabled: true,
      requirements: [],
      syncedAt: new Date().toISOString(),
    });

    this.logger.log(
      `OAuth callback completed for merchant=${merchantId} user_id=${tokenData.user_id}`,
    );

    const connection = await requiredConnection(this.repository, merchantId);
    return { merchantId, returnTo, connection };
  }
}

@Injectable()
export class SyncMercadoPagoConnectionUseCase {
  private readonly logger = new Logger(SyncMercadoPagoConnectionUseCase.name);

  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  async execute(merchantId: string): Promise<PaymentConnectionSnapshot> {
    const connection = await requiredConnection(this.repository, merchantId);

    const secretRaw = await this.repository.getConnectionSecret(
      merchantId,
      "mercadopago",
    );
    if (!secretRaw) {
      throw new ConflictException("mercadopago_credentials_not_available");
    }

    const credentials = JSON.parse(secretRaw) as {
      accessToken: string;
      refreshToken: string;
    };

    try {
      const userResponse = await fetch(MP_USER_URL, {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
      });

      if (userResponse.status === 401) {
        // Token expired — mark as restricted
        await this.repository.saveConnection({
          merchantId,
          provider: "mercadopago",
          environment: connection.environment,
          status: "restricted",
          externalAccountId: connection.externalAccountId,
          requirements: ["token_refresh_required"],
          syncedAt: new Date().toISOString(),
        });
        return requiredConnection(this.repository, merchantId);
      }

      if (!userResponse.ok) {
        throw new Error(`status_${userResponse.status}`);
      }

      const user = (await userResponse.json()) as {
        id: number;
        status: { site_status: string };
      };

      const isActive =
        user.status?.site_status === "active" || userResponse.ok;

      await this.repository.saveConnection({
        merchantId,
        provider: "mercadopago",
        environment: connection.environment,
        status: isActive ? "active" : "restricted",
        externalAccountId: String(user.id),
        chargesEnabled: isActive,
        payoutsEnabled: isActive,
        requirements: isActive ? [] : ["account_not_active"],
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      await this.repository.saveConnection({
        merchantId,
        provider: "mercadopago",
        environment: connection.environment,
        status: "degraded",
        externalAccountId: connection.externalAccountId,
        errorCode:
          error instanceof Error
            ? error.message.replace(/[^a-z0-9_]+/gi, "_").slice(0, 120)
            : "sync_error",
      });
      throw new BadGatewayException({
        code: "mercadopago_platform_failed",
        detail: "Mercado Pago could not be reached or rejected the request.",
      });
    }

    return requiredConnection(this.repository, merchantId);
  }
}

@Injectable()
export class RefreshMercadoPagoTokenUseCase {
  private readonly logger = new Logger(RefreshMercadoPagoTokenUseCase.name);

  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  async execute(merchantId: string): Promise<PaymentConnectionSnapshot> {
    const config = requiredOAuthConfig();
    const connection = await requiredConnection(this.repository, merchantId);

    const secretRaw = await this.repository.getConnectionSecret(
      merchantId,
      "mercadopago",
    );
    if (!secretRaw) {
      throw new ConflictException("mercadopago_credentials_not_available");
    }

    const credentials = JSON.parse(secretRaw) as {
      accessToken: string;
      refreshToken: string;
    };

    const tokenResponse = await fetch(MP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.appId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
      }),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text().catch(() => "");
      this.logger.error(
        `Token refresh failed: status=${tokenResponse.status} body=${body}`,
      );
      throw new BadGatewayException("mercadopago_token_refresh_failed");
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user_id: number;
    };

    const secretPayload = JSON.stringify({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      obtainedAt: new Date().toISOString(),
    });

    await this.repository.saveConnection({
      merchantId,
      provider: "mercadopago",
      environment: connection.environment,
      status: "active",
      externalAccountId: String(tokenData.user_id),
      secret: secretPayload,
      chargesEnabled: true,
      payoutsEnabled: true,
      requirements: [],
      syncedAt: new Date().toISOString(),
    });

    this.logger.log(`Token refreshed for merchant=${merchantId}`);
    return requiredConnection(this.repository, merchantId);
  }
}

@Injectable()
export class DeleteMercadoPagoConnectionUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  async execute(merchantId: string): Promise<{ success: boolean }> {
    await this.repository.deleteConnection(merchantId, "mercadopago");
    return { success: true };
  }
}
