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
| `AACP_API_URL` | no     | `http://localhost:3000` | Base URL for the two HTTP-proxy tools          |

## Tools

| Tool                      | Engine                                  | Input                                                                            | Output                                                                                       |
| ------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `aacp_evaluate_discount`  | `@zyon/rules-engine` (in-process)       | `{ merchantId, cartItems, requestedDiscountPercent, maxReaisCap?, maxDiscountPercent?, minimumMarginPercent? }` | `{ approved, finalDiscountPercent, marginPercent, reason, type }`                             |
| `aacp_evaluate_shipping`  | `@zyon/shipping-engine` (in-process)    | `{ merchantId, destinationPostalCode, cartTotal, items, shipping?, abandonmentScore, ... }` | `{ options: [{ id, carrier, method, costCents, estimatedDays, subsidized, ... }], approved, reason }` |
| `aacp_generate_message`   | `@zyon/conversation-engine` (in-process)| `{ merchantId, intent, context }`                                                | `{ message, fallbackUsed }`                                                                  |
| `aacp_search_catalog`     | HTTP → AACP `/v1/products`              | `{ merchantId, query, limit? }`                                                  | `{ products: [{ id, sku, title, priceCents, currency, imageUrl? }] }`                         |
| `aacp_get_agent_card`     | HTTP → AACP `/v1/acp/agent-card`        | `{ merchantId? }`                                                                | full agent card JSON                                                                          |

## Safety

`aacp_generate_message` ALWAYS runs the output through `isSafeGeneratedMessage`. If the engine returns text that contains:

- unauthorized discount % claims,
- unauthorized free shipping or shipping discount claims,
- delivery / stock / payment guarantees,
- CVV/password/token requests,

…the tool returns a deterministic safe fallback and `fallbackUsed: true`. There is no LLM bypass path: the MCP server intentionally only calls the deterministic engine so the safety guarantees hold without API keys or network access.

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

Runs schema validation + happy-path + safety + HTTP-mock tests (~16 cases).

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
