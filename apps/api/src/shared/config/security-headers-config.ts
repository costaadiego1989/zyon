import { resolveCorsConfig } from "./cors-config.js";

export type SecurityHeaders = Record<string, string>;

/**
 * Static security headers for the JSON API surface. The API never returns HTML,
 * so the CSP is locked down to `default-src 'none'`. `frame-ancestors` is bound
 * to the same origin allowlist used by CORS so only approved storefronts may
 * embed responses; with no allowlist it falls back to `'none'` (fail safe).
 */
export function resolveSecurityHeaders(env: NodeJS.ProcessEnv = process.env): SecurityHeaders {
  const cors = resolveCorsConfig(env);
  const frameAncestors = Array.isArray(cors.origin) && cors.origin.length > 0 ? cors.origin.join(" ") : "'none'";

  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestors}`
  ].join("; ");

  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin"
  };
}
