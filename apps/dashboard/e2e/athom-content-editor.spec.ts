import { test, expect, type Page } from "@playwright/test";

async function faqServer(page: Page) {
  const records = new Map<string, any>(), writes: any[] = [];
  await page.route("**/__qa/faqs**", async route => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: [...records.values()] });
    if (request.method() === "DELETE") {
      records.delete(decodeURIComponent(new URL(request.url()).pathname.split("/").pop()!));
      return route.fulfill({ json: { deleted: true } });
    }
    const body = request.postDataJSON(); writes.push(body);
    if (body.id && !records.has(body.id)) return route.fulfill({ status: 404, json: { code: "product_content_resource_not_found" } });
    const record = { ...body, id: body.id ?? "server-faq-1", productId: "qa-product" };
    records.set(record.id, record); return route.fulfill({ status: body.id ? 200 : 201, json: record });
  });
  return { records, writes };
}

test("FAQ creates without an update ID and retains server identity across reload, edit and delete", async ({ page }) => {
  const server = await faqServer(page);
  await page.goto("/athom-content-editor.html");
  const editor = page.getByRole("region", { name: "FAQs", exact: true });
  await editor.getByRole("button", { name: "Adicionar FAQ", exact: true }).click();
  await editor.getByRole("textbox", { name: "Pergunta", exact: true }).fill("Como funciona o QA?");
  await editor.getByRole("textbox", { name: "Resposta", exact: true }).fill("Resposta de teste.");
  await editor.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(editor.getByText("Como funciona o QA?", { exact: true })).toBeVisible();
  expect(server.writes).toHaveLength(1); expect(server.writes[0]).not.toHaveProperty("id");
  expect(server.records.get("server-faq-1").answer).toBe("Resposta de teste.");
  await page.reload();
  await expect(editor.getByText("Como funciona o QA?", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Editar", exact: true }).click();
  await editor.getByRole("textbox", { name: "Resposta", exact: true }).fill("Resposta editada.");
  await editor.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(editor.getByText("Resposta editada.", { exact: true })).toBeVisible();
  expect(server.writes[1].id).toBe("server-faq-1");
  page.once("dialog", dialog => dialog.accept());
  await editor.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(editor.getByText("Como funciona o QA?", { exact: true })).toHaveCount(0);
  expect(server.records.size).toBe(0);
});

test("FAQ empty fields do not dispatch creation", async ({ page }) => {
  const server = await faqServer(page); await page.goto("/athom-content-editor.html");
  await page.getByRole("button", { name: "Adicionar FAQ", exact: true }).click();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Pergunta", exact: true })).toBeVisible();
  expect(server.writes).toHaveLength(0);
});

async function videoServer(page: Page) {
  const records = new Map<string, any>(), writes: any[] = [];
  await page.route("**/__qa/videos**", async route => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: [...records.values()] });
    if (request.method() === "DELETE") { records.delete(new URL(request.url()).pathname.split("/").pop()!); return route.fulfill({ json: {} }); }
    const body = request.postDataJSON(); writes.push(body);
    if (!body.title?.trim() || !body.videoUrl?.trim()) return route.fulfill({ status: 400, json: { code: "video_url_required" } });
    if (body.id && !records.has(body.id)) return route.fulfill({ status: 404, json: { code: "product_content_resource_not_found" } });
    const record = { ...body, id: body.id ?? "server-video-1", source: "merchant", productId: "qa-product" };
    records.set(record.id, record); return route.fulfill({ json: record });
  });
  await page.route("**/__qa/faqs", route => route.fulfill({ json: [] }));
  return { records, writes };
}

test("Video draft opens before writes, rejects invalid input and can be cancelled", async ({ page }) => {
  const server = await videoServer(page); await page.goto("/athom-content-editor.html");
  const editor = page.getByRole("region", { name: "Videos", exact: true });
  await editor.getByRole("button", { name: /Adicionar/ }).click();
  const title = editor.getByRole("textbox").first();
  await expect(title).toBeVisible(); expect(server.writes).toHaveLength(0);
  await editor.getByRole("button", { name: "Salvar", exact: true }).click();
  expect(server.writes).toHaveLength(0); await expect(title).toBeVisible();
  await title.fill("Video de teste");
  await editor.getByPlaceholder("https://www.youtube.com/watch?v=...").fill("https://evil-youtube.com/video");
  await editor.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(title).toBeVisible(); expect(server.writes).toHaveLength(0);
  await editor.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(title).toHaveCount(0); expect(server.records.size).toBe(0); expect(server.writes).toHaveLength(0);
});

