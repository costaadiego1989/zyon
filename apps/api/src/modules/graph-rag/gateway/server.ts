import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { CommunityReadEngine } from "./community-read-engine.js";
import { createQueryGateway } from "./query-gateway.js";
import { GRAPH_QUERY_PROTOCOL, GRAPH_TEMPLATE_HASH } from "./query-protocol.js";

export async function startQueryGateway(env: NodeJS.ProcessEnv = process.env) {
  const merchantIds = [...new Set((env.GRAPH_ALLOWED_MERCHANT_IDS ?? "").split(",").map(id => id.trim()))];
  const uri = new URL(env.NEO4J_URI ?? "");
  const privateHost = env.NODE_ENV === "production" ? uri.hostname.endsWith(".railway.internal")
    : ["127.0.0.1", "[::1]"].includes(uri.hostname);
  const port = Number(env.PORT ?? 8080);
  if (!privateHost || !["bolt:", "bolt+s:", "neo4j:", "neo4j+s:"].includes(uri.protocol) || uri.username || uri.password
    || !env.NEO4J_USERNAME || !env.NEO4J_PASSWORD || !Number.isSafeInteger(port) || port < 1 || port > 65535
    || merchantIds.length > 20 || merchantIds.some(id => !/^[\w-]{1,191}$/.test(id))) throw Error("query_service_unconfigured");
  const engine = new CommunityReadEngine({ uri: uri.href, user: env.NEO4J_USERNAME, password: env.NEO4J_PASSWORD,
    database: env.NEO4J_DATABASE || "neo4j", merchantIds });
  const gateway = createQueryGateway({ keyId: env.GRAPH_GATEWAY_KEY_ID ?? "", secret: env.GRAPH_GATEWAY_SECRET ?? "", merchantIds }, engine);
  if (!await engine.probe()) { await engine.close();throw Error("query_service_database_unavailable"); }
  await new Promise<void>((resolve, reject) => { gateway.server.once("error", reject);gateway.server.listen(port, "::", resolve); });
  return gateway;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  startQueryGateway().then(gateway => {
    console.log(JSON.stringify({ service: "graph-query", state: "ready", protocol: GRAPH_QUERY_PROTOCOL,
      templateHash: GRAPH_TEMPLATE_HASH, revision: /^[a-f0-9]{40}$/.test(process.env.RAILWAY_GIT_COMMIT_SHA ?? "") ? process.env.RAILWAY_GIT_COMMIT_SHA : "unknown" }));
    let shutdown: Promise<void> | undefined;
    const stop = () => {
      shutdown ??= gateway.close();
      void shutdown.then(() => process.exit(0), () => process.exit(1));
    };
    process.once("SIGTERM", stop);process.once("SIGINT", stop);
  }).catch(() => { console.error("graph-query startup failed");process.exitCode = 1; });
}
