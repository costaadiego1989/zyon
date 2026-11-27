/** Container liveness; upstream API readiness is verified separately. */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "storefront" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
