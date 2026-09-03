import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PublicRoute } from "../../../shared/tenant/tenant.guard.js";
import { UcpDiscoveryDto } from "./ucp-discovery.dtos.js";

@ApiTags("Agentic Protocol - Discovery")
@Controller("")
export class UcpDiscoveryController {
  /**
   * GET /.well-known/ucp
   *
   * Publishes merchant's Unified Commerce Platform (UCP) / Agentic Commerce
   * Platform (ACP) discovery metadata. Public — no authentication required.
   *
   * This endpoint is used by AI/agentic platforms to discover the merchant's
   * capabilities, supported protocols, and API endpoint URLs before initiating
   * checkout or product feed operations.
   *
   * Response is idempotent and cacheable for 1 hour (Cache-Control: public, max-age=3600).
   */
  @Get(".well-known/ucp")
  @PublicRoute()
  @ApiOperation({
    summary: "UCP/ACP discovery metadata",
    description:
      "Returns Unified Commerce Platform (UCP) / Agentic Commerce Platform (ACP) " +
      "discovery metadata describing this merchant's capabilities, supported " +
      "protocols, and endpoint locations. Public endpoint — no authentication " +
      "required. Cacheable (recommended: 1h TTL).",
  })
  @ApiResponse({
    status: 200,
    description: "Discovery metadata published",
    type: UcpDiscoveryDto,
  })
  async discovery(): Promise<UcpDiscoveryDto> {
    return {
      version: "1.0",
      name: "AACP",
      merchant_id: "platform-default",
      capabilities: ["checkout", "product_discovery", "payment"],
      supported_protocols: ["acp", "ucp", "ap2"],
      checkout_sessions_endpoint: "/v1/acp/checkout_sessions",
      feed_endpoint: "/v1/acp/products/feed",
      webhook_endpoint: "/v1/acp/webhooks",
      created_at: new Date().toISOString(),
    };
  }
}
