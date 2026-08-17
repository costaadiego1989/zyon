import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN;
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3009";
  try {
    const body = await request.json();
    const { merchant_id, cart_ref, allowed_origin } = body as {
      merchant_id?: string;
      cart_ref?: string;
      allowed_origin?: string;
    };

    if (!merchant_id) {
      return NextResponse.json({ error: "merchant_id_required" }, { status: 400 });
    }

    if (!INTERNAL_SERVICE_TOKEN) {
      console.error("[checkout-token] INTERNAL_SERVICE_TOKEN not configured. Env value:", typeof INTERNAL_SERVICE_TOKEN, "process.env keys with INTERNAL:", Object.keys(process.env).filter(k => k.includes("INTERNAL")).join(","));
      return NextResponse.json({ error: "service_not_configured" }, { status: 500 });
    }

    const url = `http://127.0.0.1:3009/embed-sessions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
      "X-Merchant-Id": merchant_id,
      "Idempotency-Key": `ck_${crypto.randomUUID()}`,
    };
    const bodyStr = JSON.stringify({
      ttl_seconds: 3600,
      cart_ref: cart_ref || undefined,
      scopes: [
        "checkout:start",
        "checkout:track",
        "checkout:chat",
      ],
    });
    console.log("[checkout-token] fetch:", url, "headers:", JSON.stringify(Object.keys(headers)), "body length:", bodyStr.length);

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: bodyStr,
      cache: "no-store",
    } as RequestInit);

    const resStatus = res.status;
    const resText = await res.text();
    console.log("[checkout-token] API response:", resStatus, resText.slice(0, 200));

    if (resStatus < 200 || resStatus >= 300) {
      console.error("[checkout-token] API error:", resStatus, resText);
      return NextResponse.json({ error: "token_generation_failed" }, { status: 502 });
    }

    const data = JSON.parse(resText);
    console.log("[checkout-token] SUCCESS - token generated");
    return NextResponse.json({
      embed_session_token: data.embed_session_token,
      expires_at_unix: data.expires_at_unix,
    });
  } catch (err) {
    console.error("[checkout-token] Error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
