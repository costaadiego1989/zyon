import type { Page } from "@playwright/test";
import { fiscalDetailFixture } from "./fiscal-fixture.js";
export async function fiscalShellFixture(page: Page, role = "OWNER") {
  const session = {
    merchantId: "merchant-a",
    name: "Loja A",
    role,
    authorized: true,
  };
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let value: unknown = {};
    if (path.endsWith("/merchants/me")) {
      if (!session.authorized)
        return route.fulfill({
          status: 401,
          json: { error: "unauthenticated" },
        });
      value = {
        id: session.merchantId,
        name: session.name,
        user_id: "owner-a",
        slug: "original-host",
        plan: "API",
        role: session.role,
      };
    } else if (path.endsWith("/auth/refresh"))
      return route.fulfill({ status: 401, json: { error: "expired" } });
    else if (path.endsWith("/merchants/me/stores"))
      value = {
        data: [
          { id: "merchant-a", name: "Loja A", slug: "host-a", role: "owner" },
          { id: "merchant-b", name: "Loja B", slug: "host-b", role: "owner" },
        ],
      };
    else if (path.endsWith("/stores/merchant-b/activate")) {
      session.merchantId = "merchant-b";
      session.name = "Loja B";
      value = {};
    } else if (path.endsWith("/store-settings"))
      value = { registration_pending: false, plan_selection_pending: false };
    else if (path.endsWith("/billing/subscription"))
      value = {
        plan: "scale",
        status: "active",
        trial_expired: false,
        features: {},
        limits: {},
      };
    else if (path.endsWith("/onboarding"))
      value = { completed: true, steps: [] };
    else if (path.endsWith("/domains")) value = [];
    else if (path.endsWith("/nav-counts"))
      value = { orders: 0, messages: 0, cartRecovery: 0 };
    else if (path.endsWith("/notifications")) value = { items: [] };
    return route.fulfill({ json: value });
  });
  const detail = await fiscalDetailFixture(page);
  await page.route("**/v1/merchants/me/fiscal/invoices?**", (r) =>
    r.fulfill({
      json: {
        items: [
          {
            id: "intent-a",
            orderId:
              session.merchantId === "merchant-a"
                ? "original-order"
                : "loja-b-order",
            recipientName: "Maria S.",
            provider: "focus",
            state: "authorized",
            deliveries: [],
          },
        ],
        total: 1,
        counts: { authorized: 1 },
        page: 1,
        pageSize: 20,
      },
    })
  );
  return { session, ...detail };
}
