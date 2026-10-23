import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
const provider = async (page: Page) => JSON.parse(await page.getByTestId("provider-state").textContent() ?? "{}");
const upstream = async (request: APIRequestContext) => (await request.get("/__fixture/state")).json();
const selectMode = (request: APIRequestContext, mode: string) => request.post("/__fixture/mode", { data: { mode } });
const release = (request: APIRequestContext, type: string, first = false) => request.post("/__fixture/release", { data: { type, first } });
const offer = (page: Page) => page.getByRole("region", { name: "Joint production cross-sell" });
const add = (page: Page) => offer(page).getByRole("button", { name: /^Adicionar$/ });
const lines = (state: any) => state.cart.items.map((item: any) => [item.variantId, item.quantity, item.price]);

test.beforeEach(async ({ page, request }) => {
  await request.post("/__fixture/reset");
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:5199" ? route.continue() : route.abort());
});
async function ready(page: Page) {
  await page.goto("/"); await expect(page.getByTestId("scope")).toHaveText("merchant-a/cart-a");
  await expect.poll(async () => (await provider(page)).snapshotMerchantId).toBe("merchant-a");
  await expect(add(page)).toBeEnabled(); await expect(offer(page).getByText(/90,00/)).toBeVisible();
}
async function noFallback(page: Page, request: APIRequestContext) {
  const state = await provider(page), remote = await upstream(request);
  expect(state.chatCalls).toBe(0); expect(remote.calls.filter((call: any) => call.operation === "accept")).toHaveLength(1);
  expect(remote.calls.filter((call: any) => call.unexpected)).toEqual([]);
}

test("literal provider stays unchanged until ACK plus matching canonical GET, then receives discounted target exactly once", async ({ page, request }) => {
  await ready(page); await selectMode(request, "hold-accept"); await add(page).dblclick();
  await expect.poll(async () => (await upstream(request)).pending.map((item: any) => item.type)).toEqual(["accept"]);
  expect(lines(await provider(page))).toEqual([["existing", 1, 100]]); expect((await provider(page)).applications).toBe(0);
  await selectMode(request, "hold-get"); await release(request, "accept");
  await expect.poll(async () => (await upstream(request)).pending.map((item: any) => item.type)).toEqual(["get"]);
  expect(lines(await provider(page))).toEqual([["existing", 1, 100]]); expect((await provider(page)).applications).toBe(0);
  await release(request, "get"); await expect.poll(async () => (await provider(page)).applications).toBe(1);
  expect(lines(await provider(page))).toEqual([["existing", 1, 100], ["target", 1, 90]]);
  await expect(page.getByTestId("provider-total")).toHaveText("190");
  const calls = (await upstream(request)).calls, echoed = calls.find((call: any) => call.operation === "accept").body.expectedQuote;
  expect(echoed.maximumUnitPriceCents).toBe(9000); expect(echoed.quantity).toBe(1);
  expect(calls.filter((call: any) => call.method === "GET").length).toBe(2); await noFallback(page, request);
});

for (const replacement of ["merchant", "cart"]) for (const boundary of ["accept", "get"]) {
  test(`late ${boundary} after replacing ${replacement} cannot apply old cross-sell to literal provider`, async ({ page, request }) => {
    await ready(page); await selectMode(request, `hold-${boundary}`); await add(page).click();
    await expect.poll(async () => (await upstream(request)).pending.map((item: any) => item.type)).toEqual([boundary]);
    await page.getByTestId(`replace-${replacement}`).click();
    const expectedScope = replacement === "merchant" ? "merchant-b/cart-c" : "merchant-a/cart-b";
    await expect(page.getByTestId("scope")).toHaveText(expectedScope);
    const before = await provider(page); expect(before.applications).toBe(0);
    const response = page.waitForResponse(res => boundary === "accept" ? res.url().endsWith("/cross-sell/accept") : res.request().method() === "GET" && res.url().includes("/cart/cart-a?"));
    await release(request, boundary); await response;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const after = await provider(page);
    expect(after.cart).toEqual(before.cart); expect(after.applications).toBe(0); expect(after.updating).toBe(false); expect(after.error).toBeNull();
    if (boundary === "accept") expect((await upstream(request)).calls.filter((call: any) => call.method === "GET" && call.cartId === "cart-a")).toHaveLength(1);
    await noFallback(page, request);
  });
}