test("Video persists new content without an update ID and edits the saved ID", async ({ page }) => {
  const server = await videoServer(page); await page.goto("/athom-content-editor.html");
  const editor = page.getByRole("region", { name: "Videos", exact: true });
  await editor.getByRole("button", { name: /Adicionar/ }).click();
  await editor.getByRole("textbox").first().fill("Video de teste");
  await editor.getByPlaceholder("https://www.youtube.com/watch?v=...").fill("https://www.youtube.com/watch?v=qa123");
  await editor.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(editor.getByText("Video de teste", { exact: true })).toBeVisible();
  expect(server.writes).toHaveLength(1); expect(server.writes[0]).not.toHaveProperty("id");
  expect(server.records.get("server-video-1").videoUrl).toBe("https://www.youtube.com/watch?v=qa123");
  await page.reload(); await expect(editor.getByText("Video de teste", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Editar", exact: true }).click();
  await editor.getByRole("textbox").first().fill("Video atualizado");
  await editor.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(editor.getByText("Video atualizado", { exact: true })).toBeVisible();
  expect(server.writes[1].id).toBe("server-video-1"); expect(server.records.size).toBe(1);
});

test("Orders explain429 without technical JSON and recover on retry", async ({ page }) => {
  let calls = 0;
  await page.route("**/v1/orders?*", route => {
    calls++;
    return calls === 1 ? route.fulfill({ status: 429, headers: { "Retry-After": "3" }, json: { code: "rate_limit_exceeded", internal: "technical-payload-must-not-appear" } })
      : route.fulfill({ json: { data: [], next_cursor: null, has_more: false } });
  });
  await page.goto("/athom-content-editor.html?mode=orders");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Aguarde 3 segundos");
  await expect(alert).not.toContainText("technical-payload");
  expect(calls).toBe(1);
  await alert.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Os pedidos da sua loja aparecem aqui", { exact: true })).toBeVisible();
  expect(calls).toBe(2);
});

test("Webhook Testar forwards a subscribed event and displays the queued delivery", async ({ page }) => {
  const writes: any[] = [];
  const endpoint = { id: "selected", url: "https://example.test/selected", enabled: true, events: ["customer.upserted"], signing_secret_hint: "redacted", created_at: "2026-11-16T12:00:00Z", updated_at: "2026-11-16T12:00:00Z" };
  await page.route("**/v1/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/integrations/api-keys")) return route.fulfill({ json: [] });
    if (url.pathname.endsWith("/selected/test")) {
      const body = route.request().postDataJSON(); writes.push(body);
      if (body?.event_type !== "customer.upserted") return route.fulfill({ status: 400, json: { code: "webhook_event_not_enabled_for_endpoint" } });
      return route.fulfill({ json: { id: "delivery-qa", endpoint_id: endpoint.id, endpoint_url: endpoint.url, event_id: "event-qa", event_type: body.event_type,
        status: "pending", attempts: 0, created_at: endpoint.created_at, updated_at: endpoint.updated_at } });
    }
    return route.fulfill({ json: { data: url.pathname.endsWith("/webhook-endpoints") ? [endpoint] : [], next_cursor: null, has_more: false } });
  });
  await page.goto("/athom-content-editor.html?mode=integrations");
  await page.getByRole("tab", { name: "Webhooks", exact: true }).click();
  await page.getByRole("button", { name: "Testar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Teste solicitado");
  expect(writes).toEqual([{ event_type: "customer.upserted" }]);
  await page.getByRole("tab", { name: "Histórico de entregas", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "customer.upserted" });
  await expect(row).toContainText("Pendente"); await expect(row).toContainText(endpoint.url);
});

