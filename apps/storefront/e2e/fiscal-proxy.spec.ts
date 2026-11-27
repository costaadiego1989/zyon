import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import { GET } from "../src/app/api/v1/[...path]/route";
test("FISCAL-44 real same-origin fiscal proxy preserves private binary PDF and buyer bearer", async () => {
  const previous = globalThis.fetch;
  const bytes = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x80, 0x01,
  ]);
  let auth = "";
  globalThis.fetch = async (_u, init) => {
    auth = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=nota-fiscal.pdf",
        "x-content-type-options": "nosniff",
      },
    });
  };
  try {
    const r = await GET(
      new NextRequest(
        "http://localhost:3001/api/v1/buyer/me/orders/host/order/fiscal/intent/documents/danfe?environment=homologation",
        { headers: { authorization: "Bearer original-buyer" } }
      ),
      {
        params: Promise.resolve({
          path: [
            "buyer",
            "me",
            "orders",
            "host",
            "order",
            "fiscal",
            "intent",
            "documents",
            "danfe",
          ],
        }),
      }
    );
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([...bytes]);
    expect(auth).toBe("Bearer original-buyer");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  } finally {
    globalThis.fetch = previous;
  }
});
test("FISCAL-44 same-origin fiscal proxy encodes original commercial order without changing path scope", async () => {
  const previous = globalThis.fetch;
  let target = "";
  globalThis.fetch = async (u) => {
    target = String(u);
    return Response.json({ items: [] });
  };
  try {
    const r = await GET(
      new NextRequest(
        "http://localhost:3001/api/v1/buyer/me/orders/host/original%2Forder/fiscal?environment=homologation"
      ),
      {
        params: Promise.resolve({
          path: ["buyer", "me", "orders", "host", "original/order", "fiscal"],
        }),
      }
    );
    expect(r.status).toBe(200);
    expect(target).toContain(
      "/v1/buyer/me/orders/host/original%2Forder/fiscal?environment=homologation"
    );
  } finally {
    globalThis.fetch = previous;
  }
});
