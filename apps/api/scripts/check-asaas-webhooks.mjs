// Release/operations check. This never changes provider configuration or clears
// backoff. The authenticated probe has no real payment or subscription reference.
const sandbox = process.env.ASAAS_SANDBOX?.trim().toLowerCase() !== "false";
const apiKey = (sandbox ? process.env.ASAAS_API_KEY_SANDBOX : process.env.ASAAS_API_KEY)?.trim();
const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
const publicUrl = process.env.API_PUBLIC_URL ?? process.env.PUBLIC_API_URL;

async function main() {
  if (!apiKey || !webhookToken || !publicUrl) {
    throw new Error("ASAAS_API_KEY[_SANDBOX], ASAAS_WEBHOOK_TOKEN and API_PUBLIC_URL are required");
  }
  const origin = new URL(publicUrl).origin;
  if (!origin.startsWith("https://")) throw new Error("API_PUBLIC_URL must use HTTPS");
  const providerBase = sandbox ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3";
  const response = await fetch(`${providerBase}/webhooks?limit=100`, {
    headers: { access_token: apiKey, "User-Agent": "ZyonWebhookHealth/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Asaas webhook configuration lookup returned HTTP ${response.status}`);
  const config = await response.json();
  if (config.hasMore) throw new Error("Incomplete webhook configuration list");

  const paths = ["/webhooks/asaas", "/webhooks/asaas/billing"];
  let healthy = true;
  for (const path of paths) {
    const url = `${origin}${path}`;
    const webhooks = config.data.filter((webhook) => webhook.enabled && webhook.url === url);
    if (!webhooks.length) {
      console.log(JSON.stringify({ url, healthy: false, reason: "enabled_webhook_missing" }));
      healthy = false;
      continue;
    }
    const start = performance.now();
    const probe = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "asaas-access-token": webhookToken },
      body: JSON.stringify({
        id: "evt_zyon_webhook_health_v1",
        event: "PAYMENT_CREATED",
        payment: { id: "pay_zyon_webhook_health_nonexistent" },
      }),
      signal: AbortSignal.timeout(9_000),
      redirect: "error",
    });
    await probe.arrayBuffer();
    for (const webhook of webhooks) {
      const penalized = webhook.penalizedRequestsCount;
      const ok = probe.status === 200 && webhook.interrupted === false &&
        webhook.hasAuthToken === true && penalized === 0;
      console.log(JSON.stringify({
        webhookId: webhook.id, url, status: probe.status,
        elapsedMs: Math.round(performance.now() - start),
        interrupted: webhook.interrupted, penalizedRequestsCount: penalized,
        hasAuthToken: webhook.hasAuthToken, healthy: ok,
      }));
      healthy = healthy && ok;
    }
  }
  if (!healthy) process.exitCode = 1;
}

main().catch((error) => {
  // Avoid provider response bodies and request headers, which can expose secrets.
  console.error(`Asaas webhook check failed: ${error.message}`);
  process.exitCode = 1;
});
