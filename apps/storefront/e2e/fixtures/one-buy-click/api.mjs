import http from "node:http";

// SSR uses a deterministic merchant; browser routes provide authenticated
// preferences. No production API, credentials or payment provider is contacted.
http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:5202");
  const config = url.pathname.endsWith("/config");
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(config ? {
    merchantId: "mrc_preferences_test", name: "Loja de teste", stories: [], storeSettings: {},
    voiceCheckoutEnabled: false, budgetModeEnabled: false,
    theme: { mode: "light", borderRadius: 20, accentColor: "#218b37", fontFamily: "system-ui" },
  }
    : url.pathname.endsWith("/stories") ? { categories: [] } : {}));
}).listen(5202, "127.0.0.1");