test("Promotion price switch clears the old discount and persists after reload", async ({ page }) => {
  const writes: any[] = [];
  let saved = { id: "qa-promotion", productId: "qa-product", isActive: true, discountType: "percent" as string | null, discountValue: 10 as number | null,
    promoPriceInCents: null as number | null, couponId: null as string | null, startsAt: "2026-01-01T00:00:00Z", endsAt: "2030-01-01T00:00:00Z" };
  await page.route("**/v1/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/billing/subscription")) return route.fulfill({ json: { plan: "scale", features: {} } });
    if (url.pathname.endsWith("/promotion/qa-promotion")) {
      const body = route.request().postDataJSON(); writes.push(body); saved = { ...saved, ...body }; return route.fulfill({ json: saved });
    }
    if (url.pathname.endsWith("/promotion")) return route.fulfill({ json: { promotions: [saved] } });
    return route.fulfill({ json: { rules: [] } });
  });
  await page.goto("/athom-content-editor.html?mode=promotion");
  await page.getByRole("button", { name: "Preço promocional", exact: true }).click();
  await page.getByPlaceholder("0,00", { exact: true }).fill("47,50");
  await page.getByRole("button", { name: "Atualizar promoção", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ promoPriceInCents: 4750, discountType: null, discountValue: null, couponId: null });
  await page.reload();
  await expect(page.getByPlaceholder("0,00", { exact: true })).toHaveValue("47,50");
  await expect(page.getByText("Preço promocional (R$)", { exact: true })).toBeVisible();
});

async function activationServer(page: Page, mode: "normal" | "stale" | "measurement" | "retry" = "normal") {
  // Full-page fixture compilation competes with other isolated worktrees.
  // UI assertions retain their default 5-second limit after startup.
  test.setTimeout(90_000);
  const writes: Array<{ path: string; body: any }> = [];
  const experiment = { id: "qa-experiment", name: "Compare abordagens", status: "draft", created_at: "2026-11-16T12:00:00Z",
    variants: [{ id: "control", name: "Referência", weight: 50, is_control: true }, { id: "challenger", name: "Desafiante", weight: 50, is_control: false }] };
  let revision = "a".repeat(64), stale = mode === "stale", prepared = mode !== "measurement", failedPrepare = false, failedSend = false;
  const review = () => ({ experimentId: experiment.id, name: experiment.name, reviewHash: revision,
    variants: experiment.variants.map((v, i) => ({ ...v, isControl: v.is_control, systemPrompt: i === 0 ? "Responda às perguntas do comprador." : "Explique o próximo passo sem criar descontos." })),
    measurementRequired: mode === "measurement", canApprove: prepared, blockers: prepared ? [] : ["EXPERIMENT_MEASUREMENT_PLAN_REQUIRED"],
    measurementPlan: mode === "measurement" && prepared ? { durationDays: 7, conversionWindowHours: 24, minimumSessionsPerArm: 1200,
      baseline: { sessions: 1000, conversions: 100 }, trafficEstimate: { reachesPlannedSample: false } } : null });
  await page.route("**/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") writes.push({ path, body: request.postDataJSON() });
    if (path.endsWith("/activation-review")) return route.fulfill({ json: review() });
    if (path.endsWith("/prepare-activation")) {
      if (!failedPrepare) { failedPrepare = true; return route.fulfill({ status: 409, json: { message: "EXPERIMENT_INSUFFICIENT_PLANNING_BASELINE" } }); }
      prepared = true; revision = "b".repeat(64); return route.fulfill({ json: review() });
    }
    if (path.endsWith("/approve-and-start")) {
      if (stale) { stale = false; revision = "b".repeat(64); return route.fulfill({ status: 409, json: { message: "EXPERIMENT_REVIEW_STALE" } }); }
      if (mode === "retry" && !failedSend) { failedSend = true; return route.fulfill({ status: 503, json: { message: "temporary_failure" } }); }
      const body = request.postDataJSON();
      if (body.expected_review_hash !== revision || body.acknowledged !== true) return route.fulfill({ status: 409, json: { message: "EXPERIMENT_REVIEW_STALE" } });
      experiment.status = "running"; return route.fulfill({ status: 201, json: { experiment, approval: { reviewHash: revision } } });
    }
    if (path.endsWith("/results")) return route.fulfill({ json: { experiment_id: experiment.id, variant_results: [] } });
    if (path.endsWith("/dashboard/experiments")) return route.fulfill({ json: { data: [experiment] } });
    return route.fulfill({ json: { autonomousEngineEnabled: false } });
  });
  await page.goto("/athom-content-editor.html?mode=experiments", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Iniciar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Revisar e aprovar teste" });
  await expect(dialog.getByText("Responda às perguntas do comprador.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Explique o próximo passo sem criar descontos.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Referência · Referência · 50% do público", { exact: true })).toBeVisible();
  return { writes, dialog };
}

