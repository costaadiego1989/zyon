// Local browser fixture only. No provider, sandbox, database or payment calls.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const merchantId = "consent-preview-store";
const conversationId = "consent-preview-cart";
const token = `${Buffer.from(JSON.stringify({ expiresAt: Date.now() / 1000 + 3600 })).toString("base64url")}.fixture`;
const logo = await readFile(new URL("../../../web/assets/zyon-logo-new.png", import.meta.url));
const cart = { cartId: conversationId, items: [{ variantId: "preview-sku", productName: "Produto de demonstração", quantity: 1, price: 129.9, subtotal: 129.9 }], itemCount: 1, total: 129.9, discount: 0 };
const config = {
  merchantId, name: "Zyon Demo Store", logo: `data:image/png;base64,${logo.toString("base64")}`, agentName: "Zyon",
  agentGreeting: "Olá! Como posso ajudar na sua compra?", stories: [], showBranding: true, voiceCheckoutEnabled: false,
  theme: { mode: "light", accentColor: "#0f766e", backgroundColor: "#f4f6f8", textColor: "#202832", fontFamily: "system-ui, sans-serif" },
  storeSettings: { gtm: { gtmId: "GTM-TEST123", pixelIds: { facebook: "123456789012345", tiktok: "TEST1234567890" } } },
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost:3009");
  response.setHeader("Access-Control-Allow-Origin", "http://localhost:3001");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, x-buyer-token");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  if (url.pathname === "/preview-logo.png") { response.setHeader("Content-Type", "image/png"); response.end(logo); return; }
  let body = "";
  for await (const chunk of request) body += chunk;
  response.setHeader("Content-Type", "application/json");
  const json = (value) => response.end(JSON.stringify(value));
  if (url.pathname.endsWith("/config")) return json(config);
  if (url.pathname.endsWith("/stories")) return json({ categories: [] });
  if (url.pathname.includes("/widget-config")) return json({});
  if (url.pathname.endsWith("/conversations")) return json({ conversation_id: conversationId, conversation_token: token });
  if (url.pathname.endsWith(`/conversations/${conversationId}`)) return json({ conversation_id: conversationId, messages: [] });
  if (url.pathname.endsWith("/messages")) return json({ message: "Confira o carrinho e finalize quando quiser.", blocks: [{ type: "cart_summary", data: cart }, { type: "quick_replies", data: { options: ["Finalizar compra"] } }] });
  if (url.pathname.includes("/cart/")) return json(cart);
  if (url.pathname.endsWith("/one-buy-click")) return json({ enabled: false, status: "paused", shippingPreference: "fastest", paymentPreference: "pix" });
  if (url.pathname.endsWith("/contact-consent")) return json({ success: true, channels: [] });
  if (url.pathname.endsWith("/embed-sessions")) return json({ embed_session_token: "local-preview-token", expires_at_unix: Math.floor(Date.now() / 1000) + 900 });
  if (url.pathname.endsWith("/embed/payment/current")) return json({ version: 1, session_id: "local-preview-checkout", marketplace: false, payment: null });
  if (url.pathname.endsWith("/embed/start")) return json({ session_id: "local-preview-checkout", experience: {
    items: [{ sku: "preview-sku", name: "Produto de demonstração", quantity: 1, unit_price: 129.9 }],
    totals: { subtotal: 129.9, total: 129.9, discount: 0 }, brand: { name: "Zyon Demo Store", theme: { mode: "light" } },
    agent: { name: "Zyon", language: "pt-BR" }, buyer: { name: "Comprador de demonstração" }, paymentMethods: { pix: true, card: false, boleto: false },
  } });
  return json({});
}).listen(3009, "localhost", () => process.stdout.write("Local consent fixture on http://localhost:3009\n"));
