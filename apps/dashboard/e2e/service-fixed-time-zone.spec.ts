import { test, expect, type Page, type BrowserContext, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Existing owned T78 boundary; no API interception, fabricated profile or
// legacy-authority request field. Fixture/setup integration remains a Root gate.
const origin = "http://127.0.0.1:5187", BR = "America/Sao_Paulo", day = "2030-02-04";
type Fixture = { fixtureId: string; email: string; password: string; merchant_id: string; user_id: string; professionalId: string };
type Snapshot = { professionals: Array<Record<string, unknown>>; rows: Array<Record<string, unknown>>; [key: string]: unknown };
const path = (fixture: Fixture) => `/v1/merchants/${fixture.merchant_id}/service-professionals/${fixture.professionalId}`;
async function fixture(request: APIRequestContext, name: "catalog" | "recurring"): Promise<Fixture> {
  const response = await request.post("/__service/availability/" + name, { timeout: 10000 }); expect(response.status()).toBe(200); return response.json();
}
async function snapshot(request: APIRequestContext, fixture: Fixture): Promise<Snapshot> {
  const response = await request.get(`/__service/availability/${fixture.fixtureId}/snapshot`, { timeout: 10000 }); expect(response.status()).toBe(200); return response.json();
}
async function signIn(page: Page, context: BrowserContext, fixture: Fixture, tab: string) {
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
  await page.goto(`/?mode=signin#service-attendance?tab=${tab}&professionalId=${fixture.professionalId}&fromDate=${day}&toDate=${day}`);
  await page.getByLabel("E-mail", { exact: true }).fill(fixture.email); await page.getByLabel("Senha", { exact: true }).fill(fixture.password);
  const login = page.waitForResponse(value => new URL(value.url()).pathname === "/v1/auth/login" && value.request().method() === "POST", { timeout: 10000 });
  const profile = page.waitForResponse(value => new URL(value.url()).pathname === "/v1/merchants/me" && value.request().method() === "GET", { timeout: 10000 });
  await page.getByRole("button", { name: "Entrar", exact: true }).last().click(); expect((await login).status()).toBe(201);
  const response = await profile; expect(response.status()).toBe(200); const raw = await response.json(), me = raw.data ?? raw;
  expect(me.id).toBe(fixture.merchant_id); expect(me.businessMode).toBe("services"); expect(String(me.role).toUpperCase()).toBe("OWNER");
  await expect(page.getByRole("tabpanel", { name: tab === "professionals" ? "Profissionais" : "Disponibilidade", exact: true })).toBeVisible();
}
const zoneInputs = (page: Page) => page.getByLabel(/Fuso horário|Fuso da grade/, { exact: true });
function untouched(before: Snapshot, after: Snapshot, keys: string[]) { for (const key of keys) expect(after[key], key).toEqual(before[key]); }

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`T113 ${viewport.name} new professional uses Brasilia without a timezone chooser`, async ({ page, context, request }, info) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height }); const seed = await fixture(request, "catalog"), before = await snapshot(request, seed);
    await signIn(page, context, seed, "professionals"); await page.getByRole("button", { name: "Novo profissional", exact: true }).click();
    await expect(zoneInputs(page)).toHaveCount(0); await expect(page.getByRole("dialog")).toContainText("Horário de Brasília");
    const name = "Profissional Brasília " + randomUUID(); await page.getByLabel("Nome público", { exact: true }).fill(name);
    await page.screenshot({ path: info.outputPath("fixed-zone-professional.png"), fullPage: false });
    const sent = page.waitForResponse(value => new URL(value.url()).pathname === `/v1/merchants/${seed.merchant_id}/service-professionals` && value.request().method() === "POST", { timeout: 10000 });
    await page.getByRole("button", { name: "Salvar profissional", exact: true }).click(); const response = await sent; expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toMatchObject({ publicName: name, timeZone: BR }); const after = await snapshot(request, seed);
    expect(after.professionals).toContainEqual(expect.objectContaining({ public_name: name, time_zone: BR }));
    for (const previous of before.professionals) expect(after.professionals).toContainEqual(previous);
    untouched(before, after, ["rows", "exceptions", "appointments", "payments", "products", "variants", "prices", "users", "policy"]);
  });
  test(`T113 ${viewport.name} Brasilia grade keeps historical intervals and server authority`, async ({ page, context, request }, info) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height }); const seed = await fixture(request, "recurring"), before = await snapshot(request, seed);
    const previous = before.professionals.find(value => value.id === seed.professionalId)!; expect(previous.time_zone).toBe(BR);
    await signIn(page, context, seed, "availability");
    const read = page.waitForResponse(value => new URL(value.url()).pathname === path(seed) + "/availability" && value.request().method() === "GET", { timeout: 10000 });
    await page.getByRole("button", { name: "Consultar grade", exact: true }).click(); expect((await read).status()).toBe(200);
    await page.getByRole("button", { name: "Editar grade", exact: true }).click(); await expect(zoneInputs(page)).toHaveCount(0);
    await page.getByLabel("Início da faixa 1", { exact: true }).fill("10:00"); await page.getByLabel("Fim da faixa 1", { exact: true }).fill("11:00");
    await page.screenshot({ path: info.outputPath("fixed-zone-grade.png"), fullPage: false });
    const sent = page.waitForResponse(value => new URL(value.url()).pathname === path(seed) + "/availability" && value.request().method() === "PUT", { timeout: 10000 });
    await page.getByRole("button", { name: "Salvar grade", exact: true }).click(); const response = await sent; expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ expectedVersion: previous.version, timeZone: BR, rows: [{ weekday: 1, startMinute: 600, endMinute: 660 }] });
    await expect(page.getByText("Grade salva.", { exact: true })).toBeFocused(); const after = await snapshot(request, seed);
    expect(after.professionals.find(value => value.id === seed.professionalId)).toMatchObject({ time_zone: BR, version: Number(previous.version) + 1 });
    for (const row of before.rows.filter(value => value.is_active)) expect(after.rows).toContainEqual(expect.objectContaining({ id: row.id, is_active: false,
      time_zone: row.time_zone, start_minute: row.start_minute, end_minute: row.end_minute, valid_from: row.valid_from, valid_until: row.valid_until }));
    untouched(before, after, ["links", "exceptions", "appointments", "payments", "products", "variants", "prices", "users", "policy"]);
  });
}
