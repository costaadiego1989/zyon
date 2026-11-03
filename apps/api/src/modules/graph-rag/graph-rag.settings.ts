import type { GraphConnectionSettings } from "./domain/graph-rag.port.js";
export function graphRagSettings(env: NodeJS.ProcessEnv): GraphConnectionSettings {
  const merchantIds = [...new Set((env.GRAPH_RAG_MERCHANT_IDS ?? "").split(",").map(id => id.trim()).filter(id => /^[\w-]{1,191}$/.test(id)))].slice(0, 20);
  const readUser = env.NEO4J_READ_USER, writeUser = env.NEO4J_WRITE_USER;
  const queryMode = env.GRAPH_RAG_QUERY_MODE ?? "direct";
  let queryGateway: GraphConnectionSettings["queryGateway"];
  try {
    const address = new URL(env.GRAPH_GATEWAY_URL ?? "");
    const allowed = env.NODE_ENV === "production" ? address.hostname.endsWith(".railway.internal")
      : ["127.0.0.1", "[::1]"].includes(address.hostname);
    if (allowed && ["http:", "https:"].includes(address.protocol) && address.pathname === "/" && !address.username && !address.password
      && !address.search && !address.hash && /^[a-f0-9]{64}$/.test(env.GRAPH_GATEWAY_KEY ?? "") && /^[\w-]{1,80}$/.test(env.GRAPH_GATEWAY_KEY_ID ?? ""))
      queryGateway = { uri: address.href, keyId: env.GRAPH_GATEWAY_KEY_ID!, secret: env.GRAPH_GATEWAY_KEY! };
  } catch { /* Incomplete gateway configuration remains disabled. */ }
  let uri: string | undefined;
  try {
    const parsed = new URL(env.NEO4J_URI ?? "");
    if (["bolt:", "bolt+s:", "neo4j:", "neo4j+s:"].includes(parsed.protocol) && !parsed.username && !parsed.password) uri = parsed.href;
  } catch { /* Invalid configuration stays disabled. */ }
  const readConfigured = queryMode === "community_gateway" ? !!queryGateway
    : queryMode === "direct" && !!readUser && readUser !== writeUser && !!env.NEO4J_READ_PASSWORD;
  return { enabled: env.GRAPH_RAG_ENABLED === "true" && merchantIds.length > 0 && !!uri
      && readConfigured && !!writeUser && !!env.NEO4J_WRITE_PASSWORD,
    merchantIds, uri, database: env.NEO4J_DATABASE || "neo4j", readUser, writeUser,
    readPassword: env.NEO4J_READ_PASSWORD, writePassword: env.NEO4J_WRITE_PASSWORD,
    production: env.NODE_ENV === "production", timeoutMs: 2000,
    queryMode: queryMode === "community_gateway" ? "community_gateway" : "direct", queryGateway };
}
