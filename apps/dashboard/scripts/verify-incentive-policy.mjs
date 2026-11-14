import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.env.REVENUE_UI_TEST_URL ?? "http://127.0.0.1:5187";
if (new URL(base).hostname !== "127.0.0.1") throw new Error("Local dashboard with controlled responses only");
const out = process.env.REVENUE_UI_SCREENSHOT_DIR;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(20_000); page.setDefaultNavigationTimeout(120_000);
    const errors = [], saves = [], receipts = new Map();
    page.on("pageerror", error => errors.push(error.message));
    let policy = { merchantId: "merchant-fixture", version: 0, policyHash: "a".repeat(64),
      mode: "automatic", enabled: false, limitCents: 0, maxDiscountCents: 0, maxRedemptions: 0 };
    let loseReply = false, conflictNext = false, foreignReply = false;
    await page.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      if (url.origin === base && !path.startsWith("/api/")) return route.continue();
      if (!["fetch", "xhr"].includes(req.resourceType())) return route.abort();
      let body = {}, status = 200;
      if (path.endsWith("/incentive-policy")) {
        if (req.method() === "PUT") {
          const command = req.postDataJSON(); saves.push(command);
          assert.equal(req.headers()["idempotency-key"], command.requestKey);
          if (receipts.has(command.requestKey)) body = receipts.get(command.requestKey);
          else if (conflictNext || command.expectedVersion !== policy.version) {
            conflictNext = false; policy = { ...policy, version: policy.version + 1, limitCents: 45000 };
            status = 409; body = { message: "INCENTIVE_POLICY_VERSION_CONFLICT" };
          } else {
            policy = { ...policy, mode: command.mode, version: policy.version + 1, ...(command.mode === "automatic"
              ? { enabled: false, limitCents: 0, maxDiscountCents: 0, maxRedemptions: 0 }
              : { enabled: command.enabled, limitCents: command.limitCents, maxDiscountCents: command.maxDiscountCents, maxRedemptions: command.maxRedemptions }) };
            body = { ...policy }; receipts.set(command.requestKey, body);
            if (loseReply) { loseReply = false; return route.abort("failed"); }
          }
        } else body = foreignReply ? { ...policy, merchantId: "foreign-store" } : policy;
      }
      else if (path.endsWith("/merchants/me")) body = { id: "merchant-fixture", name: "Loja", user_id: "owner", role: "OWNER", plan: "BOTH" };
      else if (path.endsWith("/merchants/me/stores")) body = { data: [{ id: "merchant-fixture", name: "Loja", slug: "fixture" }] };
      else if (path.endsWith("/onboarding")) body = { completed: true, steps: [] };
      else if (path.endsWith("/billing/subscription")) body = { plan: "scale", planKey: "scale", status: "active", effectivePlan: "scale", features: { revenueManager: true }, currentPeriodEnd: "2099-01-01T00:00:00Z" };
      else if (path.endsWith("/rules")) body = { autonomousEngineEnabled: true };
      else if (path.endsWith("/notifications")) body = { items: [] };
      else if (path.endsWith("/analysis-status")) body = { mode: "weekly", enabled: true, queue_available: true,
        next_eligible_at: "2026-10-06T06:00:00Z", last_successful_at: "2026-09-29T06:00:00Z", overdue: false, run: null };
      else if (["/observations", "/hypotheses", "/strategy-lessons"].some(p => path.endsWith(p))) body = [];
      else if (req.method() !== "GET") throw new Error(`Unexpected mutation: ${path}`);
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/#revenue-manager`, { waitUntil: "domcontentloaded" });
    const panel = page.locator("details.incentive-policy");
    await panel.getByText("A IA sugere os limites em cada proposta para sua aprovação", { exact: true }).waitFor();
    await panel.locator("summary").click();
    const total = panel.getByLabel("Total de descontos por teste (R$)", { exact: true });
    const discount = panel.getByLabel("Desconto máximo por pedido (R$)", { exact: true });
    const uses = panel.getByLabel("Máximo de usos por teste", { exact: true });
    const automatic = panel.getByRole("radio", { name: "IA sugere os limites", exact: true });
    const manual = panel.getByRole("radio", { name: "Definir limites adicionais", exact: true });
    const disabled = panel.getByRole("radio", { name: "Não oferecer descontos em novos testes", exact: true });
    const save = panel.getByRole("button", { name: "Salvar preferência", exact: true });
    assert.equal(await total.count(), 0); assert.equal(await automatic.isChecked(), true);
    assert.ok(await save.isDisabled()); assert.equal(saves.length, 0);
    await panel.getByText(/Você não precisa preencher valores/).waitFor();
    if (out) await panel.screenshot({ path: `${out}/incentive-policy-automatic-${width}.png` });
    await manual.check(); await total.fill("300,001"); await discount.fill("10,00"); await uses.fill("30");
    await save.click(); await panel.getByRole("alert").waitFor(); assert.equal(saves.length, 0);
    await total.fill("300,00"); await save.click();
    await panel.getByRole("status").filter({ hasText: "Preferência salva" }).waitFor();
    assert.equal(saves.length, 1); assert.equal(saves[0].limitCents, 30000); assert.equal(saves[0].maxDiscountCents, 1000);
    assert.ok(await save.isDisabled());
    assert.match(await panel.innerText(), /Nenhum teste foi iniciado/);

    // The server committed, but the client lost its response. Freeze the exact
    // command and reuse the same key; don't silently issue another permission.
    await total.fill("400,00"); loseReply = true; await save.click();
    await panel.getByRole("button", { name: "Confirmar salvamento", exact: true }).waitFor();
    assert.ok(await total.isDisabled()); assert.ok(await manual.isDisabled());
    await panel.getByRole("button", { name: "Confirmar salvamento", exact: true }).click();
    await panel.getByRole("status").filter({ hasText: "Preferência salva" }).waitFor();
    assert.equal(saves.length, 3); assert.deepEqual(saves[1], saves[2]); assert.equal(policy.version, 2);

    // Another tab saved first. Keep the draft without overwriting that change.
    await total.fill("500,00"); conflictNext = true; await save.click();
    await panel.getByRole("button", { name: "Manter meus valores", exact: true }).waitFor();
    assert.equal(await total.inputValue(), "500,00");
    assert.match(await panel.locator(".incentive-policy-conflict").innerText(), /450,00/);
    assert.equal(await save.count(), 0);
    await panel.getByRole("button", { name: "Manter meus valores", exact: true }).click(); await save.click();
    await panel.getByRole("status").filter({ hasText: "Preferência salva" }).waitFor();
    assert.equal(saves.at(-1).expectedVersion, 3); assert.equal(policy.version, 4);
    await disabled.check(); await save.click();
    await panel.getByRole("status").filter({ hasText: "Preferência salva" }).waitFor();
    assert.equal(policy.enabled, false); assert.equal(policy.limitCents, 50000);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (out) await panel.screenshot({ path: `${out}/incentive-policy-${width}.png` });
    for (const el of await panel.locator("button, input[type=text], summary").all()) {
      const box = await el.boundingBox();
      assert.ok(box.height >= 44, `Touch target below 44px: ${await el.evaluate(node => node.outerHTML)} (${box.height}px)`);
    }

    foreignReply = true; await page.reload({ waitUntil: "domcontentloaded" });
    await panel.getByText("Limites indisponíveis", { exact: true }).waitFor();
    await panel.locator("summary").click();
    assert.equal(await total.count(), 0); await panel.getByRole("button", { name: "Tentar novamente", exact: true }).waitFor();
    foreignReply = false; await panel.getByRole("button", { name: "Tentar novamente", exact: true }).click();
    await disabled.waitFor(); assert.equal(await disabled.isChecked(), true);
    await manual.check(); await total.waitFor(); assert.equal(await total.inputValue(), "500,00");
    await automatic.check(); assert.equal(await total.count(), 0);
    await save.click();
    await panel.getByRole("status").filter({ hasText: "Preferência salva" }).waitFor();
    assert.deepEqual(Object.keys(saves.at(-1)).sort(), ["expectedVersion", "mode", "requestKey"]);
    assert.equal(policy.mode, "automatic"); assert.equal(policy.enabled, false); assert.equal(policy.limitCents, 0);
    assert.equal(await total.count(), 0); assert.ok(await save.isDisabled());
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: automatic proposal limits without a form, optional manual limits, integer cents, lost-response retry, conflict, disable, explicit automatic reset, tenant validation and accessibility (controlled API)`);
    await page.close();
  }
} finally { await browser.close(); }
