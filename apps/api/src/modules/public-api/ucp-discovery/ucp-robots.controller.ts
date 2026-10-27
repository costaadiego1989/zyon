import { Controller, Get, Header, Inject, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Response } from "express";
import { PublicRoute } from "../../../shared/tenant/tenant.guard.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository,
} from "../../merchant/domain/ports/merchant-repository.port.js";
import { resolveStoreDomain } from "../agentic-protocol/acp-store-domain.service.js";
import {
  readResolverConfig,
  resolveMerchantFromHost,
} from "./merchant-resolver.js";

/**
 * Per-merchant robots.txt — the central knob that lets AI crawlers
 * (GPTBot, ClaudeBot, OAI-SearchBot, PerplexityBot, Google-Extended, etc.)
 * reach the merchant storefront while we keep the platform's admin / API /
 * checkout paths off-limits for indexing.
 *
 * The route is `GET /robots.txt` (root level, no `.well-known/` prefix —
 * that's where robots.txt has always lived).
 */
@ApiExcludeController()
@Controller("")
export class UcpRobotsController {
  constructor(
    @Inject(MERCHANT_REPOSITORY)
    private readonly merchants: MerchantRepository,
  ) {}

  @Get("robots.txt")
  @Header("Cache-Control", "public, max-age=3600")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @PublicRoute()
  async robots(
    @Req() req: { headers: Record<string, string | string[] | undefined> },
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const host = readHostHeader(req.headers);
    const storeDomain = resolveStoreDomain();
    const config = readResolverConfig(process.env, storeDomain);
    const resolved = await resolveMerchantFromHost(
      host,
      this.merchants,
      config,
      storeDomain,
    );

    const isPlatform = resolved.kind === "platform";
    const merchantName = isPlatform ? "AACP Platform" : resolved.merchantName;
    const merchantId = isPlatform ? "platform-default" : resolved.merchantId;
    const sitemapUrl = isPlatform
      ? `https://${storeDomain}/sitemap.xml`
      : `https://${resolved.slug}.${storeDomain}/sitemap.xml`;

    const body = renderRobotsTxt(merchantName, merchantId, sitemapUrl);
    res.status(200).send(body);
  }
}

export function renderRobotsTxt(
  merchantName: string,
  merchantId: string,
  sitemapUrl: string,
): string {
  return [
    `# AACP Merchant Robots.txt`,
    `# Generated for merchant: ${merchantName} (${merchantId})`,
    ``,
    `# Allow all AI crawlers — agentic commerce is the point`,
    `User-agent: GPTBot`,
    `Allow: /`,
    ``,
    `User-agent: ChatGPT-User`,
    `Allow: /`,
    ``,
    `User-agent: OAI-SearchBot`,
    `Allow: /`,
    ``,
    `User-agent: ClaudeBot`,
    `Allow: /`,
    ``,
    `User-agent: Claude-Web`,
    `Allow: /`,
    ``,
    `User-agent: PerplexityBot`,
    `Allow: /`,
    ``,
    `User-agent: Google-Extended`,
    `Allow: /`,
    ``,
    `User-agent: Applebot-Extended`,
    `Allow: /`,
    ``,
    `# Standard crawlers`,
    `User-agent: Googlebot`,
    `Allow: /`,
    ``,
    `User-agent: *`,
    `Disallow: /admin/`,
    `Disallow: /api/`,
    `Disallow: /checkout`,
    `Disallow: /v1/`,
    `Allow: /`,
    ``,
    `# Sitemap`,
    `Sitemap: ${sitemapUrl}`,
    ``,
  ].join("\n");
}

function readHostHeader(headers: Record<string, string | string[] | undefined>): string | undefined {
  const raw = headers["host"];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}
