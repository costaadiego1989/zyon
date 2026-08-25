import { Controller, Get, Post, Query, Req, Res, Inject, Logger, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { encryptErpSecret } from "../../infrastructure/adapters/erp-secret-cipher.js";

function env(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

@ApiTags("Inventory - ERP OAuth")
@Controller("inventory/erp/oauth")
export class ErpOAuthController {
  private readonly logger = new Logger(ErpOAuthController.name);
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  /**
   * GET /inventory/erp/oauth/:provider/authorize
   * Returns { url } pointing to provider's OAuth authorize endpoint.
   */
  @Get(":provider/authorize")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Get ERP OAuth authorize URL" })
  async authorize(@Req() request: any, @Query("provider") provider: string) {
    const merchantId = currentUser(request).merchantId;
    const provider_lower = provider.toLowerCase();
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

    if (provider_lower === "tiny") {
      const params = new URLSearchParams({
        client_id: env("TINY_CLIENT_ID"),
        redirect_uri: env("TINY_REDIRECT_URI"),
        response_type: "code",
        scope: "openid",
        state,
      });
      return {
        url: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth?${params.toString()}`,
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
    @Res() res: any
  ) {
    if (!code || !state) {
      res.redirect(302, "/dashboard?error=erp_denied");
      return;
    }

    const { provider, merchantId } = this.verifyState(state);
    if (!provider || !merchantId) {
      this.logger.warn("erp.callback.invalid_state", { state });
      res.redirect(302, "/dashboard?error=erp_csrf");
      return;
    }

    try {
      let tokenData: any;
      let tokenEndpoint = "";
      let clientId = "";
      let clientSecret = "";
      let redirectUri = "";

      if (provider === "bling") {
        tokenEndpoint = "https://www.bling.com.br/Api/v3/oauth/token";
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
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
          }).toString(),
        });

        if (!tokenRes.ok) {
          const err = await tokenRes.text();
          this.logger.error("bling.token_exchange_failed", { status: tokenRes.status, error: err });
          res.redirect(302, "/dashboard?error=erp_token_failed");
          return;
        }
        tokenData = await tokenRes.json();
      } else if (provider === "tiny") {
        tokenEndpoint = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";
        clientId = env("TINY_CLIENT_ID");
        clientSecret = env("TINY_CLIENT_SECRET");
        redirectUri = env("TINY_REDIRECT_URI");

        // Tiny: Standard OAuth2 token exchange (no Basic auth)
        const tokenRes = await fetch(tokenEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
          }).toString(),
        });

        if (!tokenRes.ok) {
          const err = await tokenRes.text();
          this.logger.error("tiny.token_exchange_failed", { status: tokenRes.status, error: err });
          res.redirect(302, "/dashboard?error=erp_token_failed");
          return;
        }
        tokenData = await tokenRes.json();
      }

      // Encrypt and store in ErpConnection
      const accessTokenCipher = encryptErpSecret(tokenData.access_token);
      const refreshTokenCipher = tokenData.refresh_token ? encryptErpSecret(tokenData.refresh_token) : null;
      const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000);

      await this.prisma.erpConnection.upsert({
        where: { merchantId_provider: { merchantId, provider } },
        update: {
          status: "connected",
          accessTokenCipher,
          refreshTokenCipher,
          tokenExpiresAt: expiresAt,
          lastErrorCode: null,
        },
        create: {
          merchantId,
          provider,
          status: "connected",
          accessTokenCipher,
          refreshTokenCipher,
          tokenExpiresAt: expiresAt,
        },
      });

      this.logger.log("erp.connected", { merchantId, provider, expiresAt: expiresAt.toISOString() });

      const dashboardUrl = process.env.DASHBOARD_URL ?? "http://localhost:5175";
      res.redirect(302, `${dashboardUrl}?erp_connected=${provider}`);
    } catch (err) {
      this.logger.error("erp.callback.error", err);
      res.redirect(302, "/dashboard?error=erp_callback_error");
    }
  }

  private get stateSecret(): string {
    return process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET || "dev-fallback-secret";
  }

  private signState(provider: string, merchantId: string): string {
    const nonce = randomBytes(16).toString("hex");
    const payload = `${provider}:${merchantId}:${nonce}`;
    const signature = createHmac("sha256", this.stateSecret).update(payload).digest("hex").slice(0, 16);
    return `${payload}:${signature}`;
  }

  private verifyState(state: string): { provider: string | null; merchantId: string | null } {
    const parts = state.split(":");
    if (parts.length !== 4) return { provider: null, merchantId: null };

    const [provider, merchantId, nonce, signature] = parts;
    const expected = createHmac("sha256", this.stateSecret).update(`${provider}:${merchantId}:${nonce}`).digest("hex").slice(0, 16);
    if (signature !== expected) return { provider: null, merchantId: null };

    return { provider, merchantId };
  }
}
