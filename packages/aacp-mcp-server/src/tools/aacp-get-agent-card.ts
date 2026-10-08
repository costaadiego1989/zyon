import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { GetAgentCardInputSchema } from "../schemas.js";

export interface GetAgentCardOptions {
  /** Override base URL for tests; defaults to process.env.AACP_API_URL. */
  baseUrl?: string;
  /** Override fetch (e.g. to mock HTTP responses in tests). */
  fetchFn?: typeof fetch;
}

/**
 * Registers `aacp_get_agent_card` on the given McpServer.
 *
 * Fetches the discovery agent card from AACP API. When merchantId is
 * provided, scopes to that merchant; otherwise returns the platform-level
 * agent card.
 */
export function registerGetAgentCard(
  server: McpServer,
  options: GetAgentCardOptions = {}
): void {
  server.tool(
    "aacp_get_agent_card",
    "Retrieve the discovery agent card (ACP /v1/acp/agent-card). Optionally scoped to a merchant.",
    GetAgentCardInputSchema.shape,
    async (input) => {
      const baseUrl =
        options.baseUrl ?? process.env.AACP_API_URL ?? "http://localhost:3000";
      const fetchFn = options.fetchFn ?? globalThis.fetch;

      const url = new URL("/v1/acp/agent-card", baseUrl);
      if (input.merchantId) {
        url.searchParams.set("merchantId", input.merchantId);
      }

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

      const agentCard = await response.json();

      return {
        content: [{ type: "text", text: JSON.stringify(agentCard) }]
      };
    }
  );
}