test("lost POST body keeps actual provider unchanged and cannot repeat acceptance or use an ordinary add fallback", async ({ page, request }) => {
  await ready(page); await selectMode(request, "lost-accept"); await add(page).dblclick();
  await expect(offer(page).getByRole("alert")).toBeVisible();
  await expect(offer(page).getByRole("button")).toBeDisabled();
  // Dispatching through a stale visual handler still reaches the real latch.
  await offer(page).getByRole("button").dispatchEvent("click");
  const state = await provider(page); expect(lines(state)).toEqual([["existing", 1, 100]]); expect(state.cart.total).toBe(100); expect(state.applications).toBe(0);
  expect((await upstream(request)).calls.filter((call: any) => call.method === "GET")).toHaveLength(1);
  await noFallback(page, request);
});

for (const outcome of ["success", "error"]) test(`stale ordinary PATCH ${outcome} cannot erase accepted canonical cross-sell provider snapshot`, async ({ page, request }) => {
  await selectMode(request, "hold-quote"); await page.goto("/");
  await expect.poll(async () => (await upstream(request)).pending.map((entry: any) => entry.type)).toEqual(["quote"]);
  await selectMode(request, `hold-patch-${outcome}`); await page.getByTestId("ordinary-patch").click();
  await expect.poll(async () => (await upstream(request)).pending.map((entry: any) => entry.type)).toEqual(["quote", "patch"]);
  expect((await provider(page)).updating).toBe(true);
  await release(request, "quote"); await expect(add(page)).toBeEnabled(); await add(page).click();
  await expect.poll(async () => (await provider(page)).applications).toBe(1);
  const accepted = await provider(page), expectedQuantity = outcome === "success" ? 2 : 1;
  expect(lines(accepted)).toEqual([["existing", expectedQuantity, 100], ["target", 1, 90]]);
  expect(accepted.cart.total).toBe(expectedQuantity * 100 + 90); expect(accepted.updating).toBe(false);
  const response = page.waitForResponse(res => res.request().method() === "PATCH");
  await release(request, "patch"); await response;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const settled = await provider(page); expect(settled.cart).toEqual(accepted.cart); expect(settled.error).toBeNull(); expect(settled.updating).toBe(false);
  await noFallback(page, request);
});

test("old PATCH finally cannot unlock a newer provider PATCH after accepted cross-sell", async ({ page, request }) => {
  await selectMode(request, "hold-quote"); await page.goto("/");
  await expect.poll(async () => (await upstream(request)).pending.map((entry: any) => entry.type)).toEqual(["quote"]);
  await selectMode(request, "hold-patch-success"); await page.getByTestId("ordinary-patch").click();
  await expect.poll(async () => (await upstream(request)).pending.map((entry: any) => entry.type)).toEqual(["quote", "patch"]);
  await release(request, "quote"); await expect(add(page)).toBeEnabled(); await add(page).click();
  await expect.poll(async () => (await provider(page)).applications).toBe(1);
  await selectMode(request, "hold-patch-success"); await page.getByTestId("ordinary-patch").click();
  await expect.poll(async () => (await upstream(request)).pending.filter((entry: any) => entry.type === "patch").length).toBe(2);
  const firstResponse = page.waitForResponse(res => res.request().method() === "PATCH");
  await release(request, "patch", true); await firstResponse;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect((await provider(page)).updating).toBe(true); expect((await provider(page)).cart.items.some((item: any) => item.variantId === "target")).toBe(true);
  // A third command must be suppressed by the still-owned real provider latch.
  await page.getByTestId("ordinary-patch").click();
  expect((await upstream(request)).calls.filter((call: any) => call.method === "PATCH")).toHaveLength(2);
  await release(request, "patch"); await expect.poll(async () => (await provider(page)).updating).toBe(false);
  expect((await provider(page)).cart.items.some((item: any) => item.variantId === "target")).toBe(true);
  await noFallback(page, request);
});
