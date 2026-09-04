#!/usr/bin/env node
/**
 * AACP MCP Server — entry point.
 *
 * Spawns a stdio MCP server that exposes AACP engines as tools for AI
 * frameworks (Claude, OpenAI, etc). Stdio is the default transport for MCP.
 *
 * Logging goes to stderr (stdout is the JSON-RPC channel).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAacpMcpServer } from "./server.js";

async function main(): Promise<void> {
  const server = createAacpMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // stderr only — stdout carries JSON-RPC.
  console.error("[aacp-mcp] server ready (stdio transport)");
}

main().catch((error) => {
  console.error("[aacp-mcp] fatal:", error);
  process.exit(1);
});
