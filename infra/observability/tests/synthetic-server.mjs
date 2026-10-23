import { createServer } from "node:http";
import { syntheticMetrics } from "./synthetic-fixtures.mjs";
import { pathToFileURL } from "node:url";

export function createSyntheticServer() {
  const started = Date.now();
  let applicationMetrics = "# Application instrumentation has not reported any metrics.\n";
  return createServer(async (request, response) => {
    if (request.url === "/application-metrics" && request.method === "POST") {
      try {
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 1_000_000) throw new Error("oversized"); chunks.push(chunk); }
        applicationMetrics = Buffer.concat(chunks).toString("utf8"); response.writeHead(204).end();
      } catch { response.writeHead(413).end(); }
      return;
    }
    if (request.method !== "GET" || !["/metrics", "/application-metrics"].includes(request.url)) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    response.end(request.url === "/metrics" ? syntheticMetrics(Math.floor((Date.now() - started) / 1000)) : applicationMetrics);
  });
}
// The only public bind is INSIDE the isolated fixture container, without Docker published ports.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) createSyntheticServer().listen(8080, "0.0.0.0");
