import { expect, test, type Page } from "@playwright/test";

function order(id: string) {
  return { id, order_id: `order-${id}`, merchant_name: "Loja QA", items: [{ name: `Compra ${id}`, quantity: 1, unit_price: 40 }],
    items_count: 1, total: 40, currency: "BRL", created_at: "2026-10-05T10:00:00Z" };
}
async function login(page: Page) {
  // Synthetic local auth for mocked API guard tests, never a production login.
  await page.addInitScript(() => localStorage.setItem("zyon_buyer_token", `header.${btoa(JSON.stringify({ sub: "buyer-1", exp: Date.now() / 1000 + 3600 }))}.signature`));
}
test("pages are scoped to the store; failed next page preserves data and retry cursor", async ({ page }) => {
  await login(page);
  const cursors: string[] = [];
  await page.route("**/api/buyer/me**", route => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith("/purchases")) return route.fulfill({ json: {} });
    expect(url.searchParams.get("merchant_id")).toBe("qa-store");
    expect(url.searchParams.get("limit")).toBe("10");
    cursors.push(url.searchParams.get("cursor") ?? "");
    if (cursors.length === 2) return route.fulfill({ status: 503, json: { message: "internal error details" } });
    return route.fulfill({ json: cursors.length === 1 ? { items: [order("A")], next_cursor: "page:2" }
      : { items: [order("A"), order("B")], next_cursor: null } });
  });
  await page.goto("/");
  await expect(page.getByText("Compra A", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mais pedidos" }).click();
  await expect(page.getByRole("alert")).toContainText("Não foi possível carregar seus pedidos");
  await expect(page.getByText("Compra A", { exact: true })).toBeVisible();
  await expect(page.getByText("internal error details")).toHaveCount(0);
  await page.getByRole("button", { name: "Mais pedidos" }).click();
  await expect(page.getByText("Compra B", { exact: true })).toBeVisible();
  await expect(page.getByText("Compra A", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Mais pedidos" })).toHaveCount(0);
  expect(cursors).toEqual(["", "page:2", "page:2"]);
});
test("a late response from the former store cannot repopulate purchases", async ({ page }) => {
  await login(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let done!: () => void;
  const delivered = new Promise<void>(resolve => { done = resolve; });
  await page.route("**/api/buyer/me**", async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith("/purchases")) return route.fulfill({ json: {} });
    if (url.searchParams.get("merchant_id") === "qa-store") {
      await held; await route.fulfill({ json: { items: [order("A")], next_cursor: "old-page" } }); done(); return;
    }
    expect(url.searchParams.get("merchant_id")).toBe("another-store");
    return route.fulfill({ json: { items: [], next_cursor: null } });
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toBeVisible();
  await page.getByRole("button", { name: "Outra loja" }).click();
  await expect(page.getByText("Nenhum pedido")).toBeVisible();
  release(); await delivered;
  await page.waitForTimeout(100);
  await expect(page.getByText("Compra A", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mais pedidos" })).toHaveCount(0);
});
test("logout invalidates an outstanding purchase request", async ({ page }) => {
  await login(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/buyer/me**", async route => {
    if (!new URL(route.request().url()).pathname.endsWith("/purchases")) return route.fulfill({ json: {} });
    await held; return route.fulfill({ json: { items: [order("A")], next_cursor: null } });
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toBeVisible();
  await page.getByRole("button", { name: "Sair" }).click();
  release(); await page.waitForTimeout(150);
  await expect(page.getByRole("region", { name: "Pedidos" })).toHaveCount(0);
  await expect(page.getByText("Compra A", { exact: true })).toHaveCount(0);
});
test("reopening the account fetches the current purchase history", async ({ page }) => {
  await login(page);
  let requests = 0;
  await page.route("**/api/buyer/me**", route => {
    if (!new URL(route.request().url()).pathname.endsWith("/purchases")) return route.fulfill({ json: {} });
    return route.fulfill({ json: { items: ++requests === 1 ? [order("A")] : [], next_cursor: null } });
  });
  await page.goto("/");
  await expect(page.getByText("Compra A", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fechar conta" }).click();
  await page.getByRole("button", { name: "Abrir conta" }).click();
  await expect(page.getByText("Nenhum pedido")).toBeVisible();
  expect(requests).toBe(2);
});
