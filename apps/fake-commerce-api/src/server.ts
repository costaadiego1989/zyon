import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import type { Cart, CartItem } from "@aacp/shared-types";

export type FakeProduct = Omit<CartItem, "quantity"> & {
  description: string;
  available: boolean;
};

export type ProductSelectionLine = {
  sku: string;
  quantity: number;
};

export const FAKE_PRODUCTS: FakeProduct[] = [
  {
    sku: "bag-001",
    name: "Bolsa Executiva Couro Safiano",
    price: 449.9,
    cost: 210,
    weightGrams: 900,
    imageUrl: "https://images.unsplash.com/photo-1594223274512-ad4803739b7c?w=640",
    productUrl: "https://loja.example.com/bolsa-executiva-couro-safiano",
    category: "Bolsas",
    variant: "Preta",
    description: "Bolsa premium para notebook e rotina executiva.",
    available: true
  },
  {
    sku: "wallet-001",
    name: "Carteira Minimalista RFID",
    price: 129.9,
    cost: 48,
    weightGrams: 180,
    imageUrl: "https://images.unsplash.com/photo-1627123424574-724758594e93?w=640",
    productUrl: "https://loja.example.com/carteira-rfid",
    category: "Acessorios",
    variant: "Grafite",
    description: "Carteira compacta com protecao RFID.",
    available: true
  }
];

export function searchFakeProducts(query: string, limit = 8): FakeProduct[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return FAKE_PRODUCTS.filter((item) => item.available).slice(0, limit);
  return FAKE_PRODUCTS.filter((item) => {
    if (!item.available) return false;
    const haystack = [item.name, item.description, item.category, item.variant, item.sku]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  }).slice(0, limit);
}

export function buildCheckoutCart(selection: ProductSelectionLine[]): Cart {
  if (!Array.isArray(selection) || selection.length === 0) {
    throw new HttpError(400, "selection_required");
  }

  const items = selection.map((line) => {
    const sku = typeof line.sku === "string" ? line.sku.trim() : "";
    const quantity = Number(line.quantity);
    if (!sku || !Number.isInteger(quantity) || quantity <= 0) {
      throw new HttpError(400, "selection_invalid");
    }
    const product = FAKE_PRODUCTS.find((item) => item.sku === sku && item.available);
    if (!product) throw new HttpError(404, `product_not_found:${sku}`);
    return {
      sku: product.sku,
      name: product.name,
      price: product.price,
      cost: product.cost,
      quantity,
      weightGrams: product.weightGrams,
      imageUrl: product.imageUrl,
      productUrl: product.productUrl,
      category: product.category,
      variant: product.variant,
      description: product.description?.slice(0, 100)
    } satisfies CartItem;
  });

  return {
    currency: "BRL",
    source: "platform_api",
    total: roundMoney(items.reduce((sum, item) => sum + item.price * item.quantity, 0)),
    items
  };
}

export function createFakeCommerceApiServer(): Server {
  return createServer(async (req, res) => {
    writeCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url ?? "/", "http://fake-commerce.local");
      if (req.method === "GET" && url.pathname === "/health") {
        writeJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && url.pathname === "/products") {
        writeJson(res, 200, { products: FAKE_PRODUCTS });
        return;
      }
      if (req.method === "GET" && url.pathname === "/products/search") {
        const query = url.searchParams.get("q") ?? "";
        const limit = Number(url.searchParams.get("limit") ?? "8");
        writeJson(res, 200, { products: searchFakeProducts(query, Number.isFinite(limit) ? limit : 8) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/checkout-cart") {
        const body = await readJson(req);
        const items = normalizeSelection(body);
        writeJson(res, 200, { cart: buildCheckoutCart(items) });
        return;
      }
      throw new HttpError(404, "route_not_found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : "unknown_error";
      writeJson(res, status, { error: message });
    }
  });
}

export async function startFakeCommerceApiServer(port = 0): Promise<{ server: Server; url: string }> {
  const server = createFakeCommerceApiServer();
  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake_commerce_listen_failed");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function normalizeSelection(body: unknown): ProductSelectionLine[] {
  if (!body || typeof body !== "object") throw new HttpError(400, "body_invalid");
  const raw = (body as { items?: unknown; selection?: unknown }).items ?? (body as { selection?: unknown }).selection;
  if (!Array.isArray(raw)) throw new HttpError(400, "selection_required");
  return raw.map((item) => {
    if (!item || typeof item !== "object") throw new HttpError(400, "selection_invalid");
    const rec = item as Record<string, unknown>;
    return { sku: String(rec.sku ?? ""), quantity: Number(rec.quantity) };
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function writeCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3010);
  const server = createFakeCommerceApiServer();
  server.listen(port, () => {
    console.log(`Fake commerce API listening on http://localhost:${port}`);
  });
}
