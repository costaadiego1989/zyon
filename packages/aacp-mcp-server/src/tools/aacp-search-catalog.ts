import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { SearchCatalogInputSchema } from "../schemas.js";

export interface SearchCatalogOptions {
  /** Override base URL for tests; defaults to process.env.AACP_API_URL. */
  baseUrl?: string;
  /** Override fetch (e.g. to mock HTTP responses in tests). */
  fetchFn?: typeof fetch;
}

/**
 * Registers `aacp_search_catalog` on the given McpServer.
 *
 * Proxies catalog search to AACP API. No direct DB access (clean architecture
 * invariant — MCP server stays in packages/, never reaches into NestJS).
 */
export function registerSearchCatalog(
  server: McpServer,
  options: SearchCatalogOptions = {}
): void {
  server.tool(
    "aacp_search_catalog",
    "Search the merchant's product catalog. Proxies to AACP API /v1/products with merchant-scoped filter.",
    SearchCatalogInputSchema.shape,
    async (input) => {
      const baseUrl =
        options.baseUrl ?? process.env.AACP_API_URL ?? "http://localhost:3000";
      const fetchFn = options.fetchFn ?? globalThis.fetch;

      const url = new URL("/v1/products", baseUrl);
      url.searchParams.set("merchantId", input.merchantId);
      url.searchParams.set("q", input.query);
      url.searchParams.set("limit", String(input.limit));

      const response = await fetchFn(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        throw new McpError(
          ErrorCode.InternalError,
          `aacp_api_http_${response.status}`
        );
      }

      const json = (await response.json()) as {
        products?: Array<{
          id: string;
          sku: string;
          title: string;
          priceCents: number;
          currency: string;
          imageUrl?: string;
        }>;
      };

      const products = (json.products ?? []).map((p) => ({
        id: p.id,
        sku: p.sku,
        title: p.title,
        priceCents: p.priceCents,
        currency: p.currency,
        imageUrl: p.imageUrl ?? null
      }));

      return {
        content: [{ type: "text", text: JSON.stringify({ products }) }]
      };
    }
  );
}
