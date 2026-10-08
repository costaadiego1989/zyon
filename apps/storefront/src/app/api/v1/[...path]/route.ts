import { NextRequest, NextResponse } from "next/server";
import { storefrontRequestOrigin } from "@/lib/platform-hostname";

const API_BASE_URL = process.env.AACP_API_URL || "http://localhost:3009";
const API_KEY = process.env.AACP_SERVICE_API_KEY || "";

const ALLOWED_PREFIXES = ["storefront/", "buyer/", "embed/", "checkout-settings/widget-config"];

function isPathAllowed(pathSegments: string[], method: string): boolean {
  const path = pathSegments.join("/");
  if (pathSegments.length === 3 && pathSegments[0] === "support" && pathSegments[1] === "attachments") {
    return method === "GET" && /^[A-Za-z0-9_-]{8,120}$/.test(pathSegments[2]!);
  }
  if (path === "support/faq/public" || path === "support/chat/public") return true;
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (!isPathAllowed(path, "GET")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return proxyRequest(request, path, "GET");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (!isPathAllowed(path, "POST")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return proxyRequest(request, path, "POST");
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (!isPathAllowed(path, "PATCH")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return proxyRequest(request, path, "PATCH");
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (!isPathAllowed(path, "PUT")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return proxyRequest(request, path, "PUT");
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (!isPathAllowed(path, "DELETE")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return proxyRequest(request, path, "DELETE");
}

async function proxyRequest(
  request: NextRequest,
  pathSegments: string[],
  method: string,
) {
  const path = pathSegments.join("/");
  const searchParams = request.nextUrl.searchParams.toString();
  const url = `${API_BASE_URL}/v1/${path}${searchParams ? `?${searchParams}` : ""}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Buyer-facing routes must preserve the buyer JWT. The service credential is
  // only a fallback for public routes that do not carry an end-user session.
  const authorization = request.headers.get("Authorization");
  if (authorization) headers.Authorization = authorization;
  else if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  for (const name of ["X-AI-User-Token", "X-Buyer-Authorization"]) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }

  const origin = request.headers.get("Origin");
  if (origin) headers.Origin = origin;
  // Preserve a verified browser origin when the public API gateway removes Origin.
  if (/^storefront\/[^/]+\/recovery$/.test(path)) {
    if (!origin || origin !== storefrontRequestOrigin(request)) return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
    const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
    if (serviceToken) {
      headers["X-Internal-Service-Token"] = serviceToken;
      headers["X-Trusted-Storefront-Origin"] = origin;
    }
  }
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  try {
    const body =
      method !== "GET" && method !== "HEAD"
        ? await request.text()
        : undefined;

    const response = await fetch(url, {
      method,
      headers,
      body,
      cache: "no-store",
    });

    // Private photo responses contain binary bytes. Decoding them as text
    // corrupts the image, even when the upstream content type is preserved.
    const responseBody = response.status === 204 || response.status === 304 ? null : await response.arrayBuffer();

    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
        "Cache-Control": path.startsWith("support/attachments/") ? "private, no-store" : "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        ...Object.fromEntries(
          ["X-AI-RateLimit-Limit", "X-AI-RateLimit-Remaining", "X-AI-RateLimit-Reset", "Retry-After"]
            .flatMap(name => {
              const value = response.headers.get(name);
              return value === null ? [] : [[name, value]];
            }),
        ),
        ...(response.headers.get("X-RateLimit-Limit") && {
          "X-RateLimit-Limit": response.headers.get("X-RateLimit-Limit")!,
        }),
        ...(response.headers.get("X-RateLimit-Remaining") && {
          "X-RateLimit-Remaining": response.headers.get("X-RateLimit-Remaining")!,
        }),
        ...(response.headers.get("X-RateLimit-Reset") && {
          "X-RateLimit-Reset": response.headers.get("X-RateLimit-Reset")!,
        }),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        type: "https://api.aacp.dev/errors/gateway_error",
        title: "Gateway Error",
        status: 502,
        code: "gateway_error",
        detail: "Failed to reach API server",
      },
      { status: 502 },
    );
  }
}
