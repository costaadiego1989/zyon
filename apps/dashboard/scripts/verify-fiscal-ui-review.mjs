import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { chromium } from "playwright";
const requireDashboard = createRequire(new URL("../package.json", import.meta.url));
const { createServer } = await import(pathToFileURL(requireDashboard.resolve("vite")).href);
const { default: react } = await import(pathToFileURL(requireDashboard.resolve("@vitejs/plugin-react")).href);
const group = process.argv[2] ?? "all";
assert.ok(["settings", "invoices", "help", "all"].includes(group));
const artifacts = fileURLToPath(new URL(`../../../.specs/features/${group === "help" ? "fiscal-field-help-20261127" : "fiscal-ui-review-20261127"}/browser/`, import.meta.url));
mkdirSync(artifacts, { recursive: true });
// Vite treats port: 0 as its shared default. Reserve a real ephemeral port.
const portProbe = net.createServer();
await new Promise((resolve, reject) => { portProbe.once("error", reject); portProbe.listen(0, "127.0.0.1", resolve); });
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const server = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
  plugins: [react()], define: { "import.meta.env.PROD": "true", "import.meta.env.DEV": "false" },
  optimizeDeps: { entries: ["tests/fiscal-ui-review.fixture.html"] }, logLevel: "error",
  server: { host: "127.0.0.1", port, strictPort: true } });
let browser;
let activeCase = "startup";
const results = [];
const eligibleAccount = { id: "bling-owned-a", provider: "bling", status: "connected" };
const connection = input => ({ id: "fiscal-owned-a", merchantId: "merchant-a", isActive: false, activatedAt: null, disconnectedAt: null,
  erpConnectionId: null, stockOwner: "zyon", emailOwner: "zyon", whatsappOwner: "zyon", readiness: [], ...input });
