import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEvaluateDiscount } from "./tools/aacp-evaluate-discount.js";
import { registerEvaluateShipping } from "./tools/aacp-evaluate-shipping.js";
import { registerGenerateMessage } from "./tools/aacp-generate-message.js";
import {
  registerSearchCatalog,
  type SearchCatalogOptions
} from "./tools/aacp-search-catalog.js";
import {
  registerGetAgentCard,
  type GetAgentCardOptions
} from "./tools/aacp-get-agent-card.js";

export interface CreateServerOptions {
  searchCatalog?: SearchCatalogOptions;
  agentCard?: GetAgentCardOptions;
}

/**
 * Build an McpServer instance with all 5 Phase-4 tools registered.
 *
 * Tools:
 *   - aacp_evaluate_discount  (in-process rules-engine)
 *   - aacp_evaluate_shipping  (in-process shipping-engine)
 *   - aacp_generate_message   (in-process conversation-engine + safety)
 *   - aacp_search_catalog     (HTTP → AACP API)
 *   - aacp_get_agent_card     (HTTP → AACP API)
 */
export function createAacpMcpServer(
  options: CreateServerOptions = {}
): McpServer {
  const server = new McpServer(
    {
      name: "aacp-mcp-server",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  registerEvaluateDiscount(server);
  registerEvaluateShipping(server);
  registerGenerateMessage(server);
  registerSearchCatalog(server, options.searchCatalog);
  registerGetAgentCard(server, options.agentCard);

  return server;
}
