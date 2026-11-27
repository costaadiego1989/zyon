import { test, expect, type Page } from "@playwright/test";

const initial = () => ({ premium: true, profile: { name: "Lia", personality: "balanced" }, state: null as any,
  capabilities: { automaticPayments: false, scope: "this_store", maxActiveTasks: 25 } });
const configured = () => ({ ...initial(), state: { settings: { enabled: true, email: false, whatsapp: false, quietStart: 22, quietEnd: 8, timeZone: "America/Sao_Paulo", maxDailyNotifications: 3 }, tasks: [] as any[], activities: [] as any[] } });
const task = () => ({ id: "task-one", revision: 1, status: "active", nextRunAt: "2026-11-27T15:00:00Z", config: { kind: "reorder", title: "Meu café mensal", items: [{ productId: "coffee", variantId: "coffee-dark", quantity: 2 }], includeShipping: false, intervalDays: 30, targetDiscountPercent: 0 } });
const activity = () => ({ id: "activity-one", taskId: "task-one", taskRevision: 1, kind: "opportunity", decision: "pending", message: "Encontramos uma condição para seu café.", createdAt: "2026-10-27T15:00:00Z", deliveries: {},
  quote: { items: [{ productId: "coffee", variantId: "coffee-dark", name: "Café especial", quantity: 2, unitPriceCents: 2500 }], subtotalCents: 5000, discountCents: 0, serviceFeeCents: 99, shippingCents: null, totalCents: 5099, available: true, expiresAt: "2026-10-27T15:10:00Z" } });
