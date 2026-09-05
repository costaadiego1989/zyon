import { Controller, Get, Inject, Logger, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { encryptCommerceSecret } from "../../../commerce/infrastructure/commerce-secret-cipher.js";
import { melhorEnvioBaseUrl, MELHOR_ENVIO_USER_AGENT } from "../../infrastructure/melhor-envio-config.js";

type ReturnTo = "onboarding" | "delivery";

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
    @Res() res: any,
    @Query("return_to") returnTo?: string,
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
    ];

    const params = new URLSearchParams({
      client_id: env("MELHOR_ENVIO_CLIENT_ID"),
      redirect_uri: env("MELHOR_ENVIO_REDIRECT_URI"),
      response_type: "code",
      scope: scopes.join(" "),
      state: this.signState(merchantId, returnTo === "onboarding" ? "onboarding" : "delivery"),
    });

    const url = `${melhorEnvioBaseUrl()}/oauth/authorize?${params.toString()}`;
    res.redirect(302, url);
  }

  @Get("callback")
  @ApiOperation({ summary: "Melhor Envio OAuth callback" })
  async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() res: any
  ) {
    const verified = state ? this.verifyState(state) : null;
    const returnTo = verified?.returnTo ?? "delivery";
    if (!code || !state) {
      res.redirect(302, this.dashboardRedirect(returnTo, "shipping_error", "denied"));
      return;
    }

    if (!verified) {
      this.logger.warn("melhor_envio.callback.invalid_state");
      res.redirect(302, this.dashboardRedirect(returnTo, "shipping_error", "invalid_state"));
      return;
    }

    const { merchantId } = verified;
    try {
      const tokenRes = await fetch(`${melhorEnvioBaseUrl()}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": MELHOR_ENVIO_USER_AGENT },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: env("MELHOR_ENVIO_CLIENT_ID"),
          client_secret: env("MELHOR_ENVIO_SECRET"),
          redirect_uri: env("MELHOR_ENVIO_REDIRECT_URI"),
          code,
        }),
      });

      if (!tokenRes.ok) {
        this.logger.error("melhor_envio.token_exchange_failed", { status: tokenRes.status });
        res.redirect(302, this.dashboardRedirect(returnTo, "shipping_error", "token_failed"));
        return;
      }

      const tokenData = await tokenRes.json();
      if (typeof tokenData.access_token !== "string" || !tokenData.access_token.trim()
        || typeof tokenData.refresh_token !== "string" || !tokenData.refresh_token.trim()) {
        throw new Error("invalid_token_response");
      }

      // Persist tokens to merchant record — encrypt before storing
      const expiresIn = Number(tokenData.expires_in ?? 2592000);
      if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("invalid_token_expiry");
      const expiresAt = new Date(Date.now() + expiresIn * 1000);
      const encryptedAccessToken = encryptCommerceSecret(tokenData.access_token);
      const encryptedRefreshToken = encryptCommerceSecret(tokenData.refresh_token);
      await this.prisma.merchant.update({
        where: { id: merchantId },
        data: {
          melhorEnvioAccessToken: encryptedAccessToken,
          melhorEnvioRefreshToken: encryptedRefreshToken,
          melhorEnvioExpiresAt: expiresAt,
        },
      });
      this.logger.log("melhor_envio.connected", { merchantId, expiresAt: expiresAt.toISOString() });

      res.redirect(302, this.dashboardRedirect(returnTo, "shipping_connected", "melhor_envio"));
    } catch {
      this.logger.error("melhor_envio.connection_failed");
      res.redirect(302, this.dashboardRedirect(returnTo, "shipping_error", "connection_failed"));
    }
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

  private dashboardRedirect(returnTo: ReturnTo, parameter: string, value: string): string {
    const url = new URL(process.env.DASHBOARD_URL || process.env.MERCHANT_CONSOLE_URL || "http://localhost:5175");
    url.searchParams.set(parameter, value);
    url.hash = returnTo;
    return url.toString();
  }

  private signState(merchantId: string, returnTo: ReturnTo): string {
    const nonce = randomBytes(16).toString("hex");
    const payload = `${merchantId}:${nonce}:${returnTo}`;
    const signature = createHmac("sha256", this.stateSecret).update(payload).digest("hex").slice(0, 16);
    return `${payload}:${signature}`;
  }

  private verifyState(state: string): { merchantId: string; returnTo: ReturnTo } | null {
    const parts = state.split(":");
    if (parts.length !== 3 && parts.length !== 4) return null;
    const [merchantId, nonce] = parts;
    const returnTo = parts.length === 4 ? parts[2] : "delivery";
    if (!merchantId || !nonce || (returnTo !== "delivery" && returnTo !== "onboarding")) return null;
    const signature = parts.at(-1)!;
    const expected = createHmac("sha256", this.stateSecret).update(parts.slice(0, -1).join(":")).digest("hex").slice(0, 16);
    if (!/^[a-f0-9]{16}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    return { merchantId, returnTo };
  }
}
