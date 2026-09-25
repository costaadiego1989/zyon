// Deterministic local API for the actual Next storefront and its HTTP proxy.
import http from "node:http";

const requests = [];
const cart = { cartId: "conversation", items: [{ variantId: "v", productName: "Produto de teste", quantity: 2, price: 125, subtotal: 250 }], itemCount: 2, discount: 10, total: 240 };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:5201");
  const parts = url.pathname.split("/").filter(Boolean);
  let data = {};
  if (parts[0] === "storefront" && parts[2] === "config") {
    const [mode, density] = parts[1].split("-");
    data = {
      merchantId: "merchant", name: "Loja de teste", budgetModeEnabled: true, voiceCheckoutEnabled: true,
      agentMode: "manual_only", agentGreeting: "Como posso ajudar com seu orçamento?",
      quickReplies: ["Solicitar orçamento"], stories: [], storeSettings: {},
      theme: { mode, density, borderRadius: 24, accentColor: "#0f766e", backgroundColor: "#f7f8fa", textColor: "#111827", fontFamily: "system-ui" },
    };
  } else if (url.pathname === "/checkout-settings/widget-config") data = { budgetModeEnabled: true, mode: "manual_only", enabledTriggers: [], suppressedSteps: [], blockedRegions: [] };
  else if (url.pathname === "/storefront/cart/conversation") data = cart;
  else if (url.pathname === "/storefront/conversations/conversation/history") data = { messages: [] };
  else if (url.pathname === "/storefront/budget-requests" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ ...JSON.parse(body), authorized: Boolean(req.headers.authorization), internal: req.headers["x-internal-service-token"] === "local-fixture-only" });
    data = { id: "budget-next-1", status: "pending" };
  } else if (url.pathname === "/requests") data = requests;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}).listen(5201, "127.0.0.1");
