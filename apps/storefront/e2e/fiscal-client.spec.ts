import { test, expect } from "@playwright/test";
import {
  readBuyerFiscalNavigation,
  safeFiscalBuyerHref,
} from "../src/lib/fiscal-navigation";
test("FISCAL-41 original host order environment and requested file survive navigation", () => {
  expect(
    readBuyerFiscalNavigation(
      "?buyerHub=orders&orderId=original%2Forder&fiscalIntentId=seller-intent&fiscalEnvironment=homologation&fiscalDocument=xml"
    )
  ).toEqual({
    orderId: "original/order",
    intentId: "seller-intent",
    environment: "homologation",
    document: "xml",
  });
});
test("FISCAL-44 fiscal navigation rejects external and credential-bearing URLs", () => {
  for (const href of [
    "https://evil.test/store/a?buyerHub=orders",
    "/store/a?buyerHub=orders&orderId=o&fiscalIntentId=i&fiscalEnvironment=production&token=secret",
    "javascript:alert(1)",
  ])
    expect(safeFiscalBuyerHref(href)).toBeNull();
});
test("FISCAL-44 supported assistant navigation remains relative and contains no bearer", () => {
  const href =
    "/store/original-host?buyerHub=orders&orderId=original-order&fiscalIntentId=seller-intent&fiscalEnvironment=production&fiscalDocument=danfe";
  expect(safeFiscalBuyerHref(href)).toBe(href);
});
test("FISCAL-43 incomplete navigation grants no fiscal target", () => {
  expect(readBuyerFiscalNavigation("?orderId=untrusted")).toBeNull();
  expect(
    readBuyerFiscalNavigation(
      "?buyerHub=orders&orderId=o&fiscalIntentId=i&fiscalEnvironment=invalid"
    )
  ).toBeNull();
});

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { findOwnedFiscalPurchase as lookup } from "../src/lib/services/buyer-fiscal.service";
import { fetchPurchases as purchases } from "../src/lib/services/buyer-hub.service";
import { API_BASE } from "../src/lib/services/http";

test.describe("buyer lookup HTTP cancellation", () => {
  let server: ReturnType<typeof createServer>;
  let origin: string;
  let handler: (request: IncomingMessage, response: ServerResponse) => void;

  test.beforeAll(async () => {
    server = createServer((request, response) => handler(request, response));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  test.afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  async function cancelInFlight(secondPage: boolean) {
    const merchant = "original/merchant", order = "original/order";
    const cursor = "original/page?cursor=2";
    const payload = Buffer.from(JSON.stringify({ sub: "original-buyer", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
    const token = `synthetic.${payload}.signature`;
    const storage = new Map([["zyon_buyer_token", token]]);
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const nativeFetch = globalThis.fetch;
    const signals: Array<AbortSignal | null | undefined> = [];
    const requests: Array<{ method: string | undefined; path: string; limit: string | null; cursor: string | null; merchant: string | null; authorization: string | undefined }> = [];
    let arrived!: () => void, closed!: () => void;
    const inFlight = new Promise<void>(resolve => { arrived = resolve; });
    const transportClosed = new Promise<void>(resolve => { closed = resolve; });
    let pendingResponse: ServerResponse | undefined, endedNormally = true, socketDestroyed = false;
    let compatibility = false;
    const owned = { merchant_id: merchant, order_id: order };
    handler = (request, response) => {
      const url = new URL(request.url!, origin);
      requests.push({ method: request.method, path: url.pathname, limit: url.searchParams.get("limit"), cursor: url.searchParams.get("cursor"), merchant: url.searchParams.get("merchant_id"), authorization: request.headers.authorization });
      if (compatibility || secondPage && !url.searchParams.has("cursor")) {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(compatibility ? { items: [owned], next_cursor: null } : {
          items: [{ merchant_id: merchant, order_id: "another-order" }, { merchant_id: "another-merchant", order_id: order }], next_cursor: cursor,
        }));
        return;
      }
      pendingResponse = response;
      response.once("close", () => {
        endedNormally = response.writableEnded;
        socketDestroyed = request.socket.destroyed;
        closed();
      });
      arrived();
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    } });
    globalThis.fetch = (input, init) => {
      signals.push(init?.signal);
      const url = new URL(input instanceof Request ? input.url : String(input), origin);
      return nativeFetch(new URL(url.pathname + url.search, origin), init);
    };
    const controller = new AbortController();
    const outcome = lookup(merchant, order, controller.signal).then(
      value => ({ kind: "resolved", value }),
      error => ({ kind: "rejected", name: error.name })
    );
    try {
      expect(await Promise.race([inFlight.then(() => "in-flight"), outcome.then(() => "settled-before-request")])).toBe("in-flight");
      controller.abort();
      expect(signals.map(signal => signal === controller.signal), "the original signal must reach every real native fetch").toEqual(Array(secondPage ? 2 : 1).fill(true));
      expect(await outcome).toEqual({ kind: "rejected", name: "AbortError" });
      await transportClosed;
      expect(endedNormally).toBe(false);
      expect(socketDestroyed).toBe(true);
      const request = { method: "GET", path: new URL(`${API_BASE}/buyer/me/purchases`, origin).pathname, limit: "100", cursor: null, merchant, authorization: `Bearer ${token}` };
      expect(requests).toEqual(secondPage ? [request, { ...request, cursor }] : [request]);
      if (!secondPage) {
        compatibility = true;
        expect(await purchases("", 10, merchant)).toEqual({ items: [owned], next_cursor: null });
        expect(signals.at(-1)).toBeUndefined();
        expect(requests).toEqual([request, { ...request, limit: "10" }]);
      }
    } finally {
      controller.abort();
      pendingResponse?.destroy();
      server.closeAllConnections();
      await outcome;
      globalThis.fetch = nativeFetch;
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else Reflect.deleteProperty(globalThis, "window");
      if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  }

  test("FISCAL-85 cancels the native first-page request and preserves callers without a signal", async () => {
    await cancelInFlight(false);
  });
  test("FISCAL-85 cancels an in-flight second page without resolving another order or requesting page three", async () => {
    await cancelInFlight(true);
  });
});
