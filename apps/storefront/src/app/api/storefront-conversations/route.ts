import { NextResponse } from "next/server";

interface ConversationStartBody {
  merchant_id?: unknown;
}

function validMerchantId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 120;
}

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }

  let body: ConversationStartBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!validMerchantId(body?.merchant_id)) {
    return NextResponse.json({ error: "merchant_id_required" }, { status: 400 });
  }

  const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
  const apiBase = process.env.AACP_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3009";
  if (!serviceToken) {
    return NextResponse.json({ error: "service_not_configured" }, { status: 503 });
  }

  try {
    const response = await fetch(`${apiBase}/storefront/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Token": serviceToken,
        "X-Trusted-Storefront-Origin": origin,
      },
      body: JSON.stringify({ merchant_id: body.merchant_id.trim() }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return NextResponse.json({ error: "conversation_start_failed" }, { status: response.status < 500 ? 403 : 502 });
    }

    const data = await response.json();
    if (typeof data.conversation_id !== "string" || typeof data.conversation_token !== "string") {
      return NextResponse.json({ error: "conversation_start_failed" }, { status: 502 });
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "conversation_start_failed" }, { status: 502 });
  }
}
