import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
const requireDashboard = createRequire(new URL("../package.json", import.meta.url));
const { createServer } = await import(pathToFileURL(requireDashboard.resolve("vite")).href);
const { default: react } = await import(pathToFileURL(requireDashboard.resolve("@vitejs/plugin-react")).href);
const group = process.argv[2] ?? "all";
assert.ok(["settings", "invoices", "all"].includes(group));
const artifacts = fileURLToPath(new URL("../../../.specs/features/fiscal-ui-review-20261127/browser/", import.meta.url));
mkdirSync(artifacts, { recursive: true });
const server = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
  plugins: [react()], define: { "import.meta.env.PROD": "true", "import.meta.env.DEV": "false" },
  optimizeDeps: { entries: ["tests/fiscal-ui-review.fixture.html"] }, logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: true } });
let browser;
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
    "/src/api-client.ts",
    "/src/styles.css",
  ].map(path => server.warmupRequest(path)));
  await server.waitForRequestsIdle();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  async function arrange({ screen = "settings", width = 1586, erps = [eligibleAccount], failures = {}, existing = null } = {}) {
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
      else if (path === "/profiles") body = { profile: null, confirmedProfile: null, supportedContract: null };
      else if (path === "/templates") body = { email: { subject: "Sua nota fiscal", body: "Consulte sua nota" }, whatsapp: { body: "Sua nota", status: "DRAFT", revision: 1, approvedVersions: [] }, whatsappConnected: false };
      else if (path === "/payment-sources") body = [];
      else if (path.endsWith("/setup")) body = { companyId: null, fiscalTimeZone: null, focusWebhookConfigured: false, paymentConfigurations: [], accountEvidence: null };
      else if (path === "/invoices") body = { items: state.invoices, total: state.total, counts: state.counts, page: Number(url.searchParams.get("page") ?? 1), pageSize: 20 };
      else if (path.endsWith("/erp-connections")) body = state.erps;
      else return route.fulfill({ status: 404, json: { code: "not_found" } });
      return route.fulfill({ json: body });
    });
    await page.goto(base + "/tests/fiscal-ui-review.fixture.html?screen=" + screen);
    await page.getByRole("heading", { name: screen === "invoices" ? "Notas fiscais" : "Configuração fiscal", exact: true }).waitFor();
    await page.getByText(screen === "invoices" ? "Carregando notas…" : "Carregando configuração fiscal…", { exact: true }).waitFor({ state: "hidden" });
    return { context, page, state };
  }
  async function run(name, work) {
    const start = Date.now();
    await Promise.race([work(), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("case deadline exceeded: " + name)), 30000); timer.unref(); })]);
    results.push({ name, status: "pass", durationMs: Date.now() - start });
    console.log("PASS " + name);
  }
  async function selectBling(page) {
    await page.getByLabel("Emissor fiscal", { exact: true }).selectOption("bling");
    await page.getByText("Carregando configuração fiscal…", { exact: true }).waitFor({ state: "hidden" });
  }
  if (group !== "invoices") {
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
  if (group !== "settings") {
    for (const width of [390, 1586]) await run("Invoice first-use EmptyState opens configuration " + width, async () => {
      const { context, page } = await arrange({ screen: "invoices", width });
      try {
        await page.locator('[data-ui="empty-state"]').getByText("Nenhuma nota fiscal ainda", { exact: true }).waitFor();
        assert.equal(await page.locator('[data-ui="empty-state"]').count(), 1);
        assert.equal(await page.getByLabel("Ambiente fiscal", { exact: true }).count(), 0);
        assert.equal(await page.getByRole("button", { name: "Tentar novamente", exact: true }).count(), 0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
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
  }
  writeFileSync(artifacts + group + "-results.json", JSON.stringify({ status: "pass", cases: results.length, results }, null, 2));
  console.log(JSON.stringify({ status: "pass", cases: results.length, results }));
} finally {
  await browser?.close();
  await server.close();
}
