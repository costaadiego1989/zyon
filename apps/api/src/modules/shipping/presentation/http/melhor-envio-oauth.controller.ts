import { Controller, Get, Inject, Logger, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

function env(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

@ApiTags("Shipping - Melhor Envio")
@Controller("shipping/melhor-envio")
export class MelhorEnvioOAuthController {
  private readonly logger = new Logger(MelhorEnvioOAuthController.name);
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  @Get("authorize")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Start Melhor Envio OAuth flow" })
  authorize(
    @Req() request: any,
    @Res() res: any
  ) {
    const merchantId = request.user?.merchantId ?? "";
    const scopes = [
      "cart-read",
      "cart-write",
      "companies-read",
      "companies-write",
      "shipping-calculate",
      "shipping-cancel",
      "shipping-checkout",
      "shipping-companies",
      "shipping-generate",
      "shipping-preview",
      "shipping-print",
      "shipping-share",
      "shipping-tracking",
      "ecommerce-shipping",
      "transactions-read",
      "users-read",
      "users-write",
      "webhooks-read",
      "webhooks-write",
    ];

    const params = new URLSearchParams({
      client_id: env("MELHOR_ENVIO_CLIENT_ID"),
      redirect_uri: env("MELHOR_ENVIO_REDIRECT_URI"),
      response_type: "code",
      scope: scopes.join(" "),
      state: this.signState(merchantId),
    });

    const url = `${env("MELHOR_ENVIO_BASE_URL", "https://sandbox.melhorenvio.com.br")}/oauth/authorize?${params.toString()}`;
    res.redirect(302, url);
  }

  @Get("callback")
  @ApiOperation({ summary: "Melhor Envio OAuth callback" })
  async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() res: any
  ) {
    if (!code || !state) {
      res.redirect(302, "/dashboard?error=melhor_envio_denied");
      return;
    }

    const merchantId = this.verifyState(state);
    if (!merchantId) {
      this.logger.warn("melhor_envio.callback.invalid_state", { state });
      res.redirect(302, "/dashboard?error=melhor_envio_csrf");
      return;
    }

    const tokenRes = await fetch(`${env("MELHOR_ENVIO_BASE_URL", "https://sandbox.melhorenvio.com.br")}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: env("MELHOR_ENVIO_CLIENT_ID"),
        client_secret: env("MELHOR_ENVIO_SECRET"),
        redirect_uri: env("MELHOR_ENVIO_REDIRECT_URI"),
        code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      this.logger.error("melhor_envio.token_exchange_failed", { status: tokenRes.status, error: err });
      res.redirect(302, "/dashboard?error=melhor_envio_token_failed");
      return;
    }

    const tokenData = await tokenRes.json();

    // Persist tokens to merchant record
    const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 2592000) * 1000);
    await this.prisma.merchant.update({
      where: { id: merchantId },
      data: {
        melhorEnvioAccessToken: tokenData.access_token,
        melhorEnvioRefreshToken: tokenData.refresh_token,
        melhorEnvioExpiresAt: expiresAt,
      },
    });
    this.logger.log("melhor_envio.connected", { merchantId, expiresAt: expiresAt.toISOString() });

    const dashboardUrl = process.env.DASHBOARD_URL ?? "http://localhost:5175";
    res.redirect(302, `${dashboardUrl}?shipping_connected=melhor_envio`);
  }

  @Get("status")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Check Melhor Envio connection status" })
  async status(@Req() request: any) {
    const merchantId = request.user?.merchantId ?? "";
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { melhorEnvioAccessToken: true, melhorEnvioExpiresAt: true },
    });
    const connected = !!merchant?.melhorEnvioAccessToken;
    const expired = merchant?.melhorEnvioExpiresAt ? new Date(merchant.melhorEnvioExpiresAt) < new Date() : false;
    return { connected, expired, provider: "melhor_envio" };
  }

  private get stateSecret(): string {
    return process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET || "dev-fallback-secret";
  }

  private signState(merchantId: string): string {
    const nonce = randomBytes(16).toString("hex");
    const payload = `${merchantId}:${nonce}`;
    const signature = createHmac("sha256", this.stateSecret).update(payload).digest("hex").slice(0, 16);
    return `${payload}:${signature}`;
  }

  private verifyState(state: string): string | null {
    const parts = state.split(":");
    if (parts.length !== 3) return null;
    const [merchantId, nonce, signature] = parts;
    const expected = createHmac("sha256", this.stateSecret).update(`${merchantId}:${nonce}`).digest("hex").slice(0, 16);
    if (signature !== expected) return null;
    return merchantId;
  }
}
