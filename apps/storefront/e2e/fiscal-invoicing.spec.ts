import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { createHash } from "node:crypto";
import path from "node:path";
async function openStore(page: Page, url: string) {
  await page.goto(url);
  const decline = page.getByRole("button", { name: "Não aceito", exact: true });
  await decline.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await decline.isVisible()) await decline.click();
}
const control = "http://127.0.0.1:3024/v1";
async function scenario(request: APIRequestContext, mode = "authorized") {
  const r = await request.post(control + "/__scenario", { data: { mode } });
  expect(r.ok()).toBe(true);
  return await r.json();
}
async function authenticate(page: Page, s: any, foreign = false) {
  await page.addInitScript(
    ({ token, buyerId }) => {
      localStorage.setItem("zyon_buyer_token", token);
      localStorage.setItem(
        "zyon_buyer_session",
        JSON.stringify({
          token,
          globalUserId: buyerId,
          email: "buyer@example.invalid",
        })
      );
    },
    { token: foreign ? s.foreignToken : s.token, buyerId: s.buyerId }
  );
}
function deeplink(s: any, kind = "xml") {
  return (
    "/store/" + encodeURIComponent(s.slug) + "?" +
    new URLSearchParams({
      buyerHub: "orders",
      orderId: s.orderId,
      fiscalIntentId: s.intentId,
      fiscalEnvironment: "homologation",
      fiscalDocument: kind,
    })
  );
}
async function download(page: Page, kind: "XML" | "DANFE") {
  const next = page.waitForEvent("download");
  await page
    .getByRole("dialog", { name: "Hub do comprador" })
    .getByRole("button", { name: `Baixar ${kind}`, exact: true })
    .click();
  const d = await next;
  const stream = await d.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream!) chunks.push(c);
  return createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
}
for (const width of [390, 1440]) {
  test(`FISCAL-41 T50 real Next deeplink resolves owned order beyond first10 own-store and private files ${width}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await scenario(request);
    await authenticate(page, s);
    await openStore(page, deeplink(s));
    await expect(
      page.getByRole("dialog", { name: "Hub do comprador" })
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Pedidos", exact: true })
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("region", { name: `Notas fiscais do pedido ${s.orderId}` })
    ).toBeVisible();
    await expect(
      page.getByText("Protocolo de autorização: 151260029467289", {
        exact: true,
      })
    ).toBeVisible();
    expect(await download(page, "XML")).toBe(s.xmlHash);
    expect(await download(page, "DANFE")).toBe(s.pdfHash);
    const state = await (await request.get(control + "/__state")).json();
    expect(state.sellerPurchaseRows).toBe(12);
    expect(state.downloads).toBe(2);
    expect(state.providerWrites).toBe(1);
    expect(s.host).toBe(s.seller);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: path.resolve(
        __dirname,
        `../../../.specs/features/fiscal-invoicing/review-screenshots/t50-buyer-authorized-${width}.png`
      ),
    });
    const expanded = page
      .getByRole("button", { name: /Recolher pedido de/ })
      .first();
    await expanded.click();
    await expect(
      page.getByRole("region", { name: `Notas fiscais do pedido ${s.orderId}` })
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: /Expandir pedido de/ })
      .first()
      .click();
    await expect(
      page.getByText("Protocolo de autorização: 151260029467289", {
        exact: true,
      })
    ).toBeVisible();
  });
  test(`FISCAL-42 T50 anonymous notification waits for canonical email OTP and returns to exact order ${width}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await scenario(request);
    await openStore(page, deeplink(s, "danfe"));
    const hub = page.getByRole("dialog", { name: "Hub do comprador" });
    await expect(hub.getByLabel("E-mail", { exact: true })).toBeVisible();
    await expect(
      hub.getByText("151260029467289", { exact: false })
    ).toHaveCount(0);
    expect((await (await request.get(control + "/__state")).json()).reads).toBe(
      0
    );
    await hub
      .getByLabel("E-mail", { exact: true })
      .fill("buyer@example.invalid");
    await hub
      .getByRole("button", { name: "Enviar código por e-mail", exact: true })
      .click();
    await hub
      .getByLabel("Codigo de verificacao", { exact: true })
      .fill("123456");
    await hub
      .getByRole("button", { name: "Confirmar código", exact: true })
      .click();
    await expect(
      hub.getByText("Protocolo de autorização: 151260029467289", {
        exact: true,
      })
    ).toBeVisible();
    expect(await download(page, "DANFE")).toBe(s.pdfHash);
    expect(page.url()).toContain("fiscalEnvironment=homologation");
  });
  test(`FISCAL-42 T50 different buyer cannot resolve metadata or download ${width}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await scenario(request);
    await authenticate(page, s, true);
    await openStore(page, deeplink(s));
    await expect(
      page.getByRole("dialog", { name: "Hub do comprador" }).getByRole("alert")
    ).toContainText("Pedido não encontrado nesta conta");
    await expect(
      page.getByText("151260029467289", { exact: false })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Baixar XML", exact: true })
    ).toHaveCount(0);
    const denied = await request.get(
      `${control}/buyer/me/orders/${s.host}/${s.orderId}/fiscal/${s.intentId}/documents/xml?environment=homologation`,
      { headers: { authorization: `Bearer ${s.foreignToken}` } }
    );
    expect(denied.status()).toBe(404);
    expect(
      (await (await request.get(control + "/__state")).json()).downloads
    ).toBe(0);
  });
  test(`FISCAL-43 T50 processing and document pending retry show actual authorization ${width}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await scenario(request, "processing");
    await authenticate(page, s);
    const fiscalUrl = new URL(
      `/api/v1/buyer/me/orders/${encodeURIComponent(s.host)}/${encodeURIComponent(s.orderId)}/fiscal?environment=homologation`,
      "http://localhost:3001"
    ).href;
    const [metadata] = await Promise.all([
      page.waitForResponse(
        response => response.request().method() === "GET" && response.url() === fiscalUrl && response.status() === 200,
        { timeout: 0 }
      ),
      openStore(page, deeplink(s)),
    ]);
    await metadata.body();
    await expect(
      page.getByText("Estado fiscal: Em processamento", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("Chave de acesso", { exact: false })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Baixar XML · pendente", exact: true })
    ).toBeDisabled();
  });
  test(`FISCAL-66 T50 missing DANFE retries through actual protected file service ${width}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await scenario(request, "document_pending");
    await authenticate(page, s);
    await openStore(page, deeplink(s, "danfe"));
    await expect(
      page.getByText("Estado fiscal: Autorizada", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(
        "Arquivos em recuperação. A autorização confirmada permanece preservada.",
        { exact: true }
      )
    ).toBeVisible();
    const pendingBody = await (
      await request.get(
        `${control}/buyer/me/orders/${s.host}/${s.orderId}/fiscal?environment=homologation`,
        { headers: { authorization: `Bearer ${s.token}` } }
      )
    ).json();
    expect(pendingBody.items[0].documentState).toBe("document_pending");
    expect(pendingBody.items[0].state).toBe("authorized");
    await expect(
      page.getByRole("button", { name: "Baixar DANFE · pendente", exact: true })
    ).toBeDisabled();
    await request.post(control + "/__recover");
    await page
      .getByRole("button", { name: "Atualizar nota fiscal", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Baixar DANFE", exact: true })
    ).toBeEnabled();
    const hash = await download(page, "DANFE");
    expect(hash).toHaveLength(64);
    await expect(
      page.getByText("Estado fiscal: Autorizada", { exact: true })
    ).toBeVisible();
  });
  test(`FISCAL-47 T50 recoverable metadata error retains original XML ${width}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await scenario(request, "failure");
    await authenticate(page, s);
    await openStore(page, deeplink(s));
    await expect(
      page.getByRole("dialog", { name: "Hub do comprador" }).getByRole("alert")
    ).toContainText("Tente novamente");
    await request.post(control + "/__recover");
    await page
      .getByRole("button", { name: "Atualizar nota fiscal", exact: true })
      .click();
    await expect(
      page.getByText("Estado fiscal: Autorizada", { exact: true })
    ).toBeVisible();
    expect(await download(page, "XML")).toBe(s.xmlHash);
  });
  test(`FISCAL-43 T50 actual metadata loading shows no premature file action ${width}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await scenario(request, "loading");
    await authenticate(page, s);
    await openStore(page, deeplink(s));
    await expect(
      page.getByText("Carregando nota fiscal…", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Baixar XML", exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByText("Estado fiscal: Autorizada", { exact: true })
    ).toBeVisible();
    expect(await download(page, "XML")).toBe(s.xmlHash);
  });
  test(`FISCAL-47 T50 confirmed same-note cancellation retains original protected files ${width}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await scenario(request, "cancelled");
    await authenticate(page, s);
    await openStore(page, deeplink(s));
    await expect(
      page.getByText("Estado fiscal: Cancelada", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("Protocolo de autorização: 151260029467289", {
        exact: true,
      })
    ).toBeVisible();
    await expect(
      page.getByText("Protocolo de cancelamento: 151260029467299", {
        exact: true,
      })
    ).toBeVisible();
    expect(await download(page, "XML")).toBe(s.xmlHash);
    expect(await download(page, "DANFE")).toBe(s.pdfHash);
  });
  test(`FISCAL-44 T50 identity change ignores a late real private download and revokes Blob URLs ${width}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await scenario(request);
    await authenticate(page, s);
    await page.addInitScript(() => {
      const created = URL.createObjectURL.bind(URL),
        revoked = URL.revokeObjectURL.bind(URL);
      (window as any).__fiscalBlobCounts = { created: 0, revoked: 0 };
      URL.createObjectURL = (blob) => {
        (window as any).__fiscalBlobCounts.created++;
        return created(blob);
      };
      URL.revokeObjectURL = (url) => {
        (window as any).__fiscalBlobCounts.revoked++;
        revoked(url);
      };
    });
    await openStore(page, deeplink(s));
    await expect(
      page.getByText("Estado fiscal: Autorizada", { exact: true })
    ).toBeVisible();
    expect(await download(page, "XML")).toBe(s.xmlHash);
    await expect
      .poll(() => page.evaluate(() => (window as any).__fiscalBlobCounts))
      .toEqual({ created: 1, revoked: 1 });
    let release!: () => void, captured!: () => void, complete!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      ready = new Promise<void>((r) => (captured = r)),
      done = new Promise<void>((r) => (complete = r));
    await page.route(
      "**/buyer/me/orders/**/documents/danfe?*",
      async (route) => {
        try {
          const response = await route.fetch();
          captured();
          await gate;
          await route.fulfill({ response });
        } catch (e) {
          if (!page.isClosed()) await route.abort().catch(() => {});
        } finally {
          complete();
        }
      }
    );
    const downloaded: string[] = [];
    page.on("download", (d) => downloaded.push(d.suggestedFilename()));
    await page
      .getByRole("button", { name: "Baixar DANFE", exact: true })
      .click();
    await ready;
    await page.evaluate((token) => {
      localStorage.setItem("zyon_buyer_token", token);
      window.dispatchEvent(
        new StorageEvent("storage", { key: "zyon_buyer_token" })
      );
    }, s.foreignToken);
    await expect(
      page.getByText("Pedido não encontrado nesta conta.", { exact: true })
    ).toBeVisible();
    release();
    await done;
    await expect(
      page.getByText("151260029467289", { exact: false })
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as any).__fiscalBlobCounts)
    ).toEqual({ created: 1, revoked: 1 });
    expect(downloaded).toEqual([]);
    expect(
      (await (await request.get(control + "/__state")).json()).downloads
    ).toBe(2);
  });
  test(`FISCAL-41 T50 actual assistant returned invoice option reaches original order and protected XML ${width}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await scenario(request, "disconnected");
    await authenticate(page, s);
    await openStore(page, "/store/" + s.slug);
    await page.getByRole("button", { name: /Por chat/ }).click();
    const composer = page.getByRole("textbox", {
      name: "Mensagem",
      exact: true,
    });
    await composer.fill("Nota fiscal do pedido " + s.orderId);
    await composer.press("Enter");
    const option = page.getByRole("link", {
      name: "Abrir XML no pedido",
      exact: true,
    });
    await expect(option).toBeVisible({ timeout: 20000 });
    expect(
      new URL((await option.getAttribute("href"))!, "http://localhost:3001")
        .pathname
    ).toBe("/store/" + s.slug);
    expect(
      Object.fromEntries(
        new URL((await option.getAttribute("href"))!, "http://localhost:3001")
          .searchParams
      )
    ).toEqual(
      Object.fromEntries(
        new URL(deeplink(s), "http://localhost:3001").searchParams
      )
    );
    await option.click();
    await expect(
      page.getByText("Protocolo de autorização: 151260029467289", {
        exact: true,
      })
    ).toBeVisible();
    expect(await download(page, "XML")).toBe(s.xmlHash);
    expect(
      (await (await request.get(control + "/__state")).json()).assistantOptions
    ).toBe(1);
    const values = await page.evaluate(() => Object.entries(localStorage));
    expect(
      values.some(
        ([k, v]) =>
          /fiscal.*(?:xml|pdf|private)/i.test(k) ||
          v.includes("private_company_token") ||
          v.includes("privateObjectKey")
      )
    ).toBe(false);
  });
}
