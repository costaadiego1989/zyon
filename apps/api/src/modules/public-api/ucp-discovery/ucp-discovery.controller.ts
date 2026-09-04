import { Controller, Get, Header, Inject, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PublicRoute } from "../../../shared/tenant/tenant.guard.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository,
} from "../../merchant/domain/ports/merchant-repository.port.js";
import { resolveStoreDomain } from "../agentic-protocol/acp-store-domain.service.js";
import {
  readResolverConfig,
  resolveMerchantFromHost,
  type ResolvedMerchant,
} from "./merchant-resolver.js";
import { UcpDiscoveryDto } from "./ucp-discovery.dtos.js";

@ApiTags("Agentic Protocol - Discovery")
@Controller("")
export class UcpDiscoveryController {
  constructor(
    @Inject(MERCHANT_REPOSITORY)
    private readonly merchants: MerchantRepository,
  ) {}

  /**
   * GET /.well-known/ucp
   *
   * Publishes merchant-specific Unified Commerce Platform (UCP) /
   * Agentic Commerce Platform (ACP) discovery metadata. Public — no
   * authentication required.
   *
   * Multi-tenant: the response is resolved from the request's `Host`
   * header. Subdomain pattern (`{slug}.zyon-payments.com.br`) and
   * registered custom domains resolve to the matching merchant. The
   * platform API host (and any unknown host) returns the platform-level
   * document with `merchant_id = "platform-default"` (kept for backward
   * compat).
   *
   * Response is idempotent and cacheable for 1 hour
   * (`Cache-Control: public, max-age=3600`).
   */
  @Get(".well-known/ucp")
  @Header("Cache-Control", "public, max-age=3600")
  @PublicRoute()
  @ApiOperation({
    summary: "UCP/ACP discovery metadata",
    description:
      "Returns Unified Commerce Platform (UCP) / Agentic Commerce Platform (ACP) " +
      "discovery metadata describing the merchant resolved from the request's host header. " +
      "Subdomain pattern (`{slug}.{base}`) and registered custom domains are supported. " +
      "Public endpoint — no authentication required. Cacheable (recommended: 1h TTL).",
  })
  @ApiResponse({
    status: 200,
    description: "Discovery metadata published",
    type: UcpDiscoveryDto,
  })
  async discovery(@Req() req: { headers: Record<string, string | string[] | undefined> }): Promise<UcpDiscoveryDto> {
    const host = readHostHeader(req.headers);
    const storeDomain = resolveStoreDomain();
    const config = readResolverConfig(process.env, storeDomain);
    const resolved: ResolvedMerchant = await resolveMerchantFromHost(
      host,
      this.merchants,
      config,
      storeDomain,
    );

    const isPlatform = resolved.kind === "platform";
    const merchantId = resolved.merchantId;
    const merchantSlug = isPlatform ? "platform-default" : resolved.slug;
    const merchantName = isPlatform ? "AACP" : resolved.merchantName;
    const merchantUrl = isPlatform
      ? `https://${storeDomain}`
      : resolved.merchantUrl;

    let logoUrl: string | undefined;
    let supportEmail: string | undefined;
    let currencies: string[] | undefined;
    if (!isPlatform) {
      const profile = await this.merchants.getStoreSettings(merchantId).catch(() => ({} as any));
      logoUrl = profile?.styles?.logoUrl;
      supportEmail = profile?.company?.email;
    }

    return {
      version: "1.0",
      name: "AACP",
      merchant_id: merchantId,
      merchant_name: merchantName,
      merchant_url: merchantUrl,
      robots_txt_url: "/robots.txt",
      capabilities: ["checkout", "product_discovery", "payment"],
      supported_protocols: ["acp", "ucp", "ap2"],
      checkout_sessions_endpoint: "/v1/acp/checkout_sessions",
      feed_endpoint: "/v1/acp/products/feed",
      webhook_endpoint: "/v1/acp/webhooks",
      logo_url: logoUrl,
      support_email: supportEmail,
      currencies,
      created_at: new Date().toISOString(),
    };
  }
}

function readHostHeader(headers: Record<string, string | string[] | undefined>): string | undefined {
  const raw = headers["host"];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}
