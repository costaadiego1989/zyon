/**
 * Advanced Product Layout — k6 load test
 *
 * Targets the public product-content endpoint:
 *   GET /storefront/:slug/products/:productId/content
 *
 * Profile:
 *   - 100 virtual users ramping over 30s, sustained for 30s, ramp-down 10s
 *   - Acceptance threshold: p95 < 300ms
 *   - Built-in `http_req_duration` trend metric; `Trend` is also emitted as
 *     `content_load_ms` for explicit thresholds.
 *
 * Run:
 *   k6 run \
 *     -e STOREFRONT_SLUG=marketplace-01 \
 *     -e PRODUCT_ID=prd_xxx \
 *     -e BASE_URL=http://127.0.0.1:3009 \
 *     apps/api/e2e/advanced-product-layout.perf.k6.js
 *
 * Required env (any unset var skips the run with a clear error):
 *   STOREFRONT_SLUG — public merchant slug (e.g. "marketplace-01")
 *   PRODUCT_ID      — a real product id for that merchant
 *   BASE_URL        — API origin (default http://127.0.0.1:3009)
 */
import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3009";
const SLUG = __ENV.STOREFRONT_SLUG;
const PRODUCT_ID = __ENV.PRODUCT_ID;

if (!SLUG || !PRODUCT_ID) {
  throw new Error(
    "Missing required env: STOREFRONT_SLUG and PRODUCT_ID must be set.\n" +
      "Example:\n" +
      "  k6 run -e STOREFRONT_SLUG=marketplace-01 -e PRODUCT_ID=prd_xxx " +
      "apps/api/e2e/advanced-product-layout.perf.k6.js",
  );
}

const contentLoadMs = new Trend("content_load_ms", true);

export const options = {
  scenarios: {
    burst: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 100 },
        { duration: "30s", target: 100 },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<300"],
    content_load_ms: ["p(95)<300"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const url = `${BASE_URL}/storefront/${encodeURIComponent(SLUG)}/products/${encodeURIComponent(PRODUCT_ID)}/content`;
  const res = http.get(url, {
    headers: { Accept: "application/json" },
    tags: { endpoint: "storefront-product-content" },
  });

  // We don't want the load test to gate on 404s (e.g. wrong product id) — we
  // gate on response time and successful shape. Mark the 200s explicitly.
  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "body has blocks array": (r) => {
      try {
        const body = r.json();
        return Array.isArray(body && body.blocks);
      } catch (_) {
        return false;
      }
    },
  });

  contentLoadMs.add(res.timings.duration);
  // Surface per-check result for the summary report.
  if (!ok) {
    console.warn(`Non-200 or malformed body: status=${res.status}`);
  }
}
