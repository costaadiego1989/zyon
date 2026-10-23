import { createInterface } from "node:readline";

// Test transport over docker exec stdin/stdout. Only these isolated service
// endpoints are reachable; never an arbitrary URL supplied by a browser.
const targets = new Set(["prometheus:9090", "loki:3100", "tempo:3200", "tempo:4318", "alloy:9999", "grafana:3000", "fixture:8080"]);
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let message;
  try {
    if (line.length > 3_000_000) throw new Error("oversized");
    message = JSON.parse(line);
    if (!message || typeof message !== "object" || !Number.isSafeInteger(message.id) || message.id <= 0) throw new Error("invalid");
  } catch {
    process.stdout.write(JSON.stringify({ id: null, error: "invalid_relay_message" }) + "\n"); continue;
  }
  void (async () => {
    try {
      if (!targets.has(message.target) || typeof message.path !== "string" || !message.path.startsWith("/") || message.path.startsWith("//")) throw new Error("invalid_relay_target");
      const response = await fetch(`http://${message.target}${message.path}`, {
        method: message.method, headers: message.headers, redirect: "manual", signal: AbortSignal.timeout(15_000),
        body: message.body ? Buffer.from(message.body, "base64") : undefined,
      });
      const chunks = []; let size = 0;
      for await (const chunk of response.body ?? []) {
        size += chunk.length; if (size > 16_000_000) throw new Error("relay_response_too_large"); chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const headers = [...response.headers].filter(([key]) => key !== "set-cookie");
      if (response.headers.getSetCookie().length) headers.push(["set-cookie", response.headers.getSetCookie()]);
      process.stdout.write(JSON.stringify({ id: message.id, status: response.status, headers, body: body.toString("base64") }) + "\n");
    } catch { process.stdout.write(JSON.stringify({ id: message.id, error: "isolated_backend_unavailable" }) + "\n"); }
  })();
}
