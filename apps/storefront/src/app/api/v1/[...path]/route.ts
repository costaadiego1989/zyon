import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.AACP_API_URL || "http://localhost:3009";
const API_KEY = process.env.AACP_SERVICE_API_KEY || "";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxyRequest(request, path, "GET");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxyRequest(request, path, "POST");
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxyRequest(request, path, "PATCH");
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxyRequest(request, path, "PUT");
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
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

  if (API_KEY) {
    headers["Authorization"] = `Bearer ${API_KEY}`;
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
    });

    const responseBody = await response.text();

    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
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
