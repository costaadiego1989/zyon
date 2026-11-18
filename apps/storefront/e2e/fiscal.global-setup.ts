/** Compile the real development routes before the existing browser test clock. */
export default async function fiscalGlobalSetup() {
  const scenario = await fetch("http://127.0.0.1:3024/v1/__scenario", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "authorized" }),
    redirect: "error",
    signal: AbortSignal.timeout(120000),
  });
  if (scenario.status !== 201) throw new Error("fiscal_browser_warmup_seed_failed");
  const seed = await scenario.json() as { slug?: string };
  if (typeof seed.slug !== "string" || !seed.slug.trim()) throw new Error("fiscal_browser_warmup_seed_failed");
  // Only GETs reach Next. Guarded/POST-only routes cannot create a payment,
  // conversation, message or document; the owned fixture above is synthetic.
  const routes: Array<[string, number]> = [
    ["/store/" + encodeURIComponent(seed.slug), 200],
    ["/api/v1/buyer/me", 401],
    ["/api/storefront-conversations", 405],
    ["/api/storefront-proxy/conversations/fiscal_warmup/events", 403],
  ];
  for (const [route, status] of routes) {
    const response = await fetch("http://localhost:3001" + route, {
      redirect: "error",
      signal: AbortSignal.timeout(120000),
    });
    await response.arrayBuffer();
    if (response.status !== status)
      throw new Error("fiscal_browser_warmup_route_failed:" + route);
  }
}
