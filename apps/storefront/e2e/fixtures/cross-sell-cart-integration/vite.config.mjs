import { fileURLToPath } from "node:url";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
const root = path.dirname(fileURLToPath(import.meta.url));
const snapshot = (cartId, items) => ({ cartId, items, itemCount: items.reduce((sum, line) => sum + line.quantity, 0),
  subtotal: items.reduce((sum, line) => sum + line.subtotal, 0), total: items.reduce((sum, line) => sum + line.subtotal, 0), discount: 0, freeShipping: false });
const line = (variantId, price = 100, quantity = 1) => ({ variantId, productName: variantId === "target" ? "Complemento aprovado" : "Existing", quantity, price, subtotal: price * quantity, optionItemIds: [] });
let carts, calls, pending, completed, mode, nextId;
function reset() {
  for (const entry of pending ?? []) entry.release();
  carts = new Map([["cart-a", snapshot("cart-a", [line("existing")])], ["cart-b", snapshot("cart-b", [line("replacement", 7)])], ["cart-c", snapshot("cart-c", [line("other-tenant", 13)])]]);
  calls = []; pending = []; completed = []; mode = "normal"; nextId = 0;
}
reset();
const send = (res, status, data) => { if (res.destroyed || res.writableEnded) return; res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
async function body(req) { let text = ""; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 32768) throw new Error("fixture_body_too_large"); } return text ? JSON.parse(text) : {}; }
async function hold(type) {
  const id = ++nextId; await new Promise(resolve => pending.push({ id, type, release: resolve }));
  pending = pending.filter(entry => entry.id !== id); completed.push({ id, type });
}
function quoted() {
  const cart = carts.get("cart-a"), items = cart.items.filter(item => item.variantId !== "target");
  const basis = items.map(item => ({ variantId: item.variantId, productId: `product-${item.variantId}`, sku: `sku-${item.variantId}`, name: item.productName, quantity: item.quantity, unitPriceCents: Math.round(item.price * 100) }));
  const currentTotal = items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);
  return { version: 1, merchantId: "merchant-a", cartId: "cart-a", variantId: "target", productId: "product-target", sku: "sku-target", promotionId: "promo", promotionUpdatedAt: "2026-10-19T00:00:00.000Z", quantity: 1,
    originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000, cartBasis: { items: basis, total: currentTotal, discount: 0, couponCode: null, freeShipping: false },
    quote: { currency: "BRL", originalSubtotalCents: currentTotal + 10000, promotionDiscountCents: 1000, subtotalCents: currentTotal + 9000, merchandiseTotalCents: currentTotal + 9000,
      items: [...basis.map(item => ({ variantId: item.variantId, productId: item.productId, quantity: item.quantity, baseUnitPriceCents: item.unitPriceCents, unitPriceCents: item.unitPriceCents })),
        { variantId: "target", productId: "product-target", quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 9000 }] } };
}

