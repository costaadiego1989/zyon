import assert from "node:assert/strict";
import test from "node:test";
import { ErpOAuthController } from "./erp-oauth.controller.js";

function responseCapture() {
  const redirects: Array<[number, string]> = [];
  return {
    redirects,
    response: { redirect: (status: number, url: string) => redirects.push([status, url]) },
  };
}

test("ERP OAuth callback redirects errors to the Inventory deep link", async (t) => {
  const previousDashboardUrl = process.env.DASHBOARD_URL;
  process.env.DASHBOARD_URL = "https://app.example.com/settings?tab=integrations";
  t.after(() => {
    if (previousDashboardUrl === undefined) delete process.env.DASHBOARD_URL;
    else process.env.DASHBOARD_URL = previousDashboardUrl;
  });

  const controller = new ErpOAuthController({} as never, {} as never, {} as never);

  const denied = responseCapture();
  await controller.callback("", "", denied.response);
  assert.deepEqual(denied.redirects, [[302, "https://app.example.com/settings?tab=integrations&error=erp_denied#inventory"]]);

  const csrf = responseCapture();
  await controller.callback("code", "invalid-state", csrf.response);
  assert.deepEqual(csrf.redirects, [[302, "https://app.example.com/settings?tab=integrations&error=erp_csrf#inventory"]]);
});

test("Bling permission refusals are preserved without exchanging a token or changing a store", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("provider_must_not_be_called"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const controller = new ErpOAuthController({} as never, {} as never, {} as never);
  const auth = await controller.authorize({ user: { merchantId: "child-store" } }, "bling");
  const state = new URL(auth.url).searchParams.get("state")!;

  for (const error of ["FORBIDDEN", "UNAUTHORIZED_ERROR", "insufficient_scope"]) {
    const result = responseCapture();
    await controller.callback("", state, result.response, undefined, error);
    const redirect = new URL(result.redirects[0][1]);
    assert.equal(result.redirects[0][0], 302);
    assert.equal(redirect.searchParams.get("error"), "erp_permission_denied");
    assert.equal(redirect.searchParams.get("erp_provider"), "bling");
    assert.equal(redirect.hash, "#inventory");
  }
});

test("provider error callbacks require valid state and never forward arbitrary provider text", async () => {
  const controller = new ErpOAuthController({} as never, {} as never, {} as never);
  const auth = await controller.authorize({ user: { merchantId: "child-store" } }, "bling");
  const state = new URL(auth.url).searchParams.get("state")!;
  for (const [error, expected] of [["access_denied", "erp_denied"], ["app_inativo", "erp_app_inactive"], ["private provider details", "erp_authorization_failed"]]) {
    const result = responseCapture();
    await controller.callback("", state, result.response, undefined, error);
    assert.equal(new URL(result.redirects[0][1]).searchParams.get("error"), expected);
  }
  const invalid = responseCapture();
  await controller.callback("", "invalid", invalid.response, undefined, "FORBIDDEN");
  assert.equal(new URL(invalid.redirects[0][1]).searchParams.get("error"), "erp_csrf");
});
