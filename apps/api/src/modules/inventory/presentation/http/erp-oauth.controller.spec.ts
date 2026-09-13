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

test("ERP OAuth callback redirects dashboard errors to DASHBOARD_URL", async (t) => {
  const previousDashboardUrl = process.env.DASHBOARD_URL;
  process.env.DASHBOARD_URL = "https://app.example.com/settings?tab=integrations";
  t.after(() => {
    if (previousDashboardUrl === undefined) delete process.env.DASHBOARD_URL;
    else process.env.DASHBOARD_URL = previousDashboardUrl;
  });

  const controller = new ErpOAuthController({} as never, {} as never, {} as never);

  const denied = responseCapture();
  await controller.callback("", "", denied.response);
  assert.deepEqual(denied.redirects, [[302, "https://app.example.com/settings?tab=integrations&error=erp_denied"]]);

  const csrf = responseCapture();
  await controller.callback("code", "invalid-state", csrf.response);
  assert.deepEqual(csrf.redirects, [[302, "https://app.example.com/settings?tab=integrations&error=erp_csrf"]]);
});
