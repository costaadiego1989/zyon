import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSecurityHeaders } from "./security-headers-config.js";

describe("resolveSecurityHeaders", () => {
  it("locks the CSP to default-src 'none' and binds frame-ancestors to the CORS allowlist", () => {
    const headers = resolveSecurityHeaders({
      NODE_ENV: "production",
      CORS_ALLOWED_ORIGINS: "https://a.example,https://b.example"
    } as NodeJS.ProcessEnv);

    const csp = headers["Content-Security-Policy"];
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /frame-ancestors https:\/\/a\.example https:\/\/b\.example/);
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["X-Frame-Options"], "DENY");
  });

  it("fails safe to frame-ancestors 'none' in production without an allowlist", () => {
    const headers = resolveSecurityHeaders({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  });
});
