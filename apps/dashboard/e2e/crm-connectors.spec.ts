import { test, expect, type Page } from "@playwright/test";

async function mockApi(page: Page) {
  const state = { connections: [] as any[], connectFailure: false, disconnectFailure: false, oauthFailure: true, oauthStarts: 0, posts: [] as any[] };
  await page.route("**/audit-api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/audit-api/v1", "");
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (path === "/merchants/me") return json({ id: "merchant-a", name: "Loja de testes", user_id: "test-owner", role: "owner", plan: "BOTH" });
    if (path === "/billing/subscription") return json({ plan: "growth", status: "active", features: { crmIntegrations: true } });
    if (path === "/onboarding") return json({ completed: true, steps: [] });
    if (path === "/merchants/me/stores") return json({ data: [{ id: "merchant-a", name: "Loja de testes", role: "owner" }] });
    if (path === "/merchants/me/store-settings") return json({});
    if (path === "/inventory/crm/oauth/hubspot/authorize") {
      state.oauthStarts++;
      return state.oauthFailure ? json({ message: "crm_oauth_unavailable", private: "PRIVATE_PROVIDER_BODY" }, 503) :
        json({ url: "https://app.hubspot.com/oauth/authorize?client_id=fixture&state=fixture" });
    }
    if (path === "/dashboard/inventory/crm-connections") return json(state.connections);
    if (path === "/dashboard/inventory/crm-sync-log") return json([
      { id: "log1", email: "buyer@example.test", provider: "klaviyo", stage: "customer", status: "success", error_code: null, created_at: "2026-10-07T12:00:00Z" },
      { id: "log2", email: "denied@example.test", provider: "mailchimp", stage: "lead", status: "skipped", error_code: "contact_consent_not_granted", created_at: "2026-10-07T12:00:00Z" },
      { id: "log3", email: "failed@example.test", provider: "hubspot", stage: "customer", status: "failed", error_code: "inventory_crm_provider_failed", created_at: "2026-10-07T12:00:00Z" },
    ]);
    const connect = /crm-connections\/([^/]+)\/connect$/.exec(path);
    if (connect) {
      const body = request.postDataJSON(); state.posts.push({ provider: connect[1], body });
      if (state.connectFailure) return json({ message: "crm_credentials_invalid", private: "PRIVATE_PROVIDER_BODY" }, 400);
      const row = { id: `connection-${connect[1]}`, provider: connect[1], status: "connected", lastSyncAt: null, config: body.config };
      state.connections = [...state.connections.filter(c => c.provider !== row.provider), row];
      return json(row, 201);
    }
    const disconnect = /crm-connections\/([^/]+)\/disconnect$/.exec(path);
    if (disconnect) {
      if (state.disconnectFailure) return json({ message: "PRIVATE_PROVIDER_BODY" }, 503);
      state.connections = state.connections.filter(c => c.id !== disconnect[1]); return json({});
    }
    return json([]);
  });
  await page.route(/^https?:\/\/(?!localhost:5208)/, route => route.abort());
  return state;
}
const row = (page: Page, provider: string) => page.locator(".crm-provider-row").filter({ has: page.getByRole("heading", { name: provider, exact: true }) });