async function setup(page: Page, view = configured(), options: { quoteChanged?: boolean; theme?: string } = {}) {
  const writes: Array<{ method: string; path: string; body: any }> = [];
  await page.addInitScript(() => {
    const token = `test.${btoa(JSON.stringify({ sub: "buyer", exp: Math.floor(Date.now() / 1000) + 3600, email: "buyer@example.test" }))}.test`;
    localStorage.setItem("zyon_buyer_token", token); localStorage.setItem("zyon_buyer_session", JSON.stringify({ email: "buyer@example.test" }));
  });
  await page.route("http://localhost:3009/**", async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" } });
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
    if (request.method() !== "GET") writes.push({ method: request.method(), path, body: request.postDataJSON() });
    if (path.endsWith("/shopping-agent/catalog")) return reply({ items: [{ id: "coffee", name: "Café especial", type: "physical", variants: [{ id: "coffee-light", label: "Torra clara", priceCents: 2400, available: false }, { id: "coffee-dark", label: "Torra escura", priceCents: 2500, available: true }] }] });
    if (path.endsWith("/shopping-agent/suggestions")) return reply({ items: [] });
    if (path.endsWith("/shopping-agent/tasks")) { const input = request.postDataJSON(); const saved = { ...task(), config: input.config }; view.state.tasks.push(saved); return reply(saved); }
    if (path.includes("/shopping-agent/tasks/")) { const input = request.postDataJSON(); const saved = view.state.tasks.find((item: any) => path.endsWith(item.id));
      if (input.action === "pause") saved.status = "paused"; if (input.action === "resume") saved.status = "active"; if (input.action === "cancel") saved.status = "cancelled"; saved.revision++; return reply(view); }
    if (path.includes("/shopping-agent/activities/")) return options.quoteChanged ? reply({ message: "agent_quote_changed" }, 409) : reply({ embedToken: "shopping-agent-scoped-fixture", cartRef: "agent_activity-one" });
    if (path === "/embed/payment/current") return reply({ version: 1, session_id: "agent_session", marketplace: false, payment: null });
    if (path === "/embed/start") return reply({ session_id: "agent_session", experience: { items: [{ sku: "CAFE", name: "Café especial", quantity: 2, unit_price: 25 }], totals: { subtotal: 50, discount: 0, service_fee: .99, total: 50, total_to_pay: 50.99 }, brand: { name: "Loja de café" }, agent: { name: "Ana" }, rules: { showBranding: false } } });
    if (path.endsWith("/shopping-agent")) {
      if (request.method() === "PUT") { const input = request.postDataJSON(); view.state ??= configured().state; Object.assign(view.state.settings, input); view.profile!.name = input.name ?? view.profile!.name; }
      return reply(view);
    }
    if (path.endsWith("/buyer/me")) return reply({ global_user_id: "buyer", display_name: "Compradora", email: "buyer@example.test" });
    return reply({ items: [], address: null });
  });
  await page.goto(`/?agent=activity-one&theme=${options.theme ?? "light"}`);
  await page.getByRole("heading", { name: "Lia" }).waitFor();
  return { writes, view };
}
test("creation requires consent and keeps both notification channels off", async ({ page }) => {
  const { writes } = await setup(page, initial());
  const create = page.getByRole("button", { name: "Criar meu agente", exact: true }); await expect(create).toBeDisabled();
  await expect(page.getByLabel("Receber por e-mail avisos das minhas tarefas.")).not.toBeChecked();
  await expect(page.getByLabel("Receber pelo WhatsApp avisos das minhas tarefas.")).not.toBeChecked();
  await page.getByLabel("Quero criar meu agente e salvar minhas tarefas nesta loja.").check(); await create.click();
  await expect(page.getByRole("button", { name: "Nova tarefa" })).toBeVisible();
  const saved = writes.find(w => w.method === "PUT")!.body; expect(saved.accepted).toBe(true); expect(saved.email).toBe(false); expect(saved.whatsapp).toBe(false);
});
test("creating a price task submits the explicitly selected variant in cents", async ({ page }) => {
  const { writes } = await setup(page); await page.getByRole("button", { name: "Nova tarefa" }).click();
  await page.getByLabel("Nome da tarefa", { exact: true }).fill("Café até cinquenta reais");
  await page.getByRole("button", { name: /Torra escura/ }).click(); await page.getByLabel("Avise até este total (R$)", { exact: true }).fill("50,99");
  await page.getByRole("button", { name: "Salvar tarefa" }).click(); await expect(page.getByText("Tarefa criada.", { exact: false })).toBeVisible();
  const saved = writes.find(w => w.path.endsWith("/tasks"))!.body;
  expect(saved.config.targetCents).toBe(5099); expect(saved.config.items).toEqual([{ productId: "coffee", variantId: "coffee-dark", quantity: 1 }]); expect(saved.requestKey).toMatch(/^[\w-]+$/);
  expect(writes.some(w => /embed|payment/.test(w.path))).toBe(false);
});
test("all five task kinds are available with contextual recurring and shipping fields", async ({ page }) => {
  await setup(page); await page.getByRole("button", { name: "Nova tarefa" }).click();
  const kind = page.getByLabel("O que o agente deve fazer?"); await expect(kind.locator("option")).toHaveCount(5);
  await kind.selectOption("reorder"); await expect(page.getByLabel("Repetir a cada quantos dias?")).toHaveValue("30");
  await page.getByLabel("Incluir frete no limite.").check(); await expect(page.getByLabel("CEP de entrega")).toBeVisible();
  await kind.selectOption("negotiate"); await expect(page.getByLabel("Desconto mínimo (%)")).toBeVisible();
});
test("recurring task pause and skip use explicit actions and the observed revision", async ({ page }) => {
  const view = configured(); view.state.tasks.push(task()); const { writes } = await setup(page, view);
  await page.getByRole("button", { name: "Pular ciclo", exact: true }).click(); await expect(page.getByText("Este ciclo foi pulado.")).toBeVisible();
  expect(writes[0]?.body).toEqual({ action: "skip", revision: 1 });
  await page.getByRole("button", { name: "Pausar", exact: true }).click(); await expect(page.getByText("Pausada", { exact: true })).toBeVisible();
});
test("a changed quote gives a recoverable error and never opens a payment flow", async ({ page }) => {
  const view = configured(); view.state.tasks.push(task()); view.state.activities.push(activity()); const { writes } = await setup(page, view, { quoteChanged: true });
  await page.getByRole("button", { name: "Revisar e ir ao checkout" }).click();
  await expect(page.getByRole("alert")).toContainText("As condições mudaram"); expect(writes.some(w => /payment|embed/.test(w.path))).toBe(false);
});

