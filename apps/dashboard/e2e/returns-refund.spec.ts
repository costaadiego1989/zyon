import { test, expect, type Page } from "@playwright/test";

// Real browser, synthetic API only: no authentication or financial provider calls.
async function mockApi(page: Page, outcome: "completed" | "pending" | "lost" = "completed", reverseOutcome: "generated" | "pending" = "generated") {
  const state = { posts: [] as Array<{ path: string; body: any }>, previews: 0, lists: 0,
    row: { id: "return_original", orderId: "order_original", buyerName: "Cliente Teste", buyerEmail: "",
      status: "REQUESTED", reason: "CHANGED_MIND", items: [], createdAt: "2026-10-07T12:00:00Z", updatedAt: "2026-10-07T12:00:00Z", refund: undefined as any } };
  const reverse = { returnId: state.row.id, amountCents: 3998, shipments: [] as any[], candidates: [
    { originMerchantId: "seller_a", originName: "Loja A", package: { height: 12, width: 16, length: 24, weight: 2 }, email: "buyer@example.test", phone: "11999999999" },
    { originMerchantId: "seller_b", originName: "Loja B", package: { height: 12, width: 16, length: 24, weight: 2 }, email: "buyer@example.test", phone: "11999999999" },
  ] };
  await page.route("**/audit-api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace("/audit-api/v1", "");
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (path === "/merchants/me") return json({ id: "host", name: "Loja Teste", user_id: "operator-test", role: "owner", plan: "BOTH" });
    if (path === "/auth/refresh") return json({}, 401);
    if (path === "/billing/subscription") return json({ plan: "starter", status: "active", features: {} });
    if (path === "/billing/plans") return json([]);
    if (path === "/onboarding") return json({ completed: true, steps: [] });
    if (path === "/merchants/me/stores") return json({ data: [{ id: "host", name: "Loja Teste", role: "owner" }] });
    if (path === "/merchants/host/returns") { state.lists++; return json({ returns: [state.row], total: 1 }); }
    if (path.endsWith("/refund-preview")) { state.previews++; return json({ amountCents: 1333, alreadySubmitted: Boolean(state.row.refund) }); }
    if (path.endsWith("/reverse-shipping")) return json(reverse);
    if (request.method() === "POST" && path.startsWith("/merchants/host/returns/")) {
      const body = request.postData() ? request.postDataJSON() : null; state.posts.push({ path, body });
      if (path.endsWith("/reverse-shipping/prepare")) {
        reverse.shipments = reverse.candidates.map((c, i) => ({ id: `shipment_${i}`, originMerchantId: c.originMerchantId, originName: c.originName,
          amountCents: 1999, status: "reverse_cart_ready", postingCode: null, serviceId: body.serviceId })); reverse.candidates = [];
        return json(reverse);
      }
      if (path.endsWith("/reverse-shipping/confirm")) {
        reverse.shipments = reverse.shipments.map((s, i) => ({ ...s, status: reverseOutcome === "generated" ? "reverse_generated" : "reverse_generation_unknown",
          postingCode: reverseOutcome === "generated" ? `${1234567890 + i}` : null }));
        if (reverseOutcome === "generated") state.row.status = "LABEL_GENERATED";
        return json(reverse);
      }
      if (path.endsWith("/accept")) {
        state.row.status = outcome === "completed" ? "REFUND_COMPLETED" : "REFUND_PROCESSING";
        state.row.refund = { amountInCents: 1333, status: outcome === "completed" ? "COMPLETED" : "PENDING" };
        return outcome === "lost" ? route.abort("connectionreset") : json({ status: state.row.status, refund: state.row.refund });
      }
      if (path.endsWith("/label")) { state.row.status = "LABEL_GENERATED"; return json({ ...state.row, label: body }); }
      if (path.endsWith("/receive")) { state.row.status = "RECEIVED"; return json(state.row); }
      if (path.endsWith("/inspect")) { state.row.status = "INSPECTED_PASS"; return json({ ...state.row, inspection: body }); }
    }
    if (path.includes("notification")) return json({ notifications: [], unread_count: 0 });
    if (path.endsWith("/domains")) return json([]);
    if (path === "/dashboard/nav-counts") return json({ orders: 0, messages: 0, cartRecovery: 0 });
    return json({});
  });
  await page.route(/^https?:\/\/(?!localhost:5194)/, route => route.abort());
  return state;
}

