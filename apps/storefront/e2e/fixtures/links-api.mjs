import { createServer } from "node:http";
const merchantId = "merchant-links";
const product = { merchantId, productId: "product-one", blocks: [], faqs: [], testimonials: [], videos: [],
  purchase: { productName: "Produto teste", description: "Detalhes do produto compartilhado.", defaultVariantId: "variant-one", priceReais: 49.9, currency: "BRL",
    variants: [{ id: "variant-one", attributes: { Tamanho: "Unico" }, available: true, priceReais: 49.9, currency: "BRL", lowStock: false }], images: [], optionGroups: [] } };
const proof = Buffer.from(JSON.stringify({ expiresAt: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".local";
createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname.replace(/^\/v1/, "");
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
  const send = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
  if (path.endsWith("/config")) return send({ merchantId, name: "Loja de teste", agentName: "Assistente", agentGreeting: "Como posso ajudar?",
    theme: { mode: "light", accentColor: "#21695c", fontFamily: "system-ui" }, storeSettings: {}, stories: [], quickReplies: [], agentInitialDelaySeconds: 999, agentMode: "manual" });
  if (/\/products\/[^/]+\/(content|share)$/.test(path)) return send({ ...product, productId: path.split("/").at(-2) });
  if (path.endsWith("/stories")) return send({ categories: [] });
  if (path.includes("widget-config")) return send({ enabledTriggers: [], budgetModeEnabled: false });
  if (path.endsWith("/recovery")) {
    if (req.headers.origin !== "http://localhost:4318") return send({ message: "recovery_origin_not_allowed" }, 403);
    if (body.token === "expired") return send({ message: "recovery_link_invalid_or_expired" }, 401);
    if (body.token === "completed") return send({ message: "recovery_purchase_completed" }, 410);
    if (!body.buyer_access_token) return send({ message: "recovery_buyer_login_required" }, 401);
    return send({ merchant_id: merchantId, embed_session_token: "local-recovered-embed", expires_at_unix: Math.floor(Date.now() / 1000) + 900 });
  }
  if (path.endsWith("/embed/start")) return send({ session_id: "checkout-original", experience: {
    brand: { name: "Loja de teste", mode: "light", accentColor: "#21695c" }, agent: { name: "Assistente", greeting: "Revise sua compra recuperada" },
    buyer: { name: "Comprador", email: "buyer@example.test" }, items: [{ sku: "variant-one", name: "Produto recuperado", unit_price: 49.9, quantity: 1 }],
    totals: { subtotal: 49.9, discount: 0, total: 49.9 }, stage: "payment", rules: { showBranding: false }, suggestedProducts: [] } });
  if (path.endsWith("/embed/chat")) return send({ message: "Revise sua compra recuperada", blocks: [], quick_replies: [] });
  if (path.endsWith("/embed/track")) return send({ accepted: true });
  if (path.endsWith("/conversations") || path.endsWith("/access")) return send({ conversation_id: "conversation-local", conversation_token: proof, messages: [] });
  if (path.includes("/cart/")) return send({ cartId: "conversation-local", items: [], total: 0, discount: 0 });
  if (path.endsWith("/messages")) return send({ message: "Como posso ajudar?", blocks: [] });
  if (path.endsWith("/products")) return send({ products: [] });
  if (req.method === "GET") return send({});
  return send({ message: "mock_operation_not_allowed" }, 400);
}).listen(4319, "127.0.0.1", () => console.log("Local storefront link fixtures listening on 4319"));
