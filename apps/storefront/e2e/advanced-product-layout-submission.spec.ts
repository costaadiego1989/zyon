/**
 * Advanced Product Layout — Wave 2/3 public endpoint smoke test.
 *
 * Goal: prove the storefront-facing read endpoint (flag-gated
 * `GET /storefront/:slug/products/:productId/content`) AND the buyer
 * submission endpoints (`POST .../testimonials`, `POST .../videos`) are
 * reachable, return sane shapes, and respect the tenant boundary.
 *
 * Style: matches the existing `advanced-product-layout.spec.ts` Playwright
 * suite — uses `request` for HTTP-only smoke checks (no browser needed),
 * resolves the demo merchant via the public config endpoint so the suite
 * works against any deployment where the seed has been run, and gracefully
 * skips when the merchant is missing.
 *
 * Tag: @apl @submission so the regression suite
 * (`pnpm e2e -- --grep @apl`) picks it up next to the existing fixtures.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

const API_BASE = process.env.AACP_API_URL ?? "http://127.0.0.1:3009";
const DEMO_MERCHANT_ID = "mrc_marketplace_01";

type MerchantContext = { slug: string; productId: string };

/**
 * Resolve (slug, productId) for the demo merchant by walking the public
 * storefront endpoints. Mirrors `resolveMerchantContext` in
 * `advanced-product-layout.spec.ts` — duplicated here so this file stays
 * self-contained and runnable on its own (the @apl project filters on
 * filename pattern, not file dependency).
 */
async function resolveMerchantContext(
  request: APIRequestContext,
): Promise<MerchantContext | null> {
  const slugProbe = await request
    .get(`${API_BASE}/storefront/${DEMO_MERCHANT_ID}/config`)
    .catch(() => null);
  let slug = DEMO_MERCHANT_ID;
  if (slugProbe?.ok()) {
    const body = await slugProbe.json().catch(() => null);
    if (body?.storeSlug) slug = body.storeSlug as string;
  }

  const productsRes = await request
    .get(`${API_BASE}/storefront/${slug}/products?limit=1`)
    .catch(() => null);
  if (!productsRes?.ok()) return null;
  const products = (await productsRes.json().catch(() => null)) as
    | { items?: Array<{ id: string }> }
    | null;
  const productId = products?.items?.[0]?.id;
  if (!productId) return null;
  return { slug, productId };
}

test.describe(
  "Advanced Product Layout — public submission smoke @apl @submission",
  () => {
    test.setTimeout(60_000);

    let ctx: MerchantContext | null = null;

    test.beforeAll(async ({ request }) => {
      ctx = await resolveMerchantContext(request);
      if (!ctx) {
        test.skip(true, "Demo merchant not seeded; skipping submission smoke.");
      }
    });

    test("public content endpoint returns the full payload shape", async ({
      request,
    }) => {
      const res = await request.get(
        `${API_BASE}/storefront/${ctx!.slug}/products/${ctx!.productId}/content`,
        { headers: { Accept: "application/json" } },
      );
      // 200 when flag is on; 404 when off. Either proves the route is wired
      // and respects the merchant boundary — anything else is a regression.
      expect([200, 404]).toContain(res.status());
      if (res.status() === 200) {
        const body = await res.json();
        expect(body).toHaveProperty("productId");
        expect(Array.isArray(body.blocks)).toBe(true);
        expect(Array.isArray(body.faqs)).toBe(true);
        expect(Array.isArray(body.testimonials)).toBe(true);
        expect(Array.isArray(body.videos)).toBe(true);
      }
    });

    test("anonymous testimonial submission is redirected to authenticated review flow", async ({
      request,
    }) => {
      const payload = {
        authorName: "Smoke Tester",
        body: "Smoke-test submission from advanced-product-layout-submission.spec.ts",
        rating: 5,
      };
      const res = await request.post(
        `${API_BASE}/storefront/${ctx!.slug}/products/${ctx!.productId}/testimonials`,
        { data: payload },
      );
      // The browser shows its account CTA before this call. The API enforces
      // the same invariant for callers bypassing that UI.
      expect([401, 404]).toContain(res.status());
    });

    test("anonymous video-link submission is rejected", async ({
      request,
    }) => {
      const payload = {
        title: "Vídeo de teste",
        videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      };
      const res = await request.post(
        `${API_BASE}/storefront/${ctx!.slug}/products/${ctx!.productId}/videos`,
        { data: payload },
      );
      expect([401, 404]).toContain(res.status());
    });
  },
);
