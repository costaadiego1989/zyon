# AACP MCP Server

Standalone [Model Context Protocol](https://modelcontextprotocol.io) server that exposes AACP's internal engines as tools for AI frameworks (Claude, OpenAI, Cursor, etc).

The server speaks MCP over **stdio** (the default transport) and registers 5 tools. Three run in-process against the existing engines (`rules-engine`, `shipping-engine`, `conversation-engine`); two proxy to the AACP REST API.

## Install

```bash
pnpm install
pnpm --filter @zyon/aacp-mcp-server build
```

This produces `packages/aacp-mcp-server/dist/index.js`, registered as the `aacp-mcp` bin.

## Run

The server speaks stdio. Most MCP clients launch it as a subprocess; for a smoke test:

```bash
node packages/aacp-mcp-server/dist/index.js
# logs "[aacp-mcp] server ready (stdio transport)" to stderr
```

### Environment variables

| Var          | Required | Default                 | Purpose                                        |
| ------------ | -------- | ----------------------- | ---------------------------------------------- |
| `AACP_API_URL` | no     | `http://localhost:3000` | API base for authorization and proxy tools. HTTPS is required outside loopback. |
| `AACP_API_KEY` | yes, or token | — | Tenant API key with `configuration:read` for server-side tool authorization. |
| `AACP_API_TOKEN` | yes, or key | — | Alternative tenant bearer credential. Human credentials require owner/admin role. |

Every tool calls `/v1/ai-governance/tools/authorize` before executing. Missing
credentials, API outages, policy denials and tenant mismatches block execution.
The API derives tenant and role from the credential; `merchantId` in arguments
cannot select a different tenant. Keep credentials in the MCP client's secret
environment configuration. The policy source for these calls is `mcp`.
Catalog reads additionally require the service scope `catalog:read` and use
`GET /v1/ai-governance/tools/catalog`. Only active products and public fields
are returned; the tenant is derived again from the credential at the read.

## Tools

| Tool                      | Engine                                  | Input                                                                            | Output                                                                                       |
| ------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `aacp_evaluate_discount`  | `@zyon/rules-engine` (in-process)       | `{ merchantId, cartItems, requestedDiscountPercent, maxReaisCap?, maxDiscountPercent?, minimumMarginPercent? }` | `{ approved, finalDiscountPercent, marginPercent, reason, type }`                             |
| `aacp_evaluate_shipping`  | `@zyon/shipping-engine` (in-process)    | `{ merchantId, destinationPostalCode, cartTotal, items, shipping?, abandonmentScore, ... }` | `{ options: [{ id, carrier, method, costCents, estimatedDays, subsidized, ... }], approved, reason }` |
| `aacp_generate_message`   | `@zyon/conversation-engine` (in-process)| `{ merchantId, intent, context }`                                                | `{ message, fallbackUsed }`                                                                  |
| `aacp_search_catalog`     | HTTP → AACP `/v1/ai-governance/tools/catalog`              | `{ merchantId, query, limit? }`                                                  | `{ products: [{ id, sku, title, priceCents, currency, imageUrl? }] }`                         |
| `aacp_get_agent_card`     | HTTP → AACP `/v1/acp/agent-card`        | `{ merchantId? }`                                                                | full agent card JSON                                                                          |

## Safety

`aacp_generate_message` ALWAYS runs the output through `isSafeGeneratedMessage`. If the engine returns text that contains:

- unauthorized discount % claims,
- unauthorized free shipping or shipping discount claims,
- delivery / stock / payment guarantees,
- CVV/password/token requests,

…the tool returns a deterministic safe fallback and `fallbackUsed: true`. There is no LLM bypass path: the MCP server intentionally only calls the deterministic engine without calling a language model. Every tool still requires API authorization.

## Architecture invariants

- **No NestJS imports.** Clean Architecture: this package lives in `packages/`, never reaches into `apps/api/src/modules/*`.
- **In-process engines** for tools that don't need API state (discount, shipping, message generation).
- **HTTP proxy** for tools that need the API (catalog search, agent card discovery) — so the MCP server can stay stateless and sidecar-safe.
- **stderr logging only.** stdout is the JSON-RPC channel; any `console.log` would corrupt framing.

## Test

```bash
cd packages/aacp-mcp-server
pnpm test
```

Runs schema validation, authenticated authorization, tenant isolation, engine safety and HTTP-mock tests.

## Wire into an MCP client

Add to your MCP client config (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "aacp": {
      "command": "node",
      "args": ["packages/aacp-mcp-server/dist/index.js"],
      "env": {
        "AACP_API_URL": "https://your-aacp-api.example.com"
      }
    }
  }
}
```

Once connected, the host can call any of the 5 tools. The JSON-RPC handshake is automatic.
