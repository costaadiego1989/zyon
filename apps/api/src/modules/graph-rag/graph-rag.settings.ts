import type { GraphConnectionSettings } from "./domain/graph-rag.port.js";
export function graphRagSettings(env: NodeJS.ProcessEnv): GraphConnectionSettings {
  const merchantIds = [...new Set((env.GRAPH_RAG_MERCHANT_IDS ?? "").split(",").map(id => id.trim()).filter(id => /^[\w-]{1,191}$/.test(id)))].slice(0, 20);
  const readUser = env.NEO4J_READ_USER, writeUser = env.NEO4J_WRITE_USER;
  let uri: string | undefined;
  try {
    const parsed = new URL(env.NEO4J_URI ?? "");
    if (["bolt:", "bolt+s:", "neo4j:", "neo4j+s:"].includes(parsed.protocol) && !parsed.username && !parsed.password) uri = parsed.href;
  } catch { /* Invalid configuration stays disabled. */ }
  return { enabled: env.GRAPH_RAG_ENABLED === "true" && merchantIds.length > 0 && !!uri
      && !!readUser && !!writeUser && readUser !== writeUser && !!env.NEO4J_READ_PASSWORD && !!env.NEO4J_WRITE_PASSWORD,
    merchantIds, uri, database: env.NEO4J_DATABASE || "neo4j", readUser, writeUser,
    readPassword: env.NEO4J_READ_PASSWORD, writePassword: env.NEO4J_WRITE_PASSWORD,
    production: env.NODE_ENV === "production", timeoutMs: 2000 };
}