test("six providers are configurable; Mailchimp persists audience through reload and reconfiguration", async ({ page }, info) => {
  const state = await mockApi(page); await page.goto("/#crm-integrations");
  await expect(page.locator(".crm-provider-row")).toHaveCount(6);
  await expect(page.locator("body")).not.toContainText("Em breve");
  await row(page, "Mailchimp").getByRole("button", { name: "Conectar", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Chave de API", { exact: true }).fill("fixture-us21");
  await expect(modal.getByRole("button", { name: "Validar e conectar" })).toBeDisabled();
  await modal.getByLabel("ID do público (Audience ID)").fill("list123");
  await modal.getByRole("button", { name: "Validar e conectar" }).click();
  await expect(modal).toHaveCount(0);
  expect(state.posts).toEqual([{ provider: "mailchimp", body: { accessToken: "fixture-us21", config: { audienceId: "list123" } } }]);
  await page.reload(); await expect(row(page, "Mailchimp")).toContainText("Conectado");
  await row(page, "Mailchimp").getByRole("button", { name: "Reconfigurar" }).click();
  await expect(page.getByLabel("ID do público (Audience ID)")).toHaveValue("list123");
  await expect(page.getByLabel("Chave de API", { exact: true })).toHaveValue("");
  await page.screenshot({ path: info.outputPath("mailchimp-config.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("ActiveCampaign sends the account URL and credential failure remains editable without exposing provider data", async ({ page }) => {
  const state = await mockApi(page); state.connectFailure = true; await page.goto("/#crm-integrations");
  await row(page, "ActiveCampaign").getByRole("button", { name: "Conectar", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Chave de API", { exact: true }).fill("fixture-token");
  await modal.getByLabel("URL da API da sua conta").fill("https://account.api-us1.com");
  await modal.getByRole("button", { name: "Validar e conectar" }).click();
  await expect(modal.getByRole("alert")).toContainText("Não foi possível conectar");
  await expect(modal).not.toContainText("PRIVATE_PROVIDER_BODY");
  await expect(modal.getByLabel("URL da API da sua conta")).toHaveValue("https://account.api-us1.com");
  expect(state.posts[0].body.config).toEqual({ apiUrl: "https://account.api-us1.com" });
  state.connectFailure = false; await modal.getByRole("button", { name: "Validar e conectar" }).click();
  await expect(row(page, "ActiveCampaign")).toContainText("Conectado");
});

test("failed disconnect retains Klaviyo connection until a successful retry", async ({ page }) => {
  const state = await mockApi(page); state.connections = [{ id: "connection-klaviyo", provider: "klaviyo", status: "error", config: {} }];
  await page.goto("/#crm-integrations");
  await row(page, "Klaviyo").getByRole("button", { name: "Desconectar Klaviyo" }).click();
  state.disconnectFailure = true; await page.getByRole("dialog").getByRole("button", { name: "Desconectar", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  expect(state.connections).toHaveLength(1);
  state.disconnectFailure = false; await page.getByRole("dialog").getByRole("button", { name: "Desconectar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "Klaviyo")).toContainText("Não conectado");
});

test("ERP is reachable from Integrations and its route survives reload on desktop and mobile", async ({ page }, info) => {
  await mockApi(page); await page.goto("/#erp-integrations");
  await expect(page.getByRole("heading", { name: "ERP e marketplaces", exact: true })).toBeVisible();
  await expect(page.getByText("Bling", { exact: true }).first()).toBeVisible();
  await page.reload(); await expect(page.getByRole("heading", { name: "ERP e marketplaces", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Visão geral", exact: true })).toHaveCount(0);
  if (info.project.name === "desktop") {
    await page.getByRole("button", { name: /^Integrações/ }).click();
    await expect(page.getByRole("button", { name: "ERP e marketplaces", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "ERP e marketplaces", exact: true }).click();
  } else {
    const navigation = page.locator("select").first();
    await expect(navigation.locator('option[value="erp-integrations"]')).toHaveCount(1);
    await navigation.selectOption("crm-integrations");
    await expect(page.locator(".crm-provider-row")).toHaveCount(6);
    await navigation.selectOption("erp-integrations");
  }
  await expect(page.getByRole("heading", { name: "ERP e marketplaces", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("erp-integrations.png"), fullPage: true });
});

test("history distinguishes received, failed, and withheld contacts", async ({ page }) => {
  await mockApi(page); await page.goto("/#crm-integrations");
  await page.getByRole("tab", { name: "Histórico de sincronização", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "denied@example.test" })).toContainText("Sem consentimento");
  await page.getByLabel("Resultado da sincronização").selectOption("skipped");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("denied@example.test");
});

test("SaaS HubSpot connection uses customer authorization without asking for a private token", async ({ page }) => {
  const state = await mockApi(page); await page.goto("/#crm-integrations");
  await row(page, "HubSpot").getByRole("button", { name: "Conectar", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.locator('input[type="password"]')).toHaveCount(0);
  await expect(modal).toContainText("na sua conta HubSpot");
  await modal.getByRole("button", { name: "Autorizar no HubSpot" }).click();
  await expect(modal.getByRole("alert")).toContainText("Não foi possível iniciar");
  await expect(modal).not.toContainText("PRIVATE_PROVIDER_BODY");
  expect(state.oauthStarts).toBe(1); expect(state.posts).toHaveLength(0);
  state.oauthFailure = false;
  const navigation = page.waitForRequest(request => request.url().startsWith("https://app.hubspot.com/oauth/authorize"));
  await modal.getByRole("button", { name: "Autorizar no HubSpot" }).click();
  await navigation;
  expect(state.oauthStarts).toBe(2); expect(state.posts).toHaveLength(0);
});

test("RD Station explains the customer's API plan requirement without removing the SaaS connector", async ({ page }) => {
  await mockApi(page); await page.goto("/#crm-integrations");
  await row(page, "RD Station CRM").getByRole("button", { name: "Conectar", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("sua conta RD Station CRM precisa ter plano Basic, Pro ou Advanced");
  await expect(page.getByRole("dialog").getByLabel("Token de API do RD Station CRM")).toBeVisible();
});
