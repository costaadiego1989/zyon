import { test, expect } from "@playwright/test";
import { fiscalShellFixture } from "./fiscal-shell-fixture.js";
import {
  fiscalFixture,
  fillFocusProfile,
  fiscalDetailFixture,
} from "./fiscal-fixture.js";
test.use({ storageState: { cookies: [], origins: [] } });
for (const width of [390, 1440]) {
  test(`FISCAL-77/78 T51 native guidance and current font across actual fiscal routes ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { state } = await fiscalShellFixture(page);
    state.detail.document.documentState = "document_pending";
    state.detail.document.documents[1].available = false;
    const screens = [
      {
        hash: "#fiscal-settings",
        heading: "Configuração fiscal",
        guide: "Como preparar a emissão de notas",
        step: "Ative quando tudo estiver pronto",
      },
      {
        hash: "#fiscal-invoices",
        heading: "Notas fiscais",
        guide: "Como acompanhar suas notas",
        step: "Abra o detalhe para resolver pendências",
      },
      {
        hash: "#fiscal-detail?intentId=intent-a&environment=homologation",
        heading: "Detalhe fiscal",
        guide: "Como entender esta nota",
        step: "Confira arquivos, estoque e envios",
      },
    ];
    const seen = new Set<string>();
    for (const screen of screens) {
      await page.goto("/" + screen.hash);
      await expect(
        page.getByRole("heading", { name: screen.heading, exact: true })
      ).toBeVisible();
      if (screen.hash === "#fiscal-settings")
        await page
          .getByRole("button", {
            name: "Adicionar produto fiscal",
            exact: true,
          })
          .click();
      const headings = page.locator(".fiscal-page :is(h1,h2,h3)");
      await expect(headings.first()).toBeVisible();
      const fonts = await headings.evaluateAll((nodes) =>
        nodes.map((node) => ({
          tag: node.tagName,
          family: getComputedStyle(node)
            .fontFamily.split(",")[0]
            .replace(/["']/g, "")
            .trim(),
        }))
      );
      for (const heading of fonts) {
        seen.add(heading.tag);
        expect(heading.family).toBe("Manrope");
      }
      const guide = page.locator("details.setup-guide");
      await expect(guide).toHaveCount(1);
      await expect(guide).toHaveJSProperty("open", false);
      await guide.locator("summary").filter({ hasText: screen.guide }).click();
      await expect(guide).toHaveJSProperty("open", true);
      await expect(guide.getByText(screen.step, { exact: true })).toBeVisible();
      await guide.locator("summary").click();
      await expect(guide).toHaveJSProperty("open", false);
      await expect(
        guide.getByText(screen.step, { exact: true })
      ).not.toBeVisible();
      if (screen.heading === "Detalhe fiscal") {
        await expect(
          page.getByText(
            "Arquivos em recuperação. A autorização confirmada permanece preservada.",
            { exact: true }
          )
        ).toBeVisible();
        await expect(
          page.getByText("Protocolo de autorização: 135-original", {
            exact: false,
          })
        ).toBeVisible();
        await expect(
          page.getByText("Estado fiscal: Autorizada", { exact: false })
        ).toBeVisible();
        await expect(page.locator(".fiscal-page")).not.toContainText(
          "document_pending"
        );
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
    }
    expect([...seen].sort()).toEqual(["H1", "H2", "H3"]);
  });
  test(`FISCAL-59 T48 actual shell ERP named revision profile evidence and OAuth controls ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { base } = await fiscalShellFixture(page, "ADMIN");
    base.connection.provider = "bling";
    base.connection.erpConnectionId = "original-bling";
    base.profile = null;
    base.confirmedProfile = null;
    await page.goto("/#fiscal-settings");
    await expect(page.getByLabel("Emissor fiscal")).toHaveValue("bling");
    await page
      .getByLabel("Revisão da configuração fiscal ERP")
      .fill("revisao-contador-2");
    await expect(
      page.getByText("Revisão editada ainda não confirmada.", { exact: false })
    ).toBeVisible();
    await page
      .getByLabel("Regime tributário", { exact: true })
      .selectOption("simples_nacional");
    for (const [label, value] of Object.entries({
      "Código da loja no Bling": "1",
      "Código do regime tributário": "1",
      "Código de cupom fiscal": "0",
      "Frete por conta": "9",
      "Indicador de inscrição estadual": "9",
    }))
      await page.getByLabel(label, { exact: true }).fill(value);
    await page
      .getByRole("button", { name: "Adicionar produto fiscal", exact: true })
      .click();
    for (const [label, value] of Object.entries({
      "SKU do produto": "SKU-B",
      NCM: "61091000",
      CFOP: "5102",
      "Origem da mercadoria": "0",
      "Unidade comercial": "UN",
      "Código do produto no ERP": "12",
      "Código da natureza do produto no Bling": "34",
    }))
      await page.getByLabel(label, { exact: true }).fill(value);
    await page
      .getByRole("button", { name: "Adicionar tributo ao produto 1" })
      .click();
    await page
      .getByLabel("Tributo 1 do produto 1", { exact: true })
      .selectOption("simples.cst");
    await page
      .getByLabel("Valor do tributo 1 do produto 1", { exact: true })
      .fill("102");
    await page
      .getByRole("button", { name: "Adicionar forma de pagamento ERP" })
      .click();
    await page
      .getByLabel("Código fiscal do pagamento 1", { exact: true })
      .selectOption("03");
    await page.getByLabel("Código da forma de pagamento no ERP 1").fill("56");
    await page
      .getByRole("button", { name: "Salvar perfil fiscal", exact: true })
      .click();
    await expect(
      page.getByText("Configuração salva: versão 1", { exact: false })
    ).toBeVisible();
    expect(base.profile.itemRules.policyVersion).toBe("revisao-contador-2");
    expect(base.profile.itemRules.paymentMappings).toEqual({
      "03": { code: "03", id: 56 },
    });
    await page
      .getByLabel("Revisei esta configuração", { exact: false })
      .check();
    await page
      .getByRole("button", { name: "Confirmar perfil fiscal", exact: true })
      .click();
    await expect(
      page.getByText("Última confirmação: versão 1", { exact: false })
    ).toBeVisible();
    await page.getByLabel("Revisar esta confirmação até").fill("2027-01-01");
    await page.getByLabel("Certificado válido até").fill("2027-01-01");
    await page.getByLabel("Conferi estes efeitos", { exact: false }).check();
    await page
      .getByRole("button", { name: "Confirmar configuração ERP", exact: true })
      .click();
    await expect(
      page.getByText("Configuração do ERP salva.", { exact: false })
    ).toBeVisible();
    expect(base.setup.accountConfiguration.policyVersion).toBe(
      "revisao-contador-2"
    );
    expect(base.setup.accountConfiguration.profileVersionId).toBe("profile-a");
    await page.reload();
    await expect(
      page.getByLabel("Revisão da configuração fiscal ERP")
    ).toHaveValue("revisao-contador-2");
    for (const provider of ["omie", "tiny"]) {
      await page.getByLabel("Emissor fiscal").selectOption(provider);
      await page.getByLabel("CNPJ da empresa emitente").fill("12ABC34501DE35");
      await page
        .getByLabel(
          provider === "omie"
            ? "Identificação do aplicativo Omie"
            : "Identificação do aplicativo OAuth Olist"
        )
        .fill("app-original");
      await page
        .getByLabel("Token de renovação fiscal")
        .fill("private-refresh");
      await page.getByLabel("Token fiscal válido até").fill("2027-01-01");
      if (provider === "tiny")
        await page
          .getByLabel("Segredo do aplicativo OAuth Olist")
          .fill("private-client");
      await page
        .getByLabel(
          provider === "omie"
            ? "Token fiscal do aplicativo Omie"
            : "Token de acesso fiscal OAuth v3 Olist"
        )
        .fill("private-access");
      await page
        .getByRole("button", { name: "Conectar emissor", exact: true })
        .click();
      await expect(
        page.getByText(
          `Conta ${provider === "omie" ? "Omie" : "Tiny/Olist"} conectada`,
          { exact: false }
        )
      ).toBeVisible();
      const body = base.calls
        .filter((c: any) => c.path === "/connection" && c.method === "PUT")
        .at(-1).body;
      expect(JSON.parse(body.credential.secret)).toMatchObject({
        contract: provider === "omie" ? "omie_app_v1" : "olist_oauth_v3",
        environment: "homologation",
        issuerTaxId: "12ABC34501DE35",
        token: "private-access",
        refreshToken: "private-refresh",
      });
    }
  });
  test(`FISCAL-59 T48 actual shell sidebar mobile nav detail direct reload owner ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await fiscalShellFixture(page);
    await page.goto("/#fiscal-invoices");
    await expect(
      page.locator('[data-dashboard-page="fiscal-invoices"]')
    ).toBeVisible();
    await expect(
      page.getByText("original-order", { exact: true })
    ).toBeVisible();
    if (width === 390)
      await page
        .getByLabel("Navegar no dashboard")
        .selectOption("fiscal-settings");
    else {
      await page.getByRole("button", { name: /^Integrações/ }).click();
      await page
        .getByRole("button", { name: "Emissão fiscal", exact: true })
        .click();
    }
    await expect(
      page.getByRole("heading", { name: "Configuração fiscal", exact: true })
    ).toBeVisible();
    if (width === 390)
      await page
        .getByLabel("Navegar no dashboard")
        .selectOption("fiscal-invoices");
    else
      await page
        .getByRole("button", { name: "Notas fiscais", exact: true })
        .click();
    await page
      .getByRole("button", { name: "Abrir nota do pedido original-order" })
      .click();
    await expect(page).toHaveURL(
      /#fiscal-detail\?environment=homologation&intentId=intent-a/
    );
    await expect(
      page.getByText("Protocolo de autorização: 135-original", { exact: false })
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("Protocolo de autorização: 135-original", { exact: false })
    ).toBeVisible();
    await page.getByRole("button", { name: "Voltar às notas" }).click();
    await expect(
      page.getByRole("heading", { name: "Notas fiscais", exact: true })
    ).toBeVisible();
  });
  test(`FISCAL-59 T48 actual shell admin saved provider production correction ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { base, state } = await fiscalShellFixture(page, "ADMIN");
    base.connection.provider = "bling";
    base.connection.environment = "production";
    base.connection.erpConnectionId = "original-bling";
    base.profile = null;
    base.confirmedProfile = null;
    state.detail.environment = "production";
    state.detail.allowedActions = [{ kind: "configure", label: "Configurar" }];
    await page.goto("/#fiscal-detail?environment=production&intentId=intent-a");
    await page
      .getByRole("button", { name: "Corrigir configuração fiscal" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Configuração fiscal", exact: true })
    ).toBeVisible();
    await expect(page.getByLabel("Ambiente fiscal")).toHaveValue("production");
    await expect(page.getByLabel("Emissor fiscal")).toHaveValue("bling");
    await expect(page.getByLabel("Conexão Bling existente")).toHaveValue(
      "original-bling"
    );
    expect(
      base.calls.filter((c: any) => c.path === "/payment-sources").at(-1).search
    ).toContain("intentId=intent-a");
    await page.getByLabel("Emissor fiscal").selectOption("focus");
    await expect(page.getByLabel("Token da empresa Focus NF-e")).toBeVisible();
    await expect(page.getByLabel("Emissor fiscal")).toHaveValue("focus");
    await page.reload();
    await expect(page.getByLabel("Emissor fiscal")).toHaveValue("bling");
  });
  test(`FISCAL-59 T48 actual shell staff direct URL consistently denied ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { base, state } = await fiscalShellFixture(page, "STAFF");
    for (const hash of [
      "fiscal-invoices",
      "fiscal-settings",
      "fiscal-detail?intentId=intent-a&environment=homologation",
    ]) {
      await page.goto("/#" + hash);
      await expect(
        page.getByRole("dialog", { name: "Acesso restrito" })
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Configuração fiscal", exact: true })
      ).toHaveCount(0);
    }
    expect(state.calls.length).toBe(0);
    expect(
      base.calls.filter(
        (c: any) => c.path.startsWith("/profiles") || c.path === "/connection"
      )
    ).toHaveLength(0);
    if (width === 390)
      expect(
        await page
          .getByLabel("Navegar no dashboard")
          .locator('option[value="fiscal-invoices"]')
          .count()
      ).toBe(0);
    else
      await expect(
        page
          .getByRole("navigation", { name: "Módulos do painel" })
          .getByRole("button", { name: "Notas fiscais", exact: true })
      ).toHaveCount(0);
  });
  test(`FISCAL-59 T48 actual shell store switch and session return ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { session } = await fiscalShellFixture(page);
    await page.goto("/#fiscal-invoices");
    await expect(
      page.getByText("original-order", { exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "Loja A", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Trocar loja" })
      .getByRole("button", { name: /Loja B/ })
      .click();
    await expect(page.getByText("loja-b-order", { exact: true })).toBeVisible();
    await expect(page.getByText("original-order", { exact: true })).toHaveCount(
      0
    );
    session.authorized = false;
    await page.reload();
    await expect(
      page.locator('[data-dashboard-page="fiscal-invoices"]')
    ).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Acesso", exact: true })
      .getByRole("button", { name: "Entrar", exact: true })
      .click();
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
    session.authorized = true;
    await page.reload();
    await expect(page.getByText("loja-b-order", { exact: true })).toBeVisible();
  });
  test(`FISCAL-59 T47 detail real metadata independent outcomes and downloads ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { state } = await fiscalDetailFixture(page);
    await page.goto("/e2e/fiscal-harness.html?screen=detail");
    await expect(
      page.getByText("Protocolo de autorização: 135-original", { exact: false })
    ).toBeVisible();
    await expect(
      page.getByText("Estado fiscal: Autorizada", { exact: false })
    ).toBeVisible();
    await expect(
      page.getByText(
        "Estoque: Aguardando o emissor confirmar a baixa do estoque",
        { exact: false }
      )
    ).toBeVisible();
    await expect(page.getByText("E-mail: Aceito pelo canal")).toBeVisible();
    for (const kind of ["XML", "DANFE"]) {
      const pending = page.waitForEvent("download");
      await page
        .getByRole("button", { name: `Baixar ${kind}`, exact: true })
        .click();
      const download = await pending;
      expect(download.suggestedFilename()).toBe(
        kind === "XML" ? "nota-fiscal.xml" : "nota-fiscal.pdf"
      );
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString()).toContain(
        kind === "XML" ? "135-original" : "original-danfe"
      );
    }
    expect(
      state.calls.filter((c: any) => c.path.includes("/documents/")).length
    ).toBe(2);
  });
  test(`FISCAL-59 T47 detail processing and pending files retry preserve authorization ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { state } = await fiscalDetailFixture(page);
    state.detail.state = "processing";
    state.detail.document = {
      ...state.detail.document,
      number: undefined,
      accessKey: undefined,
      authorizationProtocol: undefined,
      documentState: "document_pending",
      documents: [
        { kind: "xml", available: false },
        { kind: "danfe", available: false },
      ],
    };
    await page.goto("/e2e/fiscal-harness.html?screen=detail");
    await expect(
      page.getByText("Estado fiscal: Em processamento", { exact: false })
    ).toBeVisible();
    await expect(
      page.getByText("A nota ainda aguarda autorização do emissor. Os arquivos ficarão disponíveis após a confirmação.", {exact:true})
    ).toBeVisible();
    await expect(
      page.getByText("Protocolo de autorização", { exact: false })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Baixar XML · pendente", exact: true })
    ).toBeDisabled();
    state.detail.state = "authorized";
    state.detail.document.authorizationProtocol = "135-confirmed";
    await page
      .getByRole("button", { name: "Consultar resultado fiscal" })
      .click();
    await expect(
      page.getByText("Estado fiscal: Autorizada", { exact: false })
    ).toBeVisible();
    await expect(
      page.getByText(
        "Arquivos em recuperação. A autorização confirmada permanece preservada.",
        { exact: false }
      )
    ).toBeVisible();
    state.detail.document.documents[0].available = true;
    await page.getByRole("button", { name: "Atualizar arquivos" }).click();
    await expect(
      page.getByRole("button", { name: "Baixar XML", exact: true })
    ).toBeEnabled();
    expect(
      state.calls
        .filter((c: any) => c.method === "POST")
        .map((c: any) => c.path)
    ).toEqual(["/v1/merchants/me/fiscal/invoices/intent-a/reconcile"]);
  });
  test(`FISCAL-59 T47 detail corrected reprocess uses confirmed profile and keeps errors ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { state } = await fiscalDetailFixture(page);
    state.detail.state = "rejected";
    state.detail.allowedActions = [
      { kind: "reprocess", label: "Reprocessar" },
      { kind: "configure", label: "Corrigir" },
    ];
    await page.goto("/e2e/fiscal-harness.html?screen=detail");
    await page
      .getByRole("button", { name: "Reprocessar", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("versão 2");
    state.actionStatus = 409;
    await page
      .getByRole("button", { name: "Confirmar reprocessamento", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Não foi possível concluir"
    );
    state.actionStatus = 200;
    await page
      .getByRole("button", { name: "Confirmar reprocessamento", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByText("Estado fiscal: Na fila", { exact: false })
    ).toBeVisible();
    expect(
      state.calls.filter((c: any) => c.path.endsWith("/reprocess")).at(-1).body
    ).toEqual({
      environment: "homologation",
      profileVersionId: "profile-corrected",
    });
  });
  test(`FISCAL-59 T47 detail explicit cancellation cancel no write then confirm pending ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { state } = await fiscalDetailFixture(page);
    await page.goto("/e2e/fiscal-harness.html?screen=detail");
    await page
      .getByRole("button", {
        name: "Solicitar cancelamento fiscal",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Confirmar solicitação", exact: true })
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Voltar sem enviar", exact: true })
      .click();
    expect(state.calls.filter((c: any) => c.method === "POST")).toHaveLength(0);
    await page
      .getByRole("button", {
        name: "Solicitar cancelamento fiscal",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Justificativa do cancelamento fiscal")
      .fill("Pedido reembolsado integralmente pelo comprador");
    await page
      .getByLabel("Confirmo que desejo solicitar", { exact: false })
      .check();
    state.actionStatus = 409;
    await page
      .getByRole("button", { name: "Confirmar solicitação", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    state.actionStatus = 200;
    await page
      .getByRole("button", { name: "Confirmar solicitação", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByText("Estado fiscal: Autorizada", { exact: false })
    ).toBeVisible();
    await expect(
      page.getByText("Aguardando confirmação fiscal", { exact: false })
    ).toBeVisible();
    expect(
      state.calls.filter((c: any) => c.path.endsWith("/cancellation")).at(-1)
        .body
    ).toEqual({
      environment: "homologation",
      reviewId: "review-a",
      confirmed: true,
      justification: "Pedido reembolsado integralmente pelo comprador",
    });
    await expect(
      page.getByText("Protocolo de cancelamento", { exact: false })
    ).toHaveCount(0);
  });
  test(`FISCAL-59 T47 detail ERP panel fallback and only allowed actions ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { state } = await fiscalDetailFixture(page);
    state.detail.provider = "bling";
    state.detail.allowedActions = [
      { kind: "erp_panel", label: "Cancelar no ERP" },
      { kind: "reconcile", label: "Consultar" },
    ];
    await page.goto("/e2e/fiscal-harness.html?screen=detail");
    await expect(
      page.getByRole("button", {
        name: "Solicitar cancelamento fiscal",
        exact: true,
      })
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Cancelar no ERP", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("pendência permanece");
    await page
      .getByRole("button", { name: "Voltar sem enviar", exact: true })
      .click();
    expect(state.calls.filter((c: any) => c.method === "POST")).toHaveLength(0);
    await page
      .getByRole("button", { name: "Consultar resultado fiscal" })
      .click();
    await expect(
      page.getByText("Estado fiscal: Autorizada", { exact: false })
    ).toBeVisible();
    await expect(
      page.getByText("Protocolo de autorização: 135-original", { exact: false })
    ).toBeVisible();
  });
  test(`FISCAL-59 T47 detail loading failure retry denied anonymous ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { state } = await fiscalDetailFixture(page);
    let release: () => void = () => {};
    state.hold = new Promise<void>((r) => {
      release = r;
    });
    state.status = 503;
    await page.goto("/e2e/fiscal-harness.html?screen=detail");
    await expect(page.getByRole("status")).toContainText(
      "Carregando detalhe fiscal"
    );
    release();
    await expect(page.getByRole("alert")).toContainText("Tente novamente");
    state.status = 200;
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(
      page.getByText("Pedido original-order", { exact: true })
    ).toBeVisible();
    state.status = 403;
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("Acesso negado");
    await expect(
      page.getByRole("button", { name: "Baixar XML", exact: true })
    ).toHaveCount(0);
    const before = state.calls.length;
    await page.goto("/e2e/fiscal-harness.html?screen=detail&anonymous=1");
    await expect(page.getByRole("alert")).toContainText("Faça login");
    expect(state.calls.length).toBe(before);
  });
  test(`FISCAL-59 T46 list original rows server counts and detail gesture ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/v1/merchants/me/fiscal/invoices?**", (r) =>
      r.fulfill({
        json: {
          items: [
            {
              id: "intent-a",
              orderId: "pedido-original",
              recipientName: "Maria S.",
              provider: "focus",
              state: "authorized",
              deliveries: [
                { channel: "email", state: "accepted" },
                { channel: "whatsapp", state: "failed" },
              ],
            },
          ],
          total: 901,
          counts: { authorized: 700, processing: 201 },
          page: 1,
          pageSize: 20,
        },
      })
    );
    await page.goto("/e2e/fiscal-harness.html?screen=list");
    await expect(page.getByText("901 notas e pendências")).toBeVisible();
    await expect(page.getByText("Autorizada: 700")).toBeVisible();
    await expect(page.getByText("Em processamento: 201")).toBeVisible();
    await expect(page.getByText("E-mail: Aceito pelo canal")).toBeVisible();
    await expect(page.getByText("WhatsApp: Falhou")).toBeVisible();
    await page
      .getByRole("button", { name: "Abrir nota do pedido pedido-original" })
      .click();
    await expect(page).toHaveURL(
      /#fiscal-detail\?intentId=intent-a&environment=homologation/
    );
  });
  test(`FISCAL-59 T46 list search filter pagination environment backend ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const calls: string[] = [];
    await page.route("**/v1/merchants/me/fiscal/invoices?**", async (r) => {
      const u = new URL(r.request().url());
      calls.push(u.search);
      await r.fulfill({
        json: {
          items: [
            {
              id: "i",
              orderId: `server-page-${u.searchParams.get("page")}`,
              recipientName: "Resultado",
              provider: "focus",
              state: "queued",
              deliveries: [],
            },
          ],
          total: 65,
          counts: { queued: 65 },
          page: Number(u.searchParams.get("page")),
          pageSize: 20,
        },
      });
    });
    await page.goto("/e2e/fiscal-harness.html?screen=list");
    await page.getByLabel("Buscar pedido ou destinatário").fill("Maria");
    await page
      .getByRole("button", { name: "Buscar notas", exact: true })
      .click();
    await expect.poll(() => calls.at(-1)).toContain("search=Maria");
    await page
      .getByLabel("Estado fiscal", { exact: true })
      .selectOption("queued");
    await expect.poll(() => calls.at(-1)).toContain("state=queued");
    await page.getByRole("button", { name: "Próxima página" }).click();
    await expect(
      page.getByText("server-page-2", { exact: true })
    ).toBeVisible();
    expect(calls.at(-1)).toContain("page=2");
    await page.getByLabel("Ambiente fiscal").selectOption("production");
    await expect(
      page.getByText("server-page-1", { exact: true })
    ).toBeVisible();
    expect(calls.at(-1)).toContain("environment=production");
    await page.getByRole("button", { name: "Atualizar notas" }).click();
    await expect(
      page.getByText("server-page-1", { exact: true })
    ).toBeVisible();
    expect(calls.length).toBeGreaterThanOrEqual(6);
  });
  test(`FISCAL-59 T46 list loading empty error retry ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let status = 503;
    await page.route("**/v1/merchants/me/fiscal/invoices?**", async (r) => {
      await gate;
      await r.fulfill({
        status,
        json:
          status === 200
            ? { items: [], total: 0, counts: {}, page: 1, pageSize: 20 }
            : { code: "fiscal_request_failed" },
      });
    });
    await page.goto("/e2e/fiscal-harness.html?screen=list");
    await expect(page.getByRole("status")).toContainText("Carregando notas");
    release();
    await expect(page.getByRole("alert")).toContainText("Tente novamente");
    status = 200;
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(
      page.getByText("Nenhuma nota encontrada", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("0 notas e pendências")).toBeVisible();
  });
  test(`FISCAL-59 T46 list denied and anonymous ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let reads = 0;
    await page.route("**/v1/merchants/me/fiscal/invoices?**", async (r) => {
      reads++;
      await r.fulfill({ status: 403, json: { code: "tenant_role_required" } });
    });
    await page.goto("/e2e/fiscal-harness.html?screen=list");
    await expect(page.getByRole("alert")).toContainText("Acesso negado");
    await expect(page.getByRole("table")).toHaveCount(0);
    const before = reads;
    await page.goto("/e2e/fiscal-harness.html?screen=list&anonymous=1");
    await expect(page.getByRole("alert")).toContainText("Faça login");
    expect(reads).toBe(before);
  });
  test(`FISCAL-59 T45 settings connect inspect activate reload ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await fiscalFixture(page);
    await page.goto("/e2e/fiscal-harness.html");
    await expect(
      page.getByText("Nenhuma conexão deste emissor", { exact: false })
    ).toBeVisible();
    await page.getByLabel("CNPJ da empresa emitente").fill("12ABC34501DE35");
    await page
      .getByLabel("Token da empresa Focus NF-e")
      .fill("synthetic-private");
    await page
      .getByRole("button", { name: "Conectar emissor", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Ativar emissão", exact: true })
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Verificar preparação", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Ativar emissão", exact: true })
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Ativar emissão", exact: true })
      .click();
    await expect(
      page.getByText(/^Conta Focus NF-e conectada · Emissão automática ativa/)
    ).toBeVisible();
    expect(s.connection.activatedAt).toBe("2026-11-16T12:00:00Z");
    await page.reload();
    await expect(
      page.getByText(/^Conta Focus NF-e conectada · Emissão automática ativa/)
    ).toBeVisible();
    expect(await page.locator("input[type=file]").count()).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  });
  test(`FISCAL-59 T45 settings profile draft confirm and reload ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await fiscalFixture(page, { connected: true });
    await page.goto("/e2e/fiscal-harness.html");
    await fillFocusProfile(page);
    expect(s.profile.itemRules.items["SKU-A"].taxes).toEqual({
      icms_situacao_tributaria: "102",
    });
    await page
      .getByLabel("Revisei esta configuração", { exact: false })
      .check();
    await page
      .getByRole("button", { name: "Confirmar perfil fiscal", exact: true })
      .click();
    await expect(
      page.getByText("Última confirmação: versão 1", { exact: false })
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("NCM", { exact: true })).toHaveValue(
      "12345678"
    );
    expect(s.confirmedProfile.confirmedBy).toBe("owner");
    expect(await page.getByRole("textbox").allTextContents()).not.toContain(
      "profile-a"
    );
  });
  test(`FISCAL-59 T45 settings company payment templates reconnect disconnect ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await fiscalFixture(page, { connected: true });
    await page.goto("/e2e/fiscal-harness.html");
    await page
      .getByLabel("Identificação da empresa na Focus")
      .fill("empresa-original");
    await page
      .getByLabel("Fuso horário fiscal", { exact: true })
      .fill("America/Sao_Paulo");
    await page
      .getByRole("button", { name: "Salvar empresa", exact: true })
      .click();
    await expect(
      page.getByText("Configuração da empresa salva.", { exact: true })
    ).toBeVisible();
    expect(s.setup.companyId).toBe("empresa-original");
    await page.getByLabel("Pagamento de referência").selectOption("0");
    await page
      .getByLabel("CNPJ da credenciadora", { exact: false })
      .fill("12345678000195");
    await page.getByLabel("Conferi a classificação", { exact: false }).check();
    await page
      .getByRole("button", {
        name: "Salvar classificação do pagamento",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Forma de pagamento salva.", { exact: false })
    ).toBeVisible();
    expect(s.setup.paymentConfigurations[0].paymentIntentId).toBe(
      "private-source-a"
    );
    await page
      .getByLabel("Assunto do e-mail fiscal")
      .fill("Documento da sua compra");
    await page
      .getByRole("button", { name: "Salvar e-mail fiscal", exact: true })
      .click();
    await expect(
      page.getByText("Modelo de e-mail fiscal salvo.", { exact: true })
    ).toBeVisible();
    expect(s.templates.email.subject).toBe("Documento da sua compra");
    await page
      .getByRole("button", { name: "Salvar modelo WhatsApp", exact: true })
      .click();
    await expect(
      page.getByText("Rascunho WhatsApp salvo.", { exact: false })
    ).toBeVisible();
    await page.getByLabel("Token da empresa Focus NF-e").fill("replacement");
    await page
      .getByRole("button", { name: "Reconectar conta", exact: true })
      .click();
    await expect(
      page.getByText("Reconexão registrada.", { exact: false })
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Desconectar", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancelar", exact: true })
      .click();
    expect(s.connection.disconnectedAt).toBeNull();
    await page
      .getByRole("button", { name: "Desconectar", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Desconectar emissor", exact: true })
      .click();
    await expect(
      page.getByText("Emissor desconectado.", { exact: false })
    ).toBeVisible();
    expect(s.connection.disconnectedAt).not.toBeNull();
  });
  test(`FISCAL-59 T45 settings loading failure retry denied ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await fiscalFixture(page, { status: 503, delay: true });
    await page.goto("/e2e/fiscal-harness.html");
    await expect(page.getByRole("status")).toContainText("Carregando");
    s.releaseLoading();
    await expect(page.getByRole("alert").first()).toContainText(
      "Tente novamente"
    );
    s.status = 200;
    await page
      .getByRole("button", { name: "Tentar novamente", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Conectar emissor", exact: true })
    ).toBeVisible();
    s.status = 403;
    await page.reload();
    await expect(page.getByRole("alert").first()).toContainText(
      "Acesso negado"
    );
    await expect(
      page.getByRole("button", { name: "Conectar emissor", exact: true })
    ).toHaveCount(0);
  });
}
