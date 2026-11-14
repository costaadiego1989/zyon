import { expect, test, type Page } from "@playwright/test";

function shipment(id: string) {
  const item = { name: `Entrega ${id}`, quantity: 1, unit_price: 40 };
  return { id, order_id: `order-${id}`, merchant_name: "Loja QA", has_tracking: true,
    tracking_code: `QA${id}123456789BR`, tracking_status: "in_transit", carrier: "Transportadora QA",
    tracking_items: [item], tracking_events: [], items: [item], items_count: 1,
    total: 40, currency: "BRL", created_at: "2026-10-05T10:00:00Z" };
}

async function login(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("zyon_buyer_token", `header.${btoa(JSON.stringify({ sub: "buyer-1", exp: Date.now() / 1000 + 3600 }))}.signature`);
  });
}

test("tracking loads every page within the current store", async ({ page }) => {
  await login(page);
  const requests: string[] = [];
  await page.route("**/api/buyer/me**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith("/purchases")) return route.fulfill({ json: {} });
    expect(url.searchParams.get("merchant_id")).toBe("qa-store");
    expect(url.searchParams.get("limit")).toBe("100");
    requests.push(url.searchParams.get("cursor") ?? "");
    return route.fulfill({ json: requests.length === 1
      ? { items: [shipment("A")], next_cursor: "next:page/2" }
      : { items: [shipment("B")], next_cursor: null } });
  });
  await page.goto("/");
  await expect(page.getByText(/Entrega A/)).toBeVisible();
  await expect(page.getByText(/Entrega B/)).toBeVisible();
  expect(requests).toEqual(["", "next:page/2"]);
});

test("a repeated cursor fails explicitly instead of showing an incomplete list", async ({ page }) => {
  await login(page);
  let requests = 0;
  await page.route("**/api/buyer/me**", async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/purchases")) return route.fulfill({ json: {} });
    requests++;
    return route.fulfill({ json: { items: [shipment("A")], next_cursor: "same-cursor" } });
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Não foi possível carregar suas entregas");
  await expect(page.getByText(/Entrega A/)).toHaveCount(0);
  expect(requests).toBe(2);
});

test("a failed request can be retried through the interface", async ({ page }) => {
  await login(page);
  let requests = 0;
  await page.route("**/api/buyer/me**", async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/purchases")) return route.fulfill({ json: {} });
    if (++requests === 1) return route.fulfill({ status: 503, json: { message: "unavailable" } });
    return route.fulfill({ json: { items: [shipment("A")], next_cursor: null } });
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.getByText(/Entrega A/)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a late response from the previous store cannot repopulate tracking", async ({ page }) => {
  await login(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let oldResponseDone!: () => void;
  const oldResponse = new Promise<void>((resolve) => { oldResponseDone = resolve; });
  await page.route("**/api/buyer/me**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith("/purchases")) return route.fulfill({ json: {} });
    if (url.searchParams.get("merchant_id") === "qa-store") {
      await held;
      await route.fulfill({ json: { items: [shipment("A")], next_cursor: null } });
      oldResponseDone();
      return;
    }
    expect(url.searchParams.get("merchant_id")).toBe("another-store");
    return route.fulfill({ json: { items: [], next_cursor: null } });
  });
  await page.goto("/");
  await expect(page.getByText(/Carregando/)).toBeVisible();
  await page.getByRole("button", { name: "Outra loja", exact: true }).click();
  await expect(page.getByText("Nenhuma entrega com rastreio", { exact: true })).toBeVisible();
  release(); await oldResponse;
  await page.waitForTimeout(100);
  await expect(page.getByText(/Entrega A/)).toHaveCount(0);
  await expect(page.getByText("Nenhuma entrega com rastreio", { exact: true })).toBeVisible();
});

test("logging out during a request discards the former buyer's response", async ({ page }) => {
  await login(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/buyer/me**", async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/purchases")) return route.fulfill({ json: {} });
    await held;
    return route.fulfill({ json: { items: [shipment("A")], next_cursor: null } });
  });
  await page.goto("/");
  await expect(page.getByText(/Carregando/)).toBeVisible();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  release();
  await page.waitForTimeout(150);
  await expect(page.getByText(/Entrega A/)).toHaveCount(0);
  await expect(page.getByText("QA A123456789BR", { exact: true })).toHaveCount(0);
});

test("reopening the account refreshes delivery updates", async ({ page }) => {
  await login(page);
  let requests = 0;
  await page.route("**/api/buyer/me**", async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/purchases")) return route.fulfill({ json: {} });
    requests++;
    return route.fulfill({ json: { items: requests === 1 ? [shipment("A")] : [], next_cursor: null } });
  });
  await page.goto("/");
  await expect(page.getByText(/Entrega A/)).toBeVisible();
  await page.getByRole("button", { name: "Fechar conta", exact: true }).click();
  await page.getByRole("button", { name: "Abrir conta", exact: true }).click();
  await expect(page.getByText("Nenhuma entrega com rastreio", { exact: true })).toBeVisible();
  await expect(page.getByText(/Entrega A/)).toHaveCount(0);
  expect(requests).toBe(2);
});
