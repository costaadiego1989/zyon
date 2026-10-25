/**
 * AACP MCP server live integration test.
 *
 * Spawns the compiled AACP MCP server as a child process and talks to it
 * over stdio using the JSON-RPC protocol. The server implements the MCP
 * spec, so we can drive `initialize`, `tools/list`, and `tools/call`
 * directly — no external MCP client required.
 *
 * What we verify:
 *  - `initialize` handshake completes with protocolVersion + serverInfo.
 *  - `tools/list` returns the five Phase-4 tools.
 *  - `tools/call aacp_search_catalog` round-trips through the AACP API and
 *    returns catalog rows (or an empty list if no seed).
 *  - `tools/call aacp_evaluate_discount` evaluates a synthetic cart.
 *
 * Skips when AACP_MCP_BIN does not exist or is not executable.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const MCP_BIN = process.env.AACP_MCP_BIN?.trim();
const AACP_API_URL = process.env.AACP_API_URL?.trim() || "http://localhost:3009";
const AACP_MERCHANT_ID = process.env.AACP_MERCHANT_ID?.trim() || "mrc_test";

const resolvedBin = MCP_BIN ? resolve(MCP_BIN) : "";
const runGate = Boolean(MCP_BIN) && existsSync(resolvedBin);

interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

class McpStdioClient {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, (msg: JsonRpcResponse) => void>();
  private buffer = "";

  constructor(binPath: string, env: NodeJS.ProcessEnv) {
    this.proc = spawn("node", [binPath], {
      env: { ...env, AACP_API_URL },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      // MCP frames are newline-delimited JSON (one message per line). See
      // @modelcontextprotocol/sdk shared/stdio.js — ReadBuffer uses
      // `buffer.indexOf('\n')` and `serializeMessage` appends '\n'.
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, nl).replace(/\r$/, "");
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as JsonRpcResponse;
          const handler = this.pending.get(parsed.id);
          if (handler) {
            this.pending.delete(parsed.id);
            handler(parsed);
          }
        } catch {
          /* malformed frame — skip */
        }
      }
    });
    this.proc.stderr.on("data", () => {
      /* server logs go to stderr — ignored */
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, (msg) => {
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result as T);
      });
      this.proc.stdin.write(payload + "\n", (err) => {
        if (err) reject(err);
      });
    });
  }

  close(): void {
    try {
      this.proc.stdin.end();
    } catch {
      /* already closed */
    }
    try {
      this.proc.kill("SIGTERM");
    } catch {
      /* already dead */
    }
  }
}

test(
  "MCP: server exposes the five Phase-4 tools and search_catalog returns rows",
  { skip: !runGate ? `Set AACP_MCP_BIN to the compiled aacp-mcp-server/dist/index.js (looked for ${resolvedBin})` : false },
  async (t) => {
    const client = new McpStdioClient(resolvedBin, process.env);
    t.after(() => client.close());

    // Step 1: initialize.
    const init = await client.send<{
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities?: Record<string, unknown>;
    }>("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "aacp-int-spec", version: "0.1.0" },
    });
    assert.equal(init.serverInfo.name, "aacp-mcp-server");
    assert.ok(init.capabilities, "server must advertise capabilities");
    console.log(`  -> initialized: protocol=${init.protocolVersion} server=${init.serverInfo.name}@${init.serverInfo.version}`);

    // Step 2: list tools.
    const toolsList = await client.send<{ tools: Array<{ name: string; description?: string }> }>(
      "tools/list",
      {},
    );
    const names = toolsList.tools.map((t) => t.name).sort();
    assert.deepEqual(
      names,
      ["aacp_evaluate_discount", "aacp_evaluate_shipping", "aacp_generate_message", "aacp_get_agent_card", "aacp_search_catalog"],
      `MCP server must expose the 5 Phase-4 tools; got ${names.join(", ")}`,
    );
    console.log(`  -> tools/list returned ${names.length} tools: ${names.join(", ")}`);

    // Step 3: call aacp_search_catalog. Pass a permissive query so the call
    // doesn't fail on a missing seed — we assert the call returns without
    // throwing and the response shape is `{ products: [...] }`.
    // aacp_search_catalog requires a non-empty query (schema: z.string().min(1)).
    const searchResult = await client.send<{
      content: Array<{ type: string; text: string }>;
    }>(
      "tools/call",
      {
        name: "aacp_search_catalog",
        arguments: {
          merchantId: AACP_MERCHANT_ID,
          query: "test",
          limit: 5,
        },
      },
    );

    assert.ok(Array.isArray(searchResult.content), "MCP result must have content[]");
    const text = searchResult.content.find((c) => c.type === "text");
    assert.ok(text, "MCP result must include a text block");

    let parsed: { products?: Array<{ sku?: string }> } = {};
    try {
      parsed = JSON.parse(text!.text);
    } catch {
      // Some implementations wrap differently; tolerate non-JSON text.
    }
    // Either we got an array of products (live seed) or an empty list (no seed).
    assert.ok(Array.isArray(parsed.products), `aacp_search_catalog result must include products[]; got ${text!.text.slice(0, 200)}`);
    console.log(`  -> aacp_search_catalog returned ${parsed.products!.length} products`);

    // Step 4: call aacp_evaluate_discount (pure rules-engine, no HTTP).
    // Schema expects cartItems[] with {sku, name, price, cost, quantity}.
    const discountResult = await client.send<{
      content: Array<{ type: string; text: string }>;
    }>(
      "tools/call",
      {
        name: "aacp_evaluate_discount",
        arguments: {
          merchantId: AACP_MERCHANT_ID,
          cartItems: [{ sku: "sku_1", name: "Widget", price: 100, cost: 50, quantity: 1 }],
          requestedDiscountPercent: 10,
        },
      },
    );
    assert.ok(Array.isArray(discountResult.content));
    const discountText = discountResult.content.find((c) => c.type === "text");
    assert.ok(discountText, "discount tool must return a text block");
    // Don't assert discount % — the rules engine result varies by merchant
    // configuration. Just assert we got a JSON payload.
    JSON.parse(discountText!.text);
    console.log(`  -> aacp_evaluate_discount returned a valid JSON payload`);
  },
);