test("A/B approval opens read-only review and starts only after explicit acknowledgement", async ({ page }) => {
  const { writes, dialog } = await activationServer(page);
  const approve = dialog.getByRole("button", { name: "Aprovar e iniciar teste", exact: true });
  await expect(approve).toBeDisabled(); expect(writes).toEqual([]);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Iniciar", exact: true }).click();
  await dialog.getByRole("checkbox").check(); await approve.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Compare abordagens Em execução/ })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].path).toMatch(/approve-and-start$/);
  expect(writes[0].body).toEqual({ expected_review_hash: "a".repeat(64), request_key: expect.any(String), acknowledged: true });
  await page.reload(); await expect(page.getByRole("button", { name: /^Compare abordagens Em execução/ })).toBeVisible();
});

test("A/B approval rejects stale review and requires reload and fresh acknowledgement", async ({ page }) => {
  const { writes, dialog } = await activationServer(page, "stale");
  await dialog.getByRole("checkbox").check(); await dialog.getByRole("button", { name: "Aprovar e iniciar teste" }).click();
  await expect(dialog.getByRole("alert")).toContainText("O teste mudou desde sua revisão");
  await expect(dialog.getByRole("button", { name: "Aprovar e iniciar teste" })).toBeDisabled();
  expect(writes).toHaveLength(1);
  await dialog.getByRole("button", { name: "Recarregar revisão" }).click();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await dialog.getByRole("checkbox").check(); await dialog.getByRole("button", { name: "Aprovar e iniciar teste" }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes[1].body.expected_review_hash).toBe("b".repeat(64));
  expect(writes[1].body.request_key).not.toBe(writes[0].body.request_key);
});

test("A/B approval explains insufficient history and separates measurement preparation from approval", async ({ page }) => {
  const { writes, dialog } = await activationServer(page, "measurement");
  await expect(dialog.getByRole("checkbox")).toBeDisabled();
  await dialog.getByRole("button", { name: "Preparar plano de medição" }).click();
  await expect(dialog.getByText(/Ainda não há histórico maduro suficiente/)).toBeVisible();
  expect(writes.map(write => write.path.split("/").pop())).toEqual(["prepare-activation"]);
  await dialog.getByRole("button", { name: "Preparar plano de medição" }).click();
  await expect(dialog.getByRole("region", { name: "Plano de medição" })).toContainText("Duração: 7 dias");
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Aprovar e iniciar teste" })).toBeDisabled();
  await dialog.getByRole("checkbox").check(); await dialog.getByRole("button", { name: "Aprovar e iniciar teste" }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.map(write => write.path.split("/").pop())).toEqual(["prepare-activation", "prepare-activation", "approve-and-start"]);
});

test("A/B approval keeps its idempotency key on explicit retry after a server failure", async ({ page }) => {
  const { writes, dialog } = await activationServer(page, "retry");
  await dialog.getByRole("checkbox").check(); await dialog.getByRole("button", { name: "Aprovar e iniciar teste" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Não foi possível concluir");
  expect(writes).toHaveLength(1);
  await dialog.getByRole("button", { name: "Aprovar e iniciar teste" }).click();
  await expect(dialog).toHaveCount(0); expect(writes).toHaveLength(2);
  expect(writes[1].body).toEqual(writes[0].body);
});
