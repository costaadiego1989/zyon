import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const dashboard = fileURLToPath(new URL("../", import.meta.url));
const requireDashboard = createRequire(new URL("../package.json", import.meta.url));
const { createServer } = await import(pathToFileURL(requireDashboard.resolve("vite")).href);
const { default: react } = await import(pathToFileURL(requireDashboard.resolve("@vitejs/plugin-react")).href);
const artifacts = fileURLToPath(new URL("../../../.specs/features/tiny-fiscal-completion/browser", import.meta.url));
mkdirSync(artifacts, { recursive: true });
const server = await createServer({ root: dashboard, configFile: false, plugins: [react()], logLevel: "error", server: { host: "127.0.0.1", port: 0, strictPort: true } });
let browser;
const results = [];
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  async function arrange(width, existing = false) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    const pageErrors = []; page.on("pageerror", error => pageErrors.push(error.message));
    const state = { connection: existing, notification: null, starts: [], completions: [], rotations: [], completeStatus: 201 };
    const authorizationState = "s".repeat(43);
    const target = new URL(base + "/tests/fiscal-olist.fixture.html?olist_fiscal=1#fiscal-settings?environment=homologation");
    const connection = { id: "tiny_browser_connection", merchantId: "merchant_fiscal_browser", provider: "tiny", environment: "homologation", issuerTaxId: "12ABC34501DE35", erpConnectionId: null, isActive: false, activatedAt: null, disconnectedAt: null, stockOwner: "zyon", emailOwner: "zyon", whatsappOwner: "zyon", readiness: [] };
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === "https://accounts.tiny.com.br") {
        assert.equal(url.pathname, "/realms/tiny/protocol/openid-connect/auth");
        assert.equal(url.searchParams.get("state"), authorizationState);
        const callback = new URL(base + "/v1/webhooks/fiscal/olist/oauth/callback"); callback.searchParams.set("state", authorizationState); callback.searchParams.set("code", "test-provider-code");
        return route.fulfill({ contentType: "text/html", body: `<html lang="pt-BR"><body><button onclick='location.href=${JSON.stringify(callback.toString())}'>Autorizar aplicativo de teste</button></body></html>` });
      }
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith("/v1/")) return route.continue();
      let body;
      const path = url.pathname, method = route.request().method();
      if (path.endsWith("/providers")) body = { environment: "homologation", providers: ["focus", "tiny", "bling", "omie"].map(id => ({ id, label: { focus: "Focus NF-e", tiny: "Tiny/Olist", bling: "Bling", omie: "Omie" }[id], capabilities: {} })) };
      else if (path.endsWith("/olist/oauth/callback")) {
        assert.equal(url.searchParams.get("state"), authorizationState);
        const location = new URL(target); location.searchParams.set("state", authorizationState); location.searchParams.set("code", url.searchParams.get("code"));
        return route.fulfill({ status: 302, headers: { location: location.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
      }
      else if (path.endsWith("/olist/oauth/configuration")) body = { redirectUri: base + "/v1/webhooks/fiscal/olist/oauth/callback" };
      else if (path.endsWith("/olist/oauth/authorize")) {
        const input = route.request().postDataJSON(); state.starts.push(input);
        assert.equal(input.clientId, "browser-private-app"); assert.equal(input.clientSecret, "browser-private-secret"); assert.equal(input.issuerTaxId, connection.issuerTaxId);
        assert.equal("token" in input, false); assert.equal("refreshToken" in input, false);
        body = { url: "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth?client_id=browser-private-app&state=" + authorizationState, state: authorizationState, redirectUri: base + "/v1/webhooks/fiscal/olist/oauth/callback", expiresInSeconds: 600 };
      } else if (path.endsWith("/olist/oauth/complete")) {
        state.completions.push(route.request().postDataJSON());
        if (state.completeStatus !== 201) return route.fulfill({ status: state.completeStatus, contentType: "application/json", body: JSON.stringify({ code: "fiscal_olist_authorization_expired_or_used" }) });
        state.connection = true; body = { connectionId: connection.id };
      } else if (path.endsWith("/notifications")) {
        if (method === "POST") { const input = route.request().postDataJSON(); state.rotations.push(input.rotate); state.notification = "https://api.example.test/v1/webhooks/fiscal/olist/tiny_browser_connection/notification?key=" + (input.rotate ? "new" : "old") + "-private-capability"; }
        body = { configured: !!state.notification, notificationUrl: state.notification };
      } else if (path.endsWith("/connection")) body = state.connection ? connection : null;
      else if (path.endsWith("/profiles")) body = { profile: null, confirmedProfile: null, supportedContract: null };
      else if (path.endsWith("/templates")) body = { email: { subject: "Nota", body: "Nota disponível" }, suggested: { email: { subject: "Nota", body: "Nota disponível" }, whatsapp: { body: "Nota disponível" } }, whatsapp: { body: "Nota disponível" } };
      else if (path.endsWith("/payment-sources")) body = [];
      else if (path.endsWith("/setup")) body = { companyId: null, fiscalTimeZone: null, focusWebhookConfigured: false, paymentConfigurations: [], accountEvidence: null };
      else throw new Error("Unhandled local fiscal browser route: " + path);
      return route.fulfill({ status: method === "POST" ? 201 : 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    return { context, page, state, target, authorizationState, pageErrors };
  }

  for (const width of [1440, 390]) {
    const a = await arrange(width);
    try {
      await a.page.goto(base + "/tests/fiscal-olist.fixture.html#fiscal-settings?environment=homologation");
      await a.page.getByLabel("Emissor fiscal", { exact: true }).selectOption("tiny");
      await a.page.getByLabel("CNPJ da empresa emitente", { exact: true }).fill("12ABC34501DE35");
      await a.page.getByLabel("Identificação do aplicativo Tiny/Olist", { exact: true }).fill("browser-private-app");
      await a.page.getByLabel("Segredo do aplicativo Tiny/Olist", { exact: true }).fill("browser-private-secret");
      await a.page.getByRole("button", { name: "Autorizar conta no Tiny/Olist", exact: true }).click();
      await a.page.getByRole("button", { name: "Autorizar aplicativo de teste", exact: true }).click();
      await a.page.getByRole("button", { name: "Preparar URL de notificação", exact: true }).waitFor();
      assert.equal(a.state.starts.length, 1); assert.equal(a.state.completions.length, 1);
      assert.deepEqual(a.state.completions[0], { environment: "homologation", state: a.authorizationState, code: "test-provider-code" });
      assert.equal(await a.page.getByRole("button", { name: "Conectar emissor", exact: true }).count(), 0);
      assert.equal(await a.page.getByLabel("Token de renovação fiscal", { exact: true }).count(), 0);
      assert.equal(new URL(a.page.url()).searchParams.has("code"), false); assert.equal(new URL(a.page.url()).searchParams.has("state"), false);
      assert.equal(await a.page.evaluate(() => sessionStorage.getItem("zyon:fiscal:olist:authorization")), null);
      await a.page.getByRole("button", { name: "Preparar URL de notificação", exact: true }).click();
      const field = a.page.getByLabel("URL privada de notificação Tiny/Olist", { exact: true }); await field.waitFor();
      assert.ok((await field.inputValue()).includes("old-private-capability"));
      await a.page.getByRole("button", { name: "Copiar URL de notificação", exact: true }).click();
      assert.equal(await a.page.evaluate(() => navigator.clipboard.readText()), await field.inputValue());
      await a.page.getByRole("button", { name: "Gerar nova URL", exact: true }).click();
      await a.page.getByRole("button", { name: "Cancelar", exact: true }).click(); assert.deepEqual(a.state.rotations, [false]);
      await a.page.getByRole("button", { name: "Gerar nova URL", exact: true }).click();
      await a.page.getByRole("button", { name: "Substituir URL", exact: true }).click();
      await a.page.waitForFunction(() => document.querySelector('input[value*="new-private-capability"]'));
      assert.deepEqual(a.state.rotations, [false, true]);
      assert.deepEqual(a.pageErrors, []);
      await a.page.screenshot({ path: artifacts + `/connected-${width}.png`, fullPage: true });
      results.push({ criterion: "TINY-04/TINY-05", width, verdict: "pass", completionCount: 1 });
    } finally { await a.context.close(); }
  }

  for (const invalid of ["foreign-state", "expired-state"]) {
    const a = await arrange(390);
    try {
      const url = new URL(a.target); url.searchParams.set("state", a.authorizationState); url.searchParams.set("code", "private-test-code");
      if (invalid === "expired-state") {
        a.state.completeStatus = 409;
        await a.context.addInitScript(({ state }) => sessionStorage.setItem("zyon:fiscal:olist:authorization", JSON.stringify({ state, environment: "homologation", merchantId: "merchant_fiscal_browser" })), { state: a.authorizationState });
      }
      await a.page.goto(url.toString());
      await a.page.getByRole("alert").filter({ hasText: invalid === "foreign-state" ? "não foi iniciada nesta sessão" : "venceu ou já foi usada" }).waitFor();
      assert.equal(a.state.completions.length, invalid === "foreign-state" ? 0 : 1);
      assert.equal(new URL(a.page.url()).searchParams.has("code"), false); assert.deepEqual(a.pageErrors, []);
      results.push({ criterion: "TINY-04", case: invalid, verdict: "pass" });
    } finally { await a.context.close(); }
  }
  writeFileSync(artifacts + "/results.json", JSON.stringify({ status: "pass", results, providerTransport: "local interception only; no external ERP login or writes" }, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ status: "pass", cases: results.length, results }) + "\n");
} finally {
  await browser?.close();
  await server.close();
}