try {
  await server.listen();
  // Compile the real UI before the gesture clocks, as production builds do.
  await Promise.all([
    "/tests/fiscal-ui-review.fixture.tsx",
    "/src/pages/fiscal/FiscalSettingsPage.tsx",
    "/src/pages/fiscal/FiscalInvoicesPage.tsx",
    "/src/pages/fiscal/FiscalInvoiceDetail.tsx",
    "/src/api-client.ts",
    "/src/styles.css",
  ].map(path => server.warmupRequest(path)));
  await server.waitForRequestsIdle();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  async function arrange({ screen = "settings", width = 1586, erps = [eligibleAccount], failures = {}, existing = null, rich = false } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 757 } });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    const state = { erps, failures, connection: existing, calls: [], invoices: [], total: 0, counts: {}, errors };
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith("/v1/")) return route.continue();
      const path = url.pathname.replace("/v1/merchants/me/fiscal", "");
      const input = request.postDataJSON();
      state.calls.push({ path, method: request.method(), search: url.search, body: input });
      if (state.failures[path]) return route.fulfill({ status: state.failures[path], json: { code: state.failures[path] === 401 ? "unauthorized" : state.failures[path] === 403 ? "tenant_role_required" : "fiscal_profile_invalid" } });
      let body;
      if (path === "/providers") body = { environment: "production", providers: ["focus", "bling", "omie", "tiny"].map(id => ({ id, label: { focus: "Focus NF-e", bling: "Bling", omie: "Omie", tiny: "Tiny/Olist" }[id], capabilities: {} })) };
      else if (path === "/connection" && request.method() === "PUT") body = state.connection = connection(input);
      else if (path === "/connection") body = state.connection;
      else if (path === "/profiles") body = rich ? {
        profile: { id: "profile-a", version: 1, confirmedAt: null, issuerRegime: "simples_nacional", itemRules: {
          policyVersion: "revisao-contador", operation: { products: { "SKU-A": { productId: 7, naturezaOperacaoId: 8 } } },
          items: { "SKU-A": { ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { cst: "102" } } },
          paymentMappings: { "17": { id: 7, meioPagamentoId: 7, formaRecebimentoId: 8 } },
        } }, confirmedProfile: null, supportedContract: { sourceContractVersion: "ui-help-fixture", issuerRegimes: ["simples_nacional"], operations: ["sale"], currencies: ["BRL"], productTypes: ["physical"], minimumRecipientRequirements: ["name", "taxId"] },
      } : { profile: null, confirmedProfile: null, supportedContract: null };
      else if (path === "/templates") body = { email: { subject: "Sua nota fiscal", body: "Consulte sua nota" }, whatsapp: { body: "Sua nota", status: "DRAFT", revision: 1, approvedVersions: [] }, whatsappConnected: false };
      else if (path === "/payment-sources") body = rich ? [{ paymentIntentId: "payment-a", provider: "stripe", method: "card", status: "succeeded", createdAt: "2026-11-27T12:00:00Z" }] : [];
      else if (path === "/olist/oauth/configuration") body = { redirectUri: base + "/v1/webhooks/fiscal/olist/oauth/callback" };
      else if (path.endsWith("/notifications")) body = { configured: true, notificationUrl: base + "/v1/webhooks/fiscal/olist/synthetic-private-reference" };
      else if (path.endsWith("/setup")) body = { companyId: null, fiscalTimeZone: null, focusWebhookConfigured: false, paymentConfigurations: [], accountEvidence: null };
      else if (path === "/invoices") body = { items: state.invoices, total: state.total, counts: state.counts, page: Number(url.searchParams.get("page") ?? 1), pageSize: 20 };
      else if (path === "/invoices/help-intent") body = { id: "help-intent", orderId: "help-order", recipientName: "Cliente de teste", provider: "focus", state: "authorized", environment: "production",
        completedAt: "2026-11-27T12:00:00Z", totalCents: 10000, currency: "BRL", reasonCode: null, attempts: 1, nextAttemptAt: "2026-11-27T12:00:00Z",
        document: { intentId: "help-intent", sellerMerchantId: "merchant-a", orderId: "help-order", state: "authorized", documentState: "available", number: "123", series: "1", authorizationProtocol: "synthetic-protocol", accessKey: "1".repeat(44), authorizedAt: "2026-11-27T12:00:00Z", documents: [] },
        stock: { owner: "zyon", state: "managed_by_zyon" }, deliveries: [], reviews: [], history: [], allowedActions: [{ kind: "request_cancellation", label: "Solicitar cancelamento fiscal", reviewId: "help-review" }] };
      else if (path.endsWith("/erp-connections")) body = state.erps;
      else return route.fulfill({ status: 404, json: { code: "not_found" } });
      return route.fulfill({ json: body });
    });
    await page.goto(base + "/tests/fiscal-ui-review.fixture.html?screen=" + screen);
    await page.getByRole("heading", { name: screen === "invoices" ? "Notas fiscais" : screen === "detail" ? "Detalhe fiscal" : "Configuração fiscal", exact: true }).waitFor();
    await page.getByText(screen === "invoices" ? "Carregando notas…" : screen === "detail" ? "Carregando detalhe fiscal…" : "Carregando configuração fiscal…", { exact: true }).waitFor({ state: "hidden" });
    return { context, page, state };
  }
  async function run(name, work) {
    activeCase = name;
    const start = Date.now();
    await Promise.race([work(), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("case deadline exceeded: " + name)), 30000); timer.unref(); })]);
    results.push({ name, status: "pass", durationMs: Date.now() - start });
    console.log("PASS " + name);
  }
  async function selectBling(page) {
    await page.getByLabel("Emissor fiscal", { exact: true }).selectOption("bling");
    await page.getByText("Carregando configuração fiscal…", { exact: true }).waitFor({ state: "hidden" });
  }
  async function assertMeaning(page, label, meaning) {
    const result = await page.getByLabel(label, { exact: true }).evaluate(control => {
      const help = document.getElementById(control.getAttribute('aria-describedby'));
      const title = control.closest('.form-field').querySelector('label');
      const a = title.getBoundingClientRect(), b = help?.getBoundingClientRect(), c = control.getBoundingClientRect();
      return { text: help?.textContent, ordered: !!b && b.top >= a.bottom - 1 && b.bottom <= c.top + 1 };
    });
    assert.match(result.text ?? "", meaning, label);
    assert.equal(result.ordered, true, label);
  }
  async function assertHelpLink(page, name, href) {
    const link = page.getByRole("link", { name, exact: true });
    assert.equal(await link.getAttribute("href"), href);
    const colors = await link.evaluate(el => {
      const expected = document.createElement('span');
      expected.style.color = 'var(--color-brand)';
      el.parentElement.append(expected);
      const result = { actual: getComputedStyle(el).color, brand: getComputedStyle(expected).color };
      expected.remove(); return result;
    });
    assert.equal(colors.actual, colors.brand, "Help links must use the readable dashboard brand token");
  }
  if (group === "settings" || group === "all") {
    for (const width of [390, 1586]) await run("Bling selected account submits production and renders saved connection " + width, async () => {
      const { context, page, state } = await arrange({ width });
      try {
        assert.equal(await page.getByLabel("Ambiente fiscal", { exact: true }).count(), 0);
        await selectBling(page);
        await page.getByLabel("CNPJ da empresa emitente", { exact: true }).fill("26.517.729/0001-23");
        assert.equal(await page.getByLabel("Conexão Bling existente", { exact: true }).inputValue(), eligibleAccount.id);
        await page.getByRole("button", { name: "Conectar emissor", exact: true }).click();
        await page.getByText("Conexão salva. Verifique a preparação antes de ativar.", { exact: true }).waitFor();
        await page.getByText("Conta Bling conectada · Emissão ainda não ativa.", { exact: false }).waitFor();
        const writes = state.calls.filter(c => c.method === "PUT" && c.path === "/connection");
        assert.deepEqual(writes.map(c => c.body), [{ provider: "bling", environment: "production", issuerTaxId: "26.517.729/0001-23", stockOwner: "zyon", emailOwner: "zyon", whatsappOwner: "zyon", erpConnectionId: eligibleAccount.id }]);
        assert.ok(state.calls.filter(c => c.search).every(c => new URLSearchParams(c.search).get("environment") === "production" || c.path.endsWith("/erp-connections")));
        assert.equal(state.calls.filter(c => c.path.endsWith("/activate")).length, 0);
        assert.deepEqual(state.errors, []);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: artifacts + `bling-connected-${width}.png`, fullPage: true });
      } finally { await context.close(); }
    });
    await run("Bling connection survives optional preparation failures", async () => {
      const { context, page, state } = await arrange({ failures: { "/profiles": 400, "/payment-sources": 400, "/templates": 503 } });
      try {
        await selectBling(page);
        await page.getByLabel("CNPJ da empresa emitente", { exact: true }).fill("26.517.729/0001-23");
        await page.getByRole("button", { name: "Conectar emissor", exact: true }).click();
        await page.getByText("Conexão salva. Verifique a preparação antes de ativar.", { exact: true }).waitFor();
        assert.equal(state.connection.erpConnectionId, eligibleAccount.id);
        assert.equal(await page.getByText("Não foi possível concluir. Revise a preparação fiscal com o responsável pela empresa.", { exact: true }).count(), 0);
        assert.equal(await page.getByRole("button", { name: "Tentar novamente", exact: true }).count(), 0);
      } finally { await context.close(); }
    });
    await run("Bling has an actionable missing-account state", async () => {
      const { context, page, state } = await arrange({ erps: [] });
      try {
        await selectBling(page);
        await page.getByLabel("CNPJ da empresa emitente", { exact: true }).fill("26.517.729/0001-23");
        const link = page.getByRole("link", { name: "Conectar conta Bling", exact: true });
        await link.waitFor();
        assert.equal(await link.getAttribute("href"), "#erp-integrations");
        assert.equal(await page.getByRole("button", { name: "Conectar emissor", exact: true }).isDisabled(), true);
        await link.click(); assert.equal(new URL(page.url()).hash, "#erp-integrations");
        assert.equal(state.calls.filter(c => c.method === "PUT").length, 0);
        await page.screenshot({ path: artifacts + "bling-no-account.png", fullPage: true });
      } finally { await context.close(); }
    });
    await run("Bling requires an explicit choice between multiple accounts", async () => {
      const { context, page, state } = await arrange({ erps: [eligibleAccount, { ...eligibleAccount, id: "bling-owned-b" }] });
      try {
        await selectBling(page); await page.getByLabel("CNPJ da empresa emitente", { exact: true }).fill("26.517.729/0001-23");
        assert.equal(await page.getByRole("button", { name: "Conectar emissor", exact: true }).isDisabled(), true);
        await page.getByText("Selecione a conta Bling que deve emitir as notas.", { exact: true }).waitFor();
        await page.getByLabel("Conexão Bling existente", { exact: true }).selectOption("bling-owned-b");
        await page.getByRole("button", { name: "Conectar emissor", exact: true }).click();
        await page.getByText("Conexão salva. Verifique a preparação antes de ativar.", { exact: true }).waitFor();
        assert.equal(state.connection.erpConnectionId, "bling-owned-b");
      } finally { await context.close(); }
    });
    await run("Bling reconnect prerequisite is visible", async () => {
      const { context, page } = await arrange({ erps: [{ ...eligibleAccount, status: "disconnected", requiresReconnect: true }] });
      try {
        await selectBling(page);
        await page.getByRole("link", { name: "Reconectar conta Bling", exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Conectar emissor", exact: true }).isDisabled(), true);
      } finally { await context.close(); }
    });
    await run("Absent serialized connection does not show a phantom provider", async () => {
      const { context, page } = await arrange({ existing: {} });
      try {
        await selectBling(page);
        assert.equal(await page.getByText(/Há uma conexão|está vinculada à emissão/).count(), 0);
        await page.getByLabel("CNPJ da empresa emitente", { exact: true }).fill("26.517.729/0001-23");
        assert.equal(await page.getByRole("button", { name: "Conectar emissor", exact: true }).isEnabled(), true);
      } finally { await context.close(); }
    });
    await run("Existing fiscal binding is not silently replaced by another Bling account", async () => {
      const { context, page, state } = await arrange({ existing: connection({ provider: "bling", environment: "production", issuerTaxId: "26.517.729/0001-23", erpConnectionId: "previous-account" }) });
      try {
        await page.getByLabel("Conexão Bling existente", { exact: true }).waitFor();
        assert.equal(await page.getByLabel("Conexão Bling existente", { exact: true }).inputValue(), "");
        assert.equal(await page.getByRole("button", { name: "Conectar emissor", exact: true }).isDisabled(), true);
        assert.equal(state.calls.filter(c => c.method === "PUT").length, 0);
      } finally { await context.close(); }
    });
    await run("Merchant change clears a previously selected account and CNPJ", async () => {
      const { context, page, state } = await arrange();
      try {
        await selectBling(page);
        await page.getByLabel("CNPJ da empresa emitente", { exact: true }).fill("26.517.729/0001-23");
        state.erps = [];
        await page.evaluate(() => window.fiscalUiFixture.setMerchant("merchant-b"));
        await page.getByRole("link", { name: "Conectar conta Bling", exact: true }).waitFor();
        assert.equal(await page.getByLabel("CNPJ da empresa emitente", { exact: true }).inputValue(), "");
        assert.equal(await page.getByLabel("Conexão Bling existente", { exact: true }).inputValue(), "");
        assert.equal(await page.getByRole("button", { name: "Conectar emissor", exact: true }).isDisabled(), true);
        assert.equal(state.calls.filter(c => c.method === "PUT").length, 0);
      } finally { await context.close(); }
    });
    await run("Unavailable ERP list has a recovery action instead of a false missing account", async () => {
      const key = "/v1/dashboard/inventory/erp-connections";
      const { context, page, state } = await arrange({ failures: { [key]: 503 } });
      try {
        await selectBling(page);
        await page.getByText("Não conseguimos carregar suas contas Bling.", { exact: true }).waitFor();
        assert.equal(await page.getByRole("link", { name: "Conectar conta Bling", exact: true }).count(), 0);
        await page.getByLabel("CNPJ da empresa emitente", { exact: true }).fill("26.517.729/0001-23");
        delete state.failures[key];
        await page.getByRole("button", { name: "Atualizar contas Bling", exact: true }).click();
        await page.getByText("Carregando configuração fiscal…", { exact: true }).waitFor({ state: "hidden" });
        assert.equal(await page.getByRole("button", { name: "Conectar emissor", exact: true }).isEnabled(), true);
        assert.equal(await page.getByLabel("CNPJ da empresa emitente", { exact: true }).inputValue(), "26.517.729/0001-23");
      } finally { await context.close(); }
    });
    for (const status of [401, 403]) await run("Fiscal authorization failure remains protected " + status, async () => {
      const { context, page, state } = await arrange({ failures: { "/connection": status } });
      try {
        await page.getByRole("alert").filter({ hasText: status === 401 ? "Faça login" : "Acesso negado" }).waitFor();
        assert.equal(await page.getByLabel("CNPJ da empresa emitente", { exact: true }).count(), 0);
        assert.equal(state.calls.filter(c => c.method === "PUT").length, 0);
      } finally { await context.close(); }
    });
    for (const status of [401, 403]) await run("ERP authorization failure preserves access guidance " + status, async () => {
      const key = "/v1/dashboard/inventory/erp-connections";
      const { context, page, state } = await arrange({ failures: { [key]: status } });
      try {
        await selectBling(page);
        await page.getByRole("alert").filter({ hasText: status === 401
          ? "Sessão expirada. Faça login para continuar."
          : "Acesso negado. Esta área exige proprietário ou administrador da loja." }).waitFor();
        assert.equal(await page.getByLabel("CNPJ da empresa emitente", { exact: true }).count(), 0);
        assert.equal(await page.getByRole("link", { name: "Conectar conta Bling", exact: true }).count(), 0);
        assert.equal(await page.getByRole("button", { name: "Atualizar contas Bling", exact: true }).count(), 0);
        assert.equal(state.calls.filter(c => c.method === "PUT").length, 0);
        delete state.failures[key];
        await page.getByRole("button", { name: "Atualizar dados", exact: true }).click();
        await page.getByLabel("CNPJ da empresa emitente", { exact: true }).fill("26.517.729/0001-23");
        assert.equal(await page.getByRole("button", { name: "Conectar emissor", exact: true }).isEnabled(), true);
      } finally { await context.close(); }
    });
    await run("A core connection read failure is not a usable empty account", async () => {
      const { context, page, state } = await arrange({ failures: { "/connection": 503 } });
      try {
        await page.getByText("Não conseguimos carregar a conexão fiscal. Atualize os dados para continuar.", { exact: true }).waitFor();
        await selectBling(page);
        await page.getByLabel("CNPJ da empresa emitente", { exact: true }).fill("26.517.729/0001-23");
        assert.equal(await page.getByRole("button", { name: "Conectar emissor", exact: true }).isDisabled(), true);
        delete state.failures["/connection"];
        await page.getByRole("button", { name: "Atualizar conexão", exact: true }).click();
        await selectBling(page); await page.getByLabel("CNPJ da empresa emitente", { exact: true }).fill("26.517.729/0001-23");
        assert.equal(await page.getByRole("button", { name: "Conectar emissor", exact: true }).isEnabled(), true);
      } finally { await context.close(); }
    });
  }
  if (group === "invoices" || group === "all") {
    for (const width of [390, 1586]) await run("Invoice first-use EmptyState opens configuration " + width, async () => {
      const { context, page } = await arrange({ screen: "invoices", width });
      try {
        await page.locator('[data-ui="empty-state"]').getByText("Nenhuma nota fiscal ainda", { exact: true }).waitFor();
        assert.equal(await page.locator('[data-ui="empty-state"]').count(), 1);
        assert.equal(await page.getByLabel("Ambiente fiscal", { exact: true }).count(), 0);
        assert.equal(await page.getByRole("button", { name: "Tentar novamente", exact: true }).count(), 0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const configureBounds = await page.getByRole("button", { name: "Configurar emissão", exact: true }).boundingBox();
        assert.ok(configureBounds && configureBounds.x >= 0 && configureBounds.x + configureBounds.width <= width,
          "The configuration action must be entirely inside the viewport: " + JSON.stringify({ width, configureBounds, layout: await page.locator('.page-header').evaluate(el => ({display: getComputedStyle(el).display, direction: getComputedStyle(el).flexDirection, wrap: getComputedStyle(el).flexWrap, width: getComputedStyle(el).width, grid: getComputedStyle(el).gridTemplateColumns})) }));
        await page.screenshot({ path: artifacts + `invoices-empty-${width}.png`, fullPage: true });
        await page.getByRole("button", { name: "Preparar emissão", exact: true }).click();
        await page.getByRole("heading", { name: "Configuração fiscal", exact: true }).waitFor();
        assert.ok(new URL(page.url()).hash.includes("environment=production"));
      } finally { await context.close(); }
    });
    await run("Invoice filtered EmptyState clears the actual server query", async () => {
      const { context, page, state } = await arrange({ screen: "invoices" });
      try {
        await page.getByLabel("Buscar pedido ou destinatário", { exact: true }).fill("pedido-ausente");
        await page.getByRole("button", { name: "Buscar notas", exact: true }).click();
        await page.locator('[data-ui="empty-state"]').getByText("Nenhuma nota encontrada", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Limpar filtros", exact: true }).click();
        await page.locator('[data-ui="empty-state"]').getByText("Nenhuma nota fiscal ainda", { exact: true }).waitFor();
        const last = state.calls.filter(c => c.path === "/invoices").at(-1);
        assert.equal(new URLSearchParams(last.search).get("search"), null);
        assert.equal(new URLSearchParams(last.search).get("environment"), "production");
        assert.equal(await page.getByLabel("Buscar pedido ou destinatário", { exact: true }).inputValue(), "");
      } finally { await context.close(); }
    });
    await run("Invoice failure is distinct from empty and refresh recovers", async () => {
      const { context, page, state } = await arrange({ screen: "invoices", failures: { "/invoices": 503 } });
      try {
        await page.locator('[data-ui="empty-state"]').getByText("Não foi possível carregar as notas", { exact: true }).waitFor();
        assert.equal(await page.getByText("Nenhuma nota fiscal ainda", { exact: true }).count(), 0);
        assert.equal(await page.getByRole("button", { name: "Tentar novamente", exact: true }).count(), 0);
        delete state.failures["/invoices"];
        await page.getByRole("button", { name: "Atualizar notas", exact: true }).click();
        await page.locator('[data-ui="empty-state"]').getByText("Nenhuma nota fiscal ainda", { exact: true }).waitFor();
      } finally { await context.close(); }
    });
    for (const status of [401, 403]) await run("Invoice authorization guidance and refresh " + status, async () => {
      const { context, page, state } = await arrange({ screen: "invoices", failures: { "/invoices": status } });
      try {
        await page.getByRole("alert").filter({ hasText: status === 401
          ? "Sessão expirada. Faça login para continuar."
          : "Acesso negado. Esta área exige proprietário ou administrador da loja." }).waitFor();
        assert.equal(await page.getByText("Nenhuma nota fiscal ainda", { exact: true }).count(), 0);
        assert.equal(await page.getByRole("button", { name: "Tentar novamente", exact: true }).count(), 0);
        assert.equal(state.calls.filter(c => c.method === "PUT").length, 0);
        delete state.failures["/invoices"];
        await page.getByRole("button", { name: "Atualizar notas", exact: true }).click();
        await page.locator('[data-ui="empty-state"]').getByText("Nenhuma nota fiscal ainda", { exact: true }).waitFor();
      } finally { await context.close(); }
    });
  }
  if (group === "help" || group === "all") {
    await run("Omie requires its complete application contract and clears submitted secrets", async () => {
      const { context, page, state } = await arrange();
      try {
        await page.getByLabel("Emissor fiscal", { exact: true }).selectOption("omie");
        const button = page.getByRole("button", { name: "Conectar emissor", exact: true });
        await page.getByLabel("Identificação do aplicativo Omie", { exact: true }).waitFor();
        await assertMeaning(page, "Identificação do aplicativo Omie", /chamado app_hash/);
        await assertMeaning(page, "Token fiscal do aplicativo Omie", /token da integração da sua empresa no Omie/);
        await assertMeaning(page, "Token de renovação fiscal", /refresh_token da mesma integração Omie/);
        await assertHelpLink(page, "Onde encontrar os dados da integração Omie", "https://api.omie.com.br/docs/apis/portal/autenticacao");
        await page.getByLabel("CNPJ da empresa emitente", { exact: true }).fill("26.517.729/0001-23");
        assert.equal(await button.isDisabled(), true);
        await page.getByLabel("Identificação do aplicativo Omie", { exact: true }).fill("omie-company-a");
        await page.getByLabel("Token fiscal do aplicativo Omie", { exact: true }).fill("synthetic-omie-access");
        assert.equal(await button.isDisabled(), true);
        await page.getByLabel("Token de renovação fiscal", { exact: true }).fill("synthetic-omie-refresh");
        assert.equal(await button.isDisabled(), true);
        await page.getByLabel("Token fiscal válido até", { exact: true }).fill("2027-05-20");
        for (const label of ["Token fiscal do aplicativo Omie", "Token de renovação fiscal"]) assert.equal(await page.getByLabel(label, { exact: true }).getAttribute("type"), "password");
        await button.click();
        await page.getByText("Conexão salva. Verifique a preparação antes de ativar.", { exact: true }).waitFor();
        const writes = state.calls.filter(c => c.method === "PUT");
        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0].body, { provider: "omie", environment: "production", issuerTaxId: "26.517.729/0001-23",
          stockOwner: "zyon", emailOwner: "zyon", whatsappOwner: "zyon", credential: { kind: "app_credentials", secret: JSON.stringify({
            contract: "omie_app_v1", environment: "production", issuerTaxId: "26517729000123", token: "synthetic-omie-access",
            refreshToken: "synthetic-omie-refresh", expiresAt: "2027-05-20T23:59:59.000Z", appHash: "omie-company-a" }) } });
        for (const label of ["Token fiscal do aplicativo Omie", "Token de renovação fiscal", "Identificação do aplicativo Omie"]) assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), "");
        assert.equal(await page.getByText("Conta Omie conectada · Emissão ainda não ativa.", { exact: false }).count(), 1);
        assert.equal(state.calls.filter(c => c.path.endsWith("/activate")).length, 0);
        assert.deepEqual(state.errors, []);
      } finally { await context.close(); }
    });
    await run("Tiny uses its read-only callback and private app keys without retaining them across providers", async () => {
      const { context, page, state } = await arrange();
      try {
        await page.getByLabel("Emissor fiscal", { exact: true }).selectOption("tiny");
        const redirect = page.getByLabel("URL de redirecionamento do aplicativo", { exact: true });
        await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.readOnly && input.value.includes('/olist/oauth/callback')));
        assert.equal(await redirect.inputValue(), new URL('/v1/webhooks/fiscal/olist/oauth/callback', page.url()).href);
        assert.equal(await redirect.getAttribute("readonly"), "");
        assert.equal(new URL(await redirect.inputValue()).hash, "");
        assert.equal(new URL(await redirect.inputValue()).search, "");
        await assertMeaning(page, "Identificação do aplicativo Tiny/Olist", /Client ID gerado no aplicativo da sua empresa/);
        await assertMeaning(page, "Segredo do aplicativo Tiny/Olist", /Client Secret do mesmo aplicativo/);
        await assertMeaning(page, "URL de redirecionamento do aplicativo", /voltar à Zyon após autorizar/);
        await assertHelpLink(page, "Como criar o aplicativo no Tiny/Olist", "https://api-docs.erp.olist.com/documentacao/comecando/criando-um-aplicativo");
        const button = page.getByRole("button", { name: "Autorizar conta no Tiny/Olist", exact: true });
        await page.getByLabel("CNPJ da empresa emitente", { exact: true }).fill("26.517.729/0001-23");
        assert.equal(await button.isDisabled(), true);
        await page.getByLabel("Identificação do aplicativo Tiny/Olist", { exact: true }).fill("synthetic-client");
        assert.equal(await button.isDisabled(), true);
        const secret = page.getByLabel("Segredo do aplicativo Tiny/Olist", { exact: true });
        await secret.fill("synthetic-client-secret");
        assert.equal(await secret.getAttribute("type"), "password");
        assert.equal(await button.isEnabled(), true);
        assert.equal(await page.getByLabel("Token de renovação fiscal", { exact: true }).count(), 0);
        await page.getByLabel("Emissor fiscal", { exact: true }).selectOption("omie");
        await page.getByLabel("Identificação do aplicativo Omie", { exact: true }).waitFor();
        await page.getByLabel("Emissor fiscal", { exact: true }).selectOption("tiny");
        assert.equal(await page.getByLabel("Identificação do aplicativo Tiny/Olist", { exact: true }).inputValue(), "");
        assert.equal(await page.getByLabel("Segredo do aplicativo Tiny/Olist", { exact: true }).inputValue(), "");
        assert.equal(state.calls.filter(c => c.method === "PUT" || c.method === "POST").length, 0);
      } finally { await context.close(); }
    });
    for (const status of [401, 403, 503]) await run("Tiny configuration failure preserves guidance and blocks authorization " + status, async () => {
      const { context, page, state } = await arrange({ failures: { "/olist/oauth/configuration": status } });
      try {
        await page.getByLabel("Emissor fiscal", { exact: true }).selectOption("tiny");
        await page.getByRole("alert").filter({ hasText: status === 401 ? "Sessão expirada. Faça login" : status === 403 ? "Acesso negado" : "Não conseguimos consultar a conexão Tiny/Olist" }).waitFor();
        await page.getByLabel("CNPJ da empresa emitente", { exact: true }).fill("26.517.729/0001-23");
        await page.getByLabel("Identificação do aplicativo Tiny/Olist", { exact: true }).fill("synthetic-client");
        await page.getByLabel("Segredo do aplicativo Tiny/Olist", { exact: true }).fill("synthetic-client-secret");
        assert.equal(await page.getByRole("button", { name: "Autorizar conta no Tiny/Olist", exact: true }).isDisabled(), true);
        assert.equal(await page.getByLabel("URL de redirecionamento do aplicativo", { exact: true }).inputValue(), "");
        assert.equal(state.calls.filter(c => (c.path.startsWith("/olist/") || c.path.startsWith("/connection")) && (c.method === "PUT" || c.method === "POST")).length, 0);
        assert.deepEqual(state.errors, []);
      } finally { await context.close(); }
    });
    for (const provider of ["focus", "bling", "omie", "tiny"]) for (const width of [390, 1586]) await run(`Every ${provider} fiscal field and checkbox explains its meaning ${width}`, async () => {
      const { context, page, state } = await arrange({ width, rich: true, existing: connection({ provider, environment: "production", issuerTaxId: "26517729000123", erpConnectionId: provider === "bling" ? eligibleAccount.id : null }) });
      try {
        await page.waitForFunction(p => document.querySelector('select')?.value === p && document.querySelectorAll('.fiscal-item').length === 1, provider);
        if (provider === "tiny") await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.readOnly && input.value.includes('/olist/oauth/callback')));
        await page.getByRole("button", { name: "Adicionar produto fiscal", exact: true }).click();
        await page.getByRole("button", { name: "Adicionar tributo ao produto 2", exact: true }).click();
        if (["bling", "tiny"].includes(provider)) await page.getByRole("button", { name: "Adicionar forma de pagamento ERP", exact: true }).click();
        const report = await page.evaluate(() => {
          const root = document.querySelector('.fiscal-page');
          const fields = [...root.querySelectorAll('.form-field')].map(field => {
            const label = field.querySelector('label'), control = field.querySelector('input,select,textarea');
            const help = control?.getAttribute('aria-describedby') && document.getElementById(control.getAttribute('aria-describedby'));
            const a = label?.getBoundingClientRect(), b = help?.getBoundingClientRect(), c = control?.getBoundingClientRect();
            return { label: label?.textContent, text: help?.textContent, ordered: !!a && !!b && !!c && b.top >= a.bottom - 1 && b.bottom <= c.top + 1, associated: !!help && field.contains(help) };
          });
          const checks = [...root.querySelectorAll('input[type="checkbox"]')].map(input => ({ checked: input.checked,
            label: root.querySelector(`label[for="${input.id}"]`)?.textContent,
            text: document.getElementById(input.getAttribute('aria-describedby'))?.textContent }));
          return { fields, checks, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.ok(report.fields.length >= 25, `Expected full configuration for ${provider}, got ${report.fields.length}`);
        assert.deepEqual(report.fields.filter(field => !field.text || !field.associated || !field.ordered), []);
        assert.ok(report.checks.length >= (provider === "focus" ? 2 : 12));
        assert.deepEqual(report.checks.filter(check => !check.text || !check.label || check.checked), []);
        const expectedChecks = ["Revisei esta configuração como responsável pela empresa ou contabilidade.", "Conferi a classificação da conta de pagamento."];
        if (provider !== "focus") expectedChecks.push("Conferi estes efeitos no painel do ERP com o responsável fiscal.",
          "Baixa estoque ao salvar pedido", "Baixa estoque ao autorizar nota", "Estorna estoque ao cancelar nota",
          "Gera financeiro ao salvar pedido", "Gera financeiro ao autorizar nota", "Estorna financeiro ao cancelar nota",
          "ERP envia e-mail automaticamente", "ERP gera nota automaticamente", "ERP autoriza nota automaticamente");
        assert.deepEqual(report.checks.map(check => check.label).sort(), expectedChecks.sort());
        const confirmProfile = page.getByRole("button", { name: "Confirmar perfil fiscal", exact: true });
        assert.equal(await confirmProfile.isDisabled(), true);
        await page.getByRole("checkbox", { name: expectedChecks.find(label => label.startsWith("Revisei")), exact: true }).check();
        assert.equal(await confirmProfile.isEnabled(), true);
        await page.getByRole("checkbox", { name: expectedChecks.find(label => label.startsWith("Revisei")), exact: true }).uncheck();
        assert.equal(await confirmProfile.isDisabled(), true);
        assert.equal(report.overflow, false);
        assert.deepEqual(state.errors, []);
        assert.equal(state.calls.filter(c => c.method === "PUT" || c.method === "POST").length, 0);
        await page.screenshot({ path: artifacts + `field-help-${provider}-${width}.png`, fullPage: true });
      } finally { await context.close(); }
    });
    for (const width of [390, 1586]) {
      await run("Invoice filter meanings and descriptions " + width, async () => {
        const { context, page, state } = await arrange({ width, screen: "invoices" });
        try {
          await assertMeaning(page, "Estado fiscal", /situação da emissão/);
          await assertMeaning(page, "Buscar pedido ou destinatário", /pedido ou o nome do comprador/);
          assert.equal(state.calls.filter(c => c.method === "PUT" || c.method === "POST").length, 0);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        } finally { await context.close(); }
      });
      await run("Cancellation dialog help and original confirmation safety " + width, async () => {
        const { context, page, state } = await arrange({ width, screen: "detail" });
        try {
          await page.getByRole("button", { name: "Solicitar cancelamento fiscal", exact: true }).click();
          const dialog = page.getByRole("dialog", { name: "Solicitar cancelamento fiscal", exact: true });
          await dialog.waitFor();
          await assertMeaning(page, "Justificativa do cancelamento fiscal", /por que a nota deve ser cancelada/);
          const input = page.getByRole("checkbox", { name: "Confirmo que desejo solicitar o cancelamento desta nota.", exact: true });
          assert.equal(await input.isChecked(), false);
          assert.match(await input.evaluate(el => document.getElementById(el.getAttribute('aria-describedby'))?.textContent ?? ""), /só será cancelada depois da confirmação fiscal/);
          const confirm = dialog.getByRole("button", { name: "Confirmar solicitação", exact: true });
          const reason = page.getByLabel("Justificativa do cancelamento fiscal", { exact: true });
          assert.equal(await confirm.isDisabled(), true);
          await reason.fill("x".repeat(14)); await input.check();
          assert.equal(await confirm.isDisabled(), true);
          await reason.fill("x".repeat(15));
          assert.equal(await confirm.isEnabled(), true);
          await input.uncheck();
          assert.equal(await confirm.isDisabled(), true);
          assert.equal(state.calls.filter(c => c.method === "PUT" || c.method === "POST").length, 0);
          assert.deepEqual(state.errors, []);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await page.screenshot({ path: artifacts + `cancellation-help-${width}.png`, fullPage: false });
          await dialog.getByRole("button", { name: "Voltar sem enviar", exact: true }).click();
        } finally { await context.close(); }
      });
    }
  }
  writeFileSync(artifacts + group + "-results.json", JSON.stringify({ status: "pass", cases: results.length, results }, null, 2));
  console.log(JSON.stringify({ status: "pass", cases: results.length, results }));
} catch (error) {
  writeFileSync(artifacts + group + "-failure.json", JSON.stringify({ status: "fail", case: activeCase,
    port, error: error.stack ?? String(error), completed: results }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
