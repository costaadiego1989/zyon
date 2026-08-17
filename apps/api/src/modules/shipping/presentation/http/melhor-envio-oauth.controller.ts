import { Controller, Get, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";

const ME_BASE_URL = process.env.MELHOR_ENVIO_BASE_URL ?? "https://sandbox.melhorenvio.com.br";
const ME_CLIENT_ID = process.env.MELHOR_ENVIO_CLIENT_ID ?? "";
const ME_SECRET = process.env.MELHOR_ENVIO_SECRET ?? "";
const ME_REDIRECT_URI = process.env.MELHOR_ENVIO_REDIRECT_URI ?? "";

@ApiTags("Shipping - Melhor Envio")
@Controller("shipping/melhor-envio")
export class MelhorEnvioOAuthController {
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
      client_id: ME_CLIENT_ID,
      redirect_uri: ME_REDIRECT_URI,
      response_type: "code",
      scope: scopes.join(" "),
      state: merchantId,
    });

    const url = `${ME_BASE_URL}/oauth/authorize?${params.toString()}`;
    res.redirect(302, url);
  }

  @Get("callback")
  @ApiOperation({ summary: "Melhor Envio OAuth callback" })
  async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() res: any
  ) {
    if (!code) {
      res.redirect(302, "/dashboard?error=melhor_envio_denied");
      return;
    }

    const merchantId = state;

    const tokenRes = await fetch(`${ME_BASE_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: ME_CLIENT_ID,
        client_secret: ME_SECRET,
        redirect_uri: ME_REDIRECT_URI,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("[MelhorEnvio] Token exchange failed:", tokenRes.status, err);
      res.redirect(302, "/dashboard?error=melhor_envio_token_failed");
      return;
    }

    const tokenData = await tokenRes.json();

    // TODO: Save tokens to merchant record in DB (Prisma)
    console.log(`[MelhorEnvio] Connected merchant ${merchantId}:`, {
      access_token: tokenData.access_token?.substring(0, 20) + "...",
      refresh_token: tokenData.refresh_token?.substring(0, 20) + "...",
      expires_in: tokenData.expires_in,
    });

    const dashboardUrl = process.env.DASHBOARD_URL ?? "http://localhost:5175";
    res.redirect(302, `${dashboardUrl}?shipping_connected=melhor_envio`);
  }

  @Get("status")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Check Melhor Envio connection status" })
  async status(@Req() request: any) {
    const merchantId = request.user?.merchantId ?? "";
    // TODO: Check DB for saved tokens
    return { connected: false, provider: "melhor_envio", merchantId };
  }
}
