import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
  const apiBase = process.env.AACP_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3009";
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }

  let body: { merchant_id?: unknown; cart_ref?: unknown; allowed_origin?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body.merchant_id !== "string" || !body.merchant_id.trim() || body.merchant_id.length > 120) {
    return NextResponse.json({ error: "merchant_id_required" }, { status: 400 });
  }
  if (body.allowed_origin !== undefined && body.allowed_origin !== origin) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }
  // No browser proof currently binds an existing cart to this request. Native
  // checkout submits SKU + quantity; commerce cart capabilities need a merchant server.
  if (body.cart_ref !== undefined) {
    return NextResponse.json({ error: "cart_ownership_required" }, { status: 403 });
  }
  if (!serviceToken) {
    return NextResponse.json({ error: "service_not_configured" }, { status: 503 });
  }

  try {
    const response = await fetch(`${apiBase}/embed-sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Token": serviceToken,
        "X-Merchant-Id": body.merchant_id.trim(),
        "Idempotency-Key": `ck_${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        ttl_seconds: 900,
        // The API must resolve an active installation of this merchant for this origin.
        allowed_origin: origin,
        scopes: ["checkout:start", "checkout:track", "checkout:chat", "payment:intents:create", "payment:intents:confirm", "payment:intents:read", "offers:apply"],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return NextResponse.json({ error: "token_generation_failed" }, { status: response.status < 500 ? 403 : 502 });
    }
    const data = await response.json();
    if (typeof data.embed_session_token !== "string" || typeof data.expires_at_unix !== "number") {
      return NextResponse.json({ error: "token_generation_failed" }, { status: 502 });
    }
    return NextResponse.json({
      embed_session_token: data.embed_session_token,
      expires_at_unix: data.expires_at_unix,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "token_generation_failed" }, { status: 502 });
  }
}
