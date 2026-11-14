import { expect, test } from "@playwright/test";

const state = async (page: import("@playwright/test").Page) => JSON.parse(await page.getByTestId("state").textContent() ?? "{}");
test.beforeEach(async ({ page, request }) => {
  await request.post("/__fixture/reset");
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:5198" ? route.continue() : route.abort());
  await page.goto("/"); await expect(page.getByTestId("scope")).toHaveText("merchant-a/cart-a");
  await expect(page.getByRole("button", { name: "Aumentar quantidade de Camiseta — Cor: Azul" })).toBeEnabled();
});
test("real CartSheet updates and removes only the selected equal-price color over local HTTP", async ({ page, request }) => {
  const plusBlue = page.getByRole("button", { name: "Aumentar quantidade de Camiseta — Cor: Azul" });
  await plusBlue.click(); await expect.poll(async () => (await state(page)).cart.items.map((item: any) => item.quantity)).toEqual([3, 2]);
  const minusRed = page.getByRole("button", { name: "Diminuir quantidade de Camiseta — Cor: Vermelho" });
  await minusRed.click(); await expect.poll(async () => (await state(page)).cart.items.map((item: any) => item.quantity)).toEqual([3, 1]);
  await minusRed.click(); await expect.poll(async () => (await state(page)).cart.items.map((item: any) => item.optionItemIds)).toEqual([["blue"]]);
  const calls = (await (await request.get("/__fixture/state")).json()).calls.filter((call: any) => call.method === "PATCH");
  expect(calls.map((call: any) => call.body)).toEqual([
    { quantity: 3, optionItemIds: ["blue"], serviceSlotId: null }, { quantity: 1, optionItemIds: ["red"], serviceSlotId: null },
    { quantity: 0, optionItemIds: ["red"], serviceSlotId: null }]);
});
for (const outcome of ["error", "ambiguous", "wrong-cart"]) test(`${outcome} response keeps every existing line`, async ({ page, request }) => {
  if (outcome === "ambiguous") await page.getByTestId("ambiguous").click();
  else { await request.post("/__fixture/mode", { data: { mode: outcome } });
    await page.getByRole("button", { name: "Aumentar quantidade de Camiseta — Cor: Azul" }).click(); }
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await state(page)).cart.items.map((item: any) => [item.optionItemIds, item.quantity])).toEqual([[["blue"], 2], [["red"], 2]]);
});
for (const replacement of ["cart", "merchant"]) for (const outcome of ["hold-success", "hold-error"]) {
  test(`late ${outcome} cannot overwrite replacement ${replacement} or clear its state`, async ({ page, request }) => {
    await request.post("/__fixture/mode", { data: { mode: outcome } });
    await page.getByRole("button", { name: "Aumentar quantidade de Camiseta — Cor: Azul" }).click();
    await expect.poll(async () => (await (await request.get("/__fixture/state")).json()).pending).toBe(1);
    await page.getByTestId(`replace-${replacement}`).click();
    const expectedScope = replacement === "cart" ? "merchant-a/cart-b" : "merchant-b/cart-c";
    await expect(page.getByTestId("scope")).toHaveText(expectedScope);
    const color = replacement === "cart" ? "green" : "yellow";
    const oldResponse = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes("/cart/cart-a/"));
    await request.post("/__fixture/release"); await oldResponse;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(async () => (await state(page)).updating).toBe(false);
    await expect(page.getByTestId("scope")).toHaveText(expectedScope);
    expect((await state(page)).cart.items.map((item: any) => item.optionItemIds)).toEqual([[color]]);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}
test("old finally cannot release a new scope command's singleflight", async ({ page, request }) => {
  await request.post("/__fixture/mode", { data: { mode: "hold-success" } });
  await page.getByRole("button", { name: "Aumentar quantidade de Camiseta — Cor: Azul" }).click();
  await expect.poll(async () => (await (await request.get("/__fixture/state")).json()).pending).toBe(1);
  await page.getByTestId("replace-cart").click();
  const plus = page.getByRole("button", { name: "Aumentar quantidade de Camiseta — Cor: Verde" }); await expect(plus).toBeEnabled();
  await request.post("/__fixture/mode", { data: { mode: "hold-success" } }); await plus.click();
  await expect.poll(async () => (await (await request.get("/__fixture/state")).json()).pending).toBe(2);
  const oldResponse = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes("/cart/cart-a/"));
  await request.post("/__fixture/release", { data: { first: true } }); await oldResponse;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(plus).toBeDisabled(); expect((await state(page)).updating).toBe(true);
  await request.post("/__fixture/release"); await expect(plus).toBeEnabled();
  expect((await state(page)).cart.cartId).toBe("cart-b"); expect((await state(page)).cart.items[0].quantity).toBe(2);
});
test("merchant without a saved cart cannot display previous merchant items or cart reference", async ({ page, request }) => {
  await page.getByTestId("replace-merchant-empty").click();
  await expect(page.getByTestId("scope")).toHaveText("merchant-b/");
  await expect(page.getByText("Carrinho vazio", { exact: true })).toBeVisible();
  const current = await state(page); expect(current.cart.cartId).toBeNull(); expect(current.cart.items).toEqual([]);
  await expect(page.getByRole("button", { name: /quantidade de Camiseta/ })).toHaveCount(0);
  const calls = (await (await request.get("/__fixture/state")).json()).calls;
  expect(calls.filter((call: any) => call.merchantId === "merchant-b")).toEqual([]);
});
test("initial GET with wrong cart reference never populates the real CartProvider", async ({ page, request }) => {
  await request.post("/__fixture/mode", { data: { mode: "wrong-bootstrap" } });
  await page.reload(); await expect(page.getByRole("alert")).toBeVisible();
  const current = await state(page); expect(current.cart.cartId).toBeNull(); expect(current.cart.items).toEqual([]);
  await expect(page.getByTestId("scope")).toHaveText("merchant-a/");
  await expect(page.getByText("Carrinho vazio", { exact: true })).toBeVisible();
});