test("an approved proposal opens the native checkout above the hub and returns without creating a payment", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const view = configured(); view.state.tasks.push(task()); view.state.activities.push(activity()); const { writes } = await setup(page, view);
  await page.getByRole("button", { name: "Revisar e ir ao checkout" }).click();
  const checkout = page.getByRole("dialog", { name: "Revisar compra do agente", exact: true }); await expect(checkout).toBeVisible();
  await expect(checkout.getByRole("heading", { name: "Seu pedido", exact: true })).toBeVisible();
  await expect(checkout.getByRole("region", { name: "Carrinho do checkout" })).toContainText("R$ 50,99");
  expect(await checkout.evaluate(element => {
    const button = element.querySelector("button")!; const bounds = button.getBoundingClientRect();
    return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
  })).toBe(true);
  expect(writes.find(w => w.path === "/embed/start")?.body.buyer_access_token).toMatch(/^test\./);
  expect(writes.some(w => w.path.includes("/payment/intents"))).toBe(false);
  await checkout.getByRole("button", { name: "Voltar ao agente" }).click(); await expect(checkout).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Lia", exact: true })).toBeVisible(); expect(errors).toEqual([]);
});
test("a downgrade keeps history and pause controls while blocking new tasks", async ({ page }) => {
  const view = configured(); view.premium = false; view.state.tasks.push(task()); await setup(page, view);
  await expect(page.getByRole("button", { name: "Nova tarefa" })).toBeDisabled(); await expect(page.getByText("Meu café mensal", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pausar", exact: true })).toBeEnabled(); await expect(page.getByRole("button", { name: "Encerrar", exact: true })).toBeEnabled();
});

test("the appearance studio previews the chosen face and persists it without changing notification consent", async ({ page }) => {
  const { writes } = await setup(page);
  await page.getByRole("button", { name: "Personalizar agente", exact: true }).click();
  await page.getByLabel("Nome do agente", { exact: true }).fill("Nina");
  await page.getByRole("radio", { name: "Órbita", exact: true }).check();
  await page.getByRole("radio", { name: "Lavanda", exact: true }).check();
  await page.getByRole("radio", { name: "Sorridente", exact: true }).check();
  await expect(page.getByRole("img", { name: "Avatar de Nina: Órbita, Lavanda, Sorridente", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Salvar visual", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nina", exact: true })).toBeVisible();
  const saved = writes.find(write => write.method === "PUT")!.body;
  expect(saved).toEqual({ name: "Nina", appearance: { version: 1, style: "orbit", color: "lilac", expression: "happy" } });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Nina", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Avatar de Nina: Órbita, Lavanda, Sorridente", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Personalizar agente", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Lavanda", exact: true })).toBeChecked();
});

test("cancelling appearance changes does not save and returns keyboard focus", async ({ page }) => {
  const { writes } = await setup(page);
  await page.getByRole("button", { name: "Personalizar agente", exact: true }).click();
  await page.getByLabel("Nome do agente", { exact: true }).fill("Rascunho");
  await page.getByRole("radio", { name: "Nexo", exact: true }).check();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lia", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Personalizar agente", exact: true })).toBeFocused();
  expect(writes).toHaveLength(0);
});

test("personalization before creation remains a draft until the buyer gives consent", async ({ page }) => {
  const { writes } = await setup(page, initial());
  await page.getByRole("button", { name: "Personalizar agente", exact: true }).click();
  await page.getByRole("radio", { name: "Inicial", exact: true }).check();
  await expect(page.getByRole("radio", { name: "Focado", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Usar este visual", exact: true }).click(); expect(writes).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Criar meu agente", exact: true })).toBeDisabled();
  await page.getByLabel("Quero criar meu agente e salvar minhas tarefas nesta loja.").check();
  await page.getByRole("button", { name: "Criar meu agente", exact: true }).click();
  await expect(page.getByRole("button", { name: "Nova tarefa" })).toBeVisible();
  expect(writes.find(write => write.method === "PUT")?.body.appearance.style).toBe("initials");
});

for (const width of [390, 1366]) for (const theme of ["light", "dark"]) test(`appearance studio works at ${width}px in ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1400 }); await setup(page, configured(), { theme });
  await page.getByRole("button", { name: "Personalizar agente", exact: true }).click();
  await page.getByRole("radio", { name: "Nexo", exact: true }).check();
  await page.getByRole("radio", { name: "Oceano", exact: true }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const panel = page.getByRole("tabpanel", { name: "Meu agente", exact: true });
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await panel.evaluate(element => { element.scrollTop = 0; });
  await page.getByRole("dialog", { name: "Hub do comprador", exact: true }).screenshot({ path: test.info().outputPath(`studio-${width}-${theme}.png`) });
});
for (const width of [390, 1366]) for (const theme of ["light", "dark"]) test(`the agent remains readable and usable at ${width}px in ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const view = configured(); view.state.tasks.push(task()); view.state.activities.push(activity()); await setup(page, view, { theme });
  await expect(page.getByRole("heading", { name: "Atividades e propostas" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const button = page.getByRole("button", { name: "Revisar e ir ao checkout" }); await button.scrollIntoViewIfNeeded(); await button.focus(); await expect(button).toBeFocused();
  const box = await button.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("tabpanel", { name: "Meu agente" }).evaluate(element => { element.scrollTop = 0; });
  await page.getByRole("dialog", { name: "Hub do comprador", exact: true }).screenshot({ path: test.info().outputPath(`agent-${width}-${theme}.png`) });
});