test("approval shows original freight in the total and requires confirmation before sending", async ({ page }) => {
  const state = await mockApi(page); await page.goto("/#returns");
  await page.getByRole("button", { name: "Aprovar estorno", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Aprovar estorno ao comprador?" });
  await expect(dialog).toContainText(/13,33/); await expect(dialog).toContainText("inclui o frete"); expect(state.posts).toHaveLength(0);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); expect(state.posts).toHaveLength(0);
  await page.getByRole("button", { name: "Aprovar estorno", exact: true }).click();
  await dialog.getByRole("button", { name: "Aprovar e estornar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Reembolso confirmado pelo provedor");
  expect(state.posts.map(p => p.path)).toEqual(["/merchants/host/returns/return_original/accept"]);
  await expect(page.getByRole("cell", { name: "Reembolsado", exact: true })).toBeVisible();
});

for (const outcome of ["pending", "lost"] as const) test(`${outcome}: confirmation stays pending without a second financial submission`, async ({ page }) => {
  const state = await mockApi(page, outcome); await page.goto("/#returns");
  await page.getByRole("button", { name: "Aprovar estorno", exact: true }).click();
  await page.getByRole("button", { name: "Aprovar e estornar", exact: true }).click();
  await expect(page.getByText("Em processamento", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprovar e estornar", exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Reembolso confirmado pelo provedor");
  expect(state.posts).toHaveLength(1); if (outcome === "lost") expect(state.lists).toBeGreaterThanOrEqual(2);
});

test("real posting code and inspection are recorded without issuing a refund", async ({ page }) => {
  const state = await mockApi(page); await page.goto("/#returns");
  await page.getByRole("button", { name: "Informar etiqueta", exact: true }).click();
  await page.getByLabel("Código de postagem ou rastreio", { exact: true }).fill("1234567890");
  await page.getByRole("button", { name: "Registrar etiqueta", exact: true }).click();
  await page.getByRole("button", { name: "Marcar recebido", exact: true }).click();
  await page.getByRole("button", { name: "Analisar devolução", exact: true }).click();
  await page.getByLabel("Condição do produto", { exact: true }).selectOption("GOOD");
  await page.getByRole("button", { name: "Registrar análise", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reembolsar", exact: true })).toBeVisible();
  expect(state.posts.map(p => p.path.split("/").pop())).toEqual(["label", "receive", "inspect"]);
  expect(state.posts[0].body.trackingNumber).toBe("1234567890"); expect(state.previews).toBe(0);
  expect(state.posts[2].body).toEqual({ itemCondition: "GOOD", verdict: "APPROVED" });
});

test("reverse shipping shows seller packages, confirms cost and displays each real posting code", async ({ page }) => {
  const state = await mockApi(page); await page.goto("/#returns");
  await page.getByRole("button", { name: "Preparar devolução", exact: true }).click();
  const panel = page.getByRole("region", { name: "Frete de devolução" });
  await expect(panel.getByRole("group", { name: "Loja A" })).toBeVisible();
  await expect(panel.getByRole("group", { name: "Loja B" })).toBeVisible();
  expect(state.posts).toHaveLength(0);
  await panel.getByRole("button", { name: "Consultar custo", exact: true }).click();
  await expect(panel).toContainText("39,98"); expect(state.posts.map(p => p.path.split("/").pop())).toEqual(["prepare"]);
  await panel.getByRole("button", { name: "Comprar frete e gerar códigos", exact: true }).click();
  await expect(panel).toContainText("1234567890"); await expect(panel).toContainText("1234567891");
  await expect(panel).toContainText("Não precisa imprimir etiqueta");
  expect(state.posts.map(p => p.path.split("/").pop())).toEqual(["prepare", "confirm"]);
  expect(state.posts[1].body).toEqual({ expectedAmountCents: 3998 }); expect(state.previews).toBe(0);
  await expect(panel.getByRole("button", { name: "Comprar frete e gerar códigos", exact: true })).toHaveCount(0);
});

test("pending reverse generation shows no fictitious code or completion", async ({ page }) => {
  const state = await mockApi(page, "completed", "pending"); await page.goto("/#returns");
  await page.getByRole("button", { name: "Preparar devolução", exact: true }).click();
  const panel = page.getByRole("region", { name: "Frete de devolução" });
  await panel.getByRole("button", { name: "Consultar custo", exact: true }).click();
  await panel.getByRole("button", { name: "Comprar frete e gerar códigos", exact: true }).click();
  await expect(panel).toContainText("Código em geração"); await expect(panel).not.toContainText("Código de devolução:");
  await expect(panel.getByRole("button", { name: "Conferir emissão", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("A compra não será repetida");
  expect(state.posts.map(p => p.path.split("/").pop())).toEqual(["prepare", "confirm"]);
});