// Actual local HTTP, with explicitly synthetic state and responses. This is NOT
// Nest, Prisma, transactional authorization or any PSP/provider implementation.
export default {
  root, esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(root, "../../../src") }, dedupe: ["react", "react-dom"] },
  define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_BASE_URL: "/api/v1" }) },
  plugins: [{ name: "synthetic-joint-cart-cross-sell-http", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, "http://127.0.0.1:5199");
      try {
        if (url.pathname === "/__fixture/reset") { reset(); return send(res, 200, { synthetic: true }); }
        if (url.pathname === "/__fixture/mode") { mode = (await body(req)).mode; return send(res, 200, { synthetic: true, mode }); }
        if (url.pathname === "/__fixture/state") return send(res, 200, { synthetic: true, calls, pending: pending.map(({ id, type }) => ({ id, type })), completed });
        if (url.pathname === "/__fixture/release") { const input = await body(req), selected = pending.filter(entry => !input.type || entry.type === input.type);
          for (const entry of input.first ? selected.slice(0, 1) : selected) entry.release(); return send(res, 200, { synthetic: true }); }
        if (!url.pathname.startsWith("/api/")) return next();
        if (!req.headers.authorization?.startsWith("Bearer ")) return send(res, 403, { synthetic: true, error: "synthetic_capability_required" });
        const parts = url.pathname.split("/"), input = await body(req);
        if (parts.slice(0, 4).join("/") === "/api/storefront-proxy/cart") {
          const cartId = parts[4], merchantId = url.searchParams.get("merchantId");
          if (!carts.has(cartId) || merchantId !== (cartId === "cart-c" ? "merchant-b" : "merchant-a")) return send(res, 403, { synthetic: true, error: "synthetic_scope_denied" });
          calls.push({ method: req.method, path: url.pathname, merchantId, cartId, ...(req.method === "GET" ? {} : { body: input }) });
          if (req.method === "GET" && parts.length === 5) {
            const captured = structuredClone(carts.get(cartId));
            if (mode === "hold-get" && cartId === "cart-a") { mode = "normal"; await hold("get"); }
            return send(res, 200, captured);
          }
          if (req.method === "PATCH" && parts[5] === "items" && parts[6] === "existing" && cartId === "cart-a") {
            const selectedMode = mode; mode = "normal";
            const current = structuredClone(carts.get(cartId)), item = current.items.find(item => item.variantId === "existing");
            item.quantity = input.quantity; item.subtotal = item.price * input.quantity;
            const captured = snapshot(cartId, current.items), error = selectedMode === "hold-patch-error";
            if (!error) carts.set(cartId, captured);
            if (selectedMode.startsWith("hold-patch")) await hold("patch");
            return send(res, error ? 409 : 200, error ? { synthetic: true, error: "synthetic_stale_patch_error" } : captured);
          }
          return send(res, 404, { synthetic: true, error: "synthetic_cart_route_not_found" });
        }
        if (parts.length === 8 && parts[2] === "storefront-proxy" && parts[4] === "cart" && parts[6] === "cross-sell" && ["quote", "accept"].includes(parts[7]) && req.method === "POST") {
          const operation = parts[7], merchantId = parts[3], cartId = parts[5];
          calls.push({ method: req.method, path: url.pathname, merchantId, cartId, operation, body: input });
          if (merchantId !== "merchant-a" || cartId !== "cart-a") return send(res, 422, { synthetic: true, error: "synthetic_no_offer_in_replacement_scope" });
          if (operation === "quote") {
            if (mode === "hold-quote") { mode = "normal"; await hold("quote"); }
            if (carts.get("cart-a").items.some(item => item.variantId === "target")) return send(res, 409, { synthetic: true, error: "target_already_present" });
            return send(res, 200, quoted());
          }
          if (operation === "accept") {
            if (!isDeepStrictEqual(input.expectedQuote, quoted())) return send(res, 409, { synthetic: true, error: "quote_changed" });
            const current = carts.get("cart-a"); carts.set("cart-a", snapshot("cart-a", [...current.items.filter(item => item.variantId !== "target"), line("target", 90)]));
            const selectedMode = mode;
            if (selectedMode === "hold-accept" || selectedMode === "lost-accept") mode = "normal";
            if (selectedMode === "hold-accept") await hold("accept");
            if (selectedMode === "lost-accept") { res.writeHead(200, { "Content-Type": "application/json" }); res.write("{", () => res.destroy()); return; }
            return send(res, 200, { version: 1, status: "accepted", merchantId: "merchant-a", cartId: "cart-a" });
          }
        }
        calls.push({ method: req.method, path: url.pathname, unexpected: true, body: input });
        return send(res, 422, { synthetic: true, error: "synthetic_unsupported_route" });
      } catch { return send(res, 400, { synthetic: true, error: "synthetic_fixture_bad_request" }); }
    });
  } }],
  server: { host: "127.0.0.1", port: 5199, strictPort: true, fs: { allow: [path.resolve(root, "../../../../..")] } },
};
