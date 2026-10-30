import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rejectUnauthenticated, type ToolAuthorizer } from "../authorization.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { SearchCatalogInputSchema } from "../schemas.js";

export interface SearchCatalogOptions {
  authorize?: ToolAuthorizer;
  /** Override base URL for tests; defaults to process.env.AACP_API_URL. */
  baseUrl?: string;
  /** Override fetch (e.g. to mock HTTP responses in tests). */
  fetchFn?: typeof fetch;
  apiKey?:string;
  bearerToken?:string;
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
      await (options.authorize??rejectUnauthenticated)({tool:"aacp_search_catalog",merchantId:input.merchantId});
      const baseUrl =
        options.baseUrl ?? process.env.AACP_API_URL ?? "http://localhost:3000";
      const fetchFn = options.fetchFn ?? globalThis.fetch;

      const url = new URL("/v1/ai-governance/tools/catalog", baseUrl);
      url.searchParams.set("query", input.query);
      url.searchParams.set("limit", String(input.limit));
      const key=options.apiKey??process.env.AACP_API_KEY,bearer=options.bearerToken??process.env.AACP_API_TOKEN;

      const response = await fetchFn(url.toString(), {
        method: "GET",
        redirect:"error",signal:AbortSignal.timeout(10000),
        headers: { Accept: "application/json",...(key?{"x-aacp-api-key":key}:bearer?{Authorization:"Bearer "+bearer}:{}) }
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
