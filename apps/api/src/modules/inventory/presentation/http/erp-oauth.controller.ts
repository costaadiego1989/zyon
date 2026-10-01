import { Controller, Get, Param, Query, Req, Res, Inject, Logger, UseGuards, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { encryptErpSecret } from "../../infrastructure/adapters/erp-secret-cipher.js";
import { fetchBlingCompanyId } from "../../infrastructure/adapters/bling-company-identity.js";
import { createMarketplaceAdapter, isMarketplaceProvider } from "../../infrastructure/adapters/marketplace-adapter.factory.js";
import { exchangeMarketplaceToken, marketplaceContext } from "../../infrastructure/adapters/marketplace-oauth.js";
import { TriggerMarketplaceSyncUseCase } from "../../application/use-cases/trigger-marketplace-sync.use-case.js";
import { TriggerErpSyncUseCase } from "../../application/use-cases/trigger-erp-sync.use-case.js";

function env(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

function dashboardRedirect(params: Record<string, string>): string {
  const url = new URL(env("DASHBOARD_URL", "http://localhost:5175"));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  // ERP authorization is started from Inventory. Keep the callback on that
  // explicit deep link so an unfinished general onboarding cannot take over
  // the OAuth result page.
  url.hash = "inventory";
  return url.toString();
}

function callbackErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^[a-z0-9_:-]{1,160}$/i.test(message) ? message : "erp_callback_error";
}

function authorizationErrorCode(providerError: string): string {
  switch (providerError.toLowerCase()) {
    case "forbidden":
    case "unauthorized_error":
    case "insufficient_scope": return "erp_permission_denied";
    case "access_denied":
    case "auth_denied": return "erp_denied";
    case "app_inativo": return "erp_app_inactive";
    default: return "erp_authorization_failed";
  }
}

@ApiTags("Inventory - ERP OAuth")
@Controller("inventory/erp/oauth")
export class ErpOAuthController {
  private readonly logger = new Logger(ErpOAuthController.name);
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly marketplaceSync: TriggerMarketplaceSyncUseCase,
    private readonly erpSync: TriggerErpSyncUseCase,
  ) {}

  private async triggerInitialSync(merchantId: string, provider: string, connectionId: string) {
    try {
      await this.marketplaceSync.execute({ merchantId, provider, connectionId });
      this.logger.log("marketplace.initial_sync.queued", { merchantId, provider });
    } catch (err) {
      this.logger.error("marketplace.initial_sync.enqueue_failed", { merchantId, provider, code: callbackErrorCode(err) });
      throw new Error("erp_initial_sync_failed");
    }
  }

  /**
   * GET /inventory/erp/oauth/:provider/authorize
   * Returns { url } pointing to provider's OAuth authorize endpoint.
   */
  @Get(":provider/authorize")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Get ERP OAuth authorize URL" })
  async authorize(@Req() request: any, @Param("provider") provider: string) {
    const merchantId = currentUser(request).merchantId;
    const provider_lower = provider.toLowerCase();
    if (isMarketplaceProvider(provider_lower)) {
      const required = provider_lower === "mercadolivre" ? ["MERCADOLIVRE_APP_ID", "MERCADOLIVRE_CLIENT_SECRET", "MERCADOLIVRE_REDIRECT_URI"]
        : provider_lower === "shopee" ? ["SHOPEE_PARTNER_ID", "SHOPEE_PARTNER_KEY", "SHOPEE_REDIRECT_URI"]
        : ["TIKTOKSHOP_SERVICE_ID", "TIKTOKSHOP_APP_KEY", "TIKTOKSHOP_APP_SECRET", "TIKTOKSHOP_REDIRECT_URI"];
      if (required.some(key => !env(key).trim())) throw new ServiceUnavailableException({ code: "erp_provider_not_configured", message: "erp_provider_not_configured" });
    }
    const state = this.signState(provider_lower, merchantId);

    if (provider_lower === "bling") {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: env("BLING_CLIENT_ID"),
        redirect_uri: env("BLING_REDIRECT_URI"),
        state,
      });
      return {
        url: `https://www.bling.com.br/Api/v3/oauth/authorize?${params.toString()}`,
      };
    }

    if (provider_lower === "tiny") throw new Error("tiny_api_token_required");

    if (provider_lower === "mercadolivre") {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: env("MERCADOLIVRE_APP_ID"),
        redirect_uri: env("MERCADOLIVRE_REDIRECT_URI"),
        state,
      });
      return {
        url: `https://auth.mercadolivre.com.br/authorization?${params.toString()}`,
      };
    }

    if (provider_lower === "shopee") {
      const partnerId = env("SHOPEE_PARTNER_ID");
      const redirectUri = env("SHOPEE_REDIRECT_URI");
      const params = new URLSearchParams({
        partner_id: partnerId,
        auth_type: "seller",
        response_type: "code",
        redirect_uri: redirectUri,
        state,
      });
      return {
        url: `${env("SHOPEE_SANDBOX") === "true" ? "https://open.sandbox.test-stable.shopee.com.br" : "https://open.shopee.com.br"}/auth?${params.toString()}`,
      };
    }

    if (provider_lower === "tiktokshop") {
      const params = new URLSearchParams({
        service_id: env("TIKTOKSHOP_SERVICE_ID"),
        state,
      });
      return {
        url: `https://services.tiktokshop.com/open/authorize?${params.toString()}`,
      };
    }

    throw new Error(`unsupported_erp_provider:${provider_lower}`);
  }

  /**
   * GET /inventory/erp/oauth/callback?code=X&state=Y
   * OAuth callback: exchanges code for token, stores in ErpConnection, redirects to dashboard.
   */
  @Get("callback")
  @ApiOperation({ summary: "ERP OAuth callback" })
  async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() res: any,
    @Query("shop_id") shopId?: string,
    @Query("error") providerError?: string,
    @Query("main_account_id") mainAccountId?: string,
  ) {
    if (!state) {
      res.redirect(302, dashboardRedirect({ error: "erp_denied" }));
      return;
    }

    const { provider, merchantId } = this.verifyState(state);
    if (!provider || !merchantId) {
      this.logger.warn("erp.callback.invalid_state");
      res.redirect(302, dashboardRedirect({ error: "erp_csrf" }));
      return;
    }

    // Providers can reject authorization before issuing a code. Preserve a
    // safe, actionable reason, but only after verifying which flow returned.
    if (typeof providerError === "string" && providerError) {
      const error = authorizationErrorCode(providerError);
      this.logger.warn("erp.authorization.rejected", { provider, merchantId, code: error });
      res.redirect(302, dashboardRedirect({ error, erp_provider: provider }));
      return;
    }
    if (!code || code === "null") {
      res.redirect(302, dashboardRedirect({ error: "erp_denied", erp_provider: provider }));
      return;
    }

    try {
      let tokenData: any;
      let tokenEndpoint = "";
      let clientId = "";
      let clientSecret = "";
      let redirectUri = "";
      let marketplaceConfig: Record<string, string> | undefined;
      let marketplaceExpiresAt: Date | undefined;

      if (provider === "bling") {
        tokenEndpoint = "https://api.bling.com.br/Api/v3/oauth/token";
        clientId = env("BLING_CLIENT_ID");
        clientSecret = env("BLING_CLIENT_SECRET");
        redirectUri = env("BLING_REDIRECT_URI");

        // Bling: Basic auth with client_id:client_secret
        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        const tokenRes = await fetch(tokenEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "enable-jwt": "1",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
          }).toString(),
        });

        if (!tokenRes.ok) {
          this.logger.error("bling.token_exchange_failed", { status: tokenRes.status });
          res.redirect(302, dashboardRedirect({ error: "erp_token_failed" }));
          return;
        }
        tokenData = await tokenRes.json();
      } else if (isMarketplaceProvider(provider)) {
        const exchanged = await exchangeMarketplaceToken(provider, code, shopId, mainAccountId);
        const identity = await createMarketplaceAdapter(provider, exchanged.context)!.getSellerInfo(exchanged.accessToken);
        marketplaceConfig = { ...exchanged.context, sellerId: identity.sellerId, sellerName: identity.name,
          ...(provider !== "mercadolivre" ? { shopId: identity.sellerId } : {}), ...(identity.shopCipher ? { shopCipher: identity.shopCipher } : {}),
        };
        marketplaceExpiresAt = exchanged.expiresAt;
        tokenData = { access_token: exchanged.accessToken, refresh_token: exchanged.refreshToken };
      } else {
        throw new Error("erp_provider_not_supported");
      }

      // Encrypt and store in ErpConnection
      if (typeof tokenData?.access_token !== "string" || !tokenData.access_token) throw new Error("erp_token_failed");
      const accessTokenCipher = encryptErpSecret(tokenData.access_token);
      const refreshTokenCipher = tokenData.refresh_token ? encryptErpSecret(tokenData.refresh_token) : null;
      const expiresAt = marketplaceExpiresAt ?? new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000);

      const blingCompanyId = provider === "bling" ? await fetchBlingCompanyId(tokenData.access_token) : null;
      if (provider === "bling") {
        const existingRoute = await this.prisma.erpWebhookRoute.findUnique({
          where: { provider_externalAccountId: { provider: "bling", externalAccountId: blingCompanyId! } },
        });
        if (existingRoute && existingRoute.merchantId !== merchantId) {
          throw new Error("bling_company_already_connected");
        }
      }
      const connectionData = {
        status: "connected", directionMode: "bidirectional", accessTokenCipher, refreshTokenCipher, tokenExpiresAt: expiresAt, lastErrorCode: null,
        ...(marketplaceConfig ? { config: marketplaceConfig } : blingCompanyId ? { config: { blingCompanyId } } : {}),
      };
      const connection = marketplaceConfig ? await this.prisma.$transaction(async (tx) => {
        // Account/connection locks prevent simultaneous OAuth callbacks from
        // moving another tenant's route or attaching existing mappings elsewhere.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${merchantId}:${provider}`}))::text`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${provider}:${marketplaceConfig!.sellerId}`}))::text`;
        const route = await tx.erpWebhookRoute.findUnique({ where: { provider_externalAccountId: { provider, externalAccountId: marketplaceConfig!.sellerId } } });
        if (route && route.merchantId !== merchantId) throw new Error("erp_marketplace_account_already_connected");
        const existing = await tx.erpConnection.findUnique({ where: { merchantId_provider: { merchantId, provider } } });
        if (existing) {
          const priorSeller = marketplaceContext(existing.config).sellerId;
          // Never reuse old product mappings for a different external account.
          if (priorSeller !== marketplaceConfig!.sellerId && await tx.erpProductMapping.count({ where: { connectionId: existing.id } })) throw new Error("erp_marketplace_account_change_requires_unlink");
        }
        const stored = await tx.erpConnection.upsert({ where: { merchantId_provider: { merchantId, provider } }, update: connectionData, create: { merchantId, provider, ...connectionData } });
        await tx.erpWebhookRoute.deleteMany({ where: { connectionId: stored.id, externalAccountId: { not: marketplaceConfig!.sellerId } } });
        await tx.erpWebhookRoute.upsert({ where: { provider_externalAccountId: { provider, externalAccountId: marketplaceConfig!.sellerId } },
          update: { merchantId, connectionId: stored.id }, create: { provider, externalAccountId: marketplaceConfig!.sellerId, merchantId, connectionId: stored.id },
        });
        return stored;
      }) : await this.prisma.erpConnection.upsert({
        where: { merchantId_provider: { merchantId, provider } },
        update: {
          status: "connected",
          directionMode: "bidirectional",
          accessTokenCipher,
          refreshTokenCipher,
          tokenExpiresAt: expiresAt,
          lastErrorCode: null,
          ...(blingCompanyId ? { config: { blingCompanyId } } : {}),
        },
        create: {
          merchantId,
          provider,
          status: "connected",
          directionMode: "bidirectional",
          accessTokenCipher,
          refreshTokenCipher,
          tokenExpiresAt: expiresAt,
          ...(blingCompanyId ? { config: { blingCompanyId } } : {}),
        },
      });

      this.logger.log("erp.connected", { merchantId, provider, expiresAt: expiresAt.toISOString() });

      if (provider === "bling") {
        await this.prisma.erpWebhookRoute.deleteMany({
          where: { provider: "bling", connectionId: connection.id, externalAccountId: { not: blingCompanyId! } },
        });
        await this.prisma.erpWebhookRoute.upsert({
          where: { provider_externalAccountId: { provider: "bling", externalAccountId: blingCompanyId! } },
          update: { merchantId, connectionId: connection.id },
          create: { provider: "bling", externalAccountId: blingCompanyId!, merchantId, connectionId: connection.id },
        });
      }

      // Await durable enqueue, not an unreliable background import.
      if (isMarketplaceProvider(provider)) {
        await this.triggerInitialSync(merchantId, provider, connection.id);
      } else if (provider === "bling") {
        await this.erpSync.execute(merchantId, connection.id);
      }

      res.redirect(302, dashboardRedirect({ erp_connected: provider, erp_merchant: merchantId }));
    } catch (err) {
      const code = callbackErrorCode(err);
      this.logger.error("erp.callback.error", { provider, merchantId, code });
      const publicCodes = new Set(["erp_token_failed", "erp_provider_not_configured", "erp_shop_selection_required", "erp_marketplace_account_already_connected", "erp_marketplace_account_change_requires_unlink", "erp_marketplace_seller_required", "erp_initial_sync_failed"]);
      res.redirect(302, dashboardRedirect({ error: publicCodes.has(code) ? code : "erp_callback_error", erp_provider: provider }));
    }
  }

  private get stateSecret(): string {
    const secret = process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET;
    if (!secret && process.env.NODE_ENV === "production") throw new Error("erp_state_secret_missing");
    return secret || "dev-fallback-secret";
  }

  private signState(provider: string, merchantId: string): string {
    const nonce = randomBytes(16).toString("hex");
    const payload = `${provider}:${merchantId}:${Date.now()}:${nonce}`;
    const signature = createHmac("sha256", this.stateSecret).update(payload).digest("hex");
    return `${payload}:${signature}`;
  }

  private verifyState(state: string): { provider: string | null; merchantId: string | null } {
    const parts = state.split(":");
    if (parts.length !== 5) return { provider: null, merchantId: null };

    const [provider, merchantId, issuedAt, nonce, signature] = parts;
    const age = Date.now() - Number(issuedAt);
    if (!merchantId || !nonce || !Number.isFinite(age) || age < 0 || age > 30 * 60_000 || !/^[a-f0-9]{64}$/.test(signature)) return { provider: null, merchantId: null };
    const expected = createHmac("sha256", this.stateSecret).update(`${provider}:${merchantId}:${issuedAt}:${nonce}`).digest("hex");
    if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) return { provider: null, merchantId: null };

    return { provider, merchantId };
  }
}
