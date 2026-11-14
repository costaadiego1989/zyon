import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
const item = (id, name, quantity = 2) => ({ variantId: "same-variant", productName: "Camiseta", quantity, price: 20, subtotal: quantity * 20,
  optionItemIds: [id], serviceSlotId: null, selectionLabel: `Cor: ${name}` });
const snapshot = (cartId, items) => ({ cartId, items, itemCount: items.reduce((sum, line) => sum + line.quantity, 0),
  subtotal: items.reduce((sum, line) => sum + line.subtotal, 0), total: items.reduce((sum, line) => sum + line.subtotal, 0), discount: 0 });
let carts, calls, mode, pending;
const reset = () => { for (const release of pending ?? []) release?.();
  carts = new Map([["cart-a", snapshot("cart-a", [item("blue", "Azul"), item("red", "Vermelho")])],
    ["cart-b", snapshot("cart-b", [item("green", "Verde", 1)])], ["cart-c", snapshot("cart-c", [item("yellow", "Amarelo", 1)])]]);
  calls = []; mode = "normal"; pending = []; };
reset();
const body = async req => { let text = ""; for await (const chunk of req) { text += chunk; if (text.length > 4096) throw new Error("synthetic_fixture_body_too_large"); }
  return text ? JSON.parse(text) : {}; };
const send = (res, status, data) => { if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
// Real local HTTP transport; state/errors are explicitly synthetic, not Nest,
// Prisma, booking, merchant JWT verification or production/provider evidence.
export default {
  root, esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(root, "../../../src") }, dedupe: ["react", "react-dom"] },
  define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_BASE_URL: "/api/v1" }) },
  plugins: [{ name: "synthetic-cart-identity-http", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, "http://127.0.0.1:5198");
      try {
        if (url.pathname === "/__fixture/reset") { reset(); return send(res, 200, { synthetic: true }); }
        if (url.pathname === "/__fixture/mode") { mode = (await body(req)).mode; return send(res, 200, { synthetic: true, mode }); }
        if (url.pathname === "/__fixture/release") { const value = await body(req); if (value.first) { const release = pending.find(Boolean); if (release) { pending[pending.indexOf(release)] = null; release(); } }
          else { for (const release of pending) release?.(); pending = []; } return send(res, 200, { synthetic: true }); }
        if (url.pathname === "/__fixture/state") return send(res, 200, { synthetic: true, calls, pending: pending.filter(Boolean).length });
        if (!url.pathname.startsWith("/api/")) return next();
        const parts = url.pathname.split("/"), cartId = parts[4], merchantId = url.searchParams.get("merchantId");
        if (parts.slice(0, 4).join("/") !== "/api/storefront-proxy/cart" || !carts.has(cartId)
          || merchantId !== (cartId === "cart-c" ? "merchant-b" : "merchant-a") || !req.headers.authorization?.startsWith("Bearer "))
          return send(res, 403, { synthetic: true, error: "synthetic_scope_denied" });
        if (req.method === "GET" && parts.length === 5) { calls.push({ method: "GET", cartId, merchantId });
          if (mode === "wrong-bootstrap") { mode = "normal"; return send(res, 200, { ...carts.get(cartId), cartId: "foreign-cart" }); }
          return send(res, 200, carts.get(cartId)); }
        if (req.method !== "PATCH" || parts[5] !== "items" || parts[6] !== "same-variant") return send(res, 404, { synthetic: true });
        const input = await body(req), selectedMode = mode; mode = "normal"; calls.push({ method: "PATCH", cartId, merchantId, body: input });
        const current = structuredClone(carts.get(cartId));
        const matches = current.items.map((line, index) => ({ line, index })).filter(({ line }) => input.optionItemIds === undefined
          || JSON.stringify([...line.optionItemIds].sort()) === JSON.stringify([...input.optionItemIds].sort()));
        let status = 200, result;
        if (selectedMode === "error" || selectedMode === "hold-error") { status = 409; result = { synthetic: true, error: "synthetic_catalog_changed" }; }
        else if (matches.length !== 1) { status = 409; result = { synthetic: true, error: "cart_option_line_selection_required" }; }
        else {
          const index = matches[0].index;
          if (input.quantity === 0) current.items.splice(index, 1);
          else { current.items[index].quantity = input.quantity; current.items[index].subtotal = input.quantity * current.items[index].price; }
          result = snapshot(cartId, current.items); carts.set(cartId, result);
          if (selectedMode === "wrong-cart") result = { ...result, cartId: "foreign-cart" };
        }
        if (selectedMode === "hold-success" || selectedMode === "hold-error") await new Promise(resolve => pending.push(resolve));
        return send(res, status, result);
      } catch { return send(res, 400, { synthetic: true, error: "synthetic_fixture_bad_request" }); }
    });
  } }],
  server: { host: "127.0.0.1", port: 5198, strictPort: true, fs: { allow: [path.resolve(root, "../../../../..")] } },
};
