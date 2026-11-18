import { expect, type Page } from "@playwright/test";
export async function fiscalDetailFixture(page: Page) {
  const base = await fiscalFixture(page, { connected: true });
  const state: any = {
    status: 200,
    actionStatus: 200,
    calls: [],
    detail: {
      id: "intent-a",
      orderId: "original-order",
      recipientName: "Maria S.",
      provider: "focus",
      state: "authorized",
      environment: "homologation",
      completedAt: "2026-11-16T12:00:00Z",
      totalCents: 10000,
      currency: "BRL",
      reasonCode: null,
      attempts: 1,
      nextAttemptAt: "2026-11-16T12:00:00Z",
      document: {
        intentId: "intent-a",
        sellerMerchantId: "seller-a",
        orderId: "original-order",
        state: "authorized",
        documentState: "available",
        number: "123",
        series: "1",
        authorizationProtocol: "135-original",
        accessKey: "1".repeat(44),
        authorizedAt: "2026-11-16T12:01:00Z",
        documents: [
          { kind: "xml", available: true },
          { kind: "danfe", available: true },
        ],
      },
      stock: { owner: "provider", state: "awaiting_provider_evidence" },
      deliveries: [
        { channel: "email", state: "accepted" },
        { channel: "whatsapp", state: "failed" },
      ],
      reviews: [
        {
          id: "review-a",
          triggerKind: "refund",
          reviewState: "action_required",
          safeReasonCode: null,
          confirmedAt: null,
          confirmedBy: null,
        },
      ],
      history: [
        {
          id: "e1",
          actorId: "owner-original",
          actorKind: "merchant",
          action: "authorized",
          previousState: "processing",
          nextState: "authorized",
          occurredAt: "2026-11-16T12:01:00Z",
          safeReasonCode: null,
        },
      ],
      allowedActions: [
        { kind: "reconcile", label: "Consultar" },
        {
          kind: "request_cancellation",
          reviewId: "review-a",
          label: "Cancelar",
        },
      ],
    },
  };
  base.profile = {
    id: "profile-corrected",
    version: 2,
    confirmedAt: "2026-11-16T12:02:00Z",
    confirmedBy: "owner",
    provider: "focus",
    environment: "homologation",
    operation: "sale",
    issuerRegime: "simples_nacional",
    itemRules: {},
    recipientRequirements: [],
    sourceContractVersion: contract.sourceContractVersion,
  };
  base.confirmedProfile = base.profile;
  await page.route(
    "**/v1/merchants/me/fiscal/invoices/intent-a**",
    async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      state.calls.push({
        path: u.pathname,
        method: req.method(),
        body: req.postDataJSON(),
      });
      if (state.hold) await state.hold;
      if (
        state.status !== 200 ||
        (req.method() === "POST" && state.actionStatus !== 200)
      )
        return route.fulfill({
          status: state.status !== 200 ? state.status : state.actionStatus,
          json: { code: "fiscal_cancellation_confirmation_required" },
        });
      if (u.pathname.includes("/documents/")) {
        const xml = u.pathname.endsWith("/xml");
        return route.fulfill({
          contentType: xml ? "application/xml" : "application/pdf",
          headers: {
            "content-disposition": `attachment; filename="nota-fiscal.${
              xml ? "xml" : "pdf"
            }"`,
          },
          body: xml
            ? "<nfeProc><protNFe>135-original</protNFe></nfeProc>"
            : "%PDF-1.4\noriginal-danfe\n%%EOF",
        });
      }
      if (u.pathname.endsWith("/cancellation")) {
        state.detail.reviews[0].reviewState = "pending";
        state.detail.history.push({
          id: "cancel-request",
          actorKind: "merchant",
          actorId: "owner-original",
          action: "cancellation_requested",
          previousState: "authorized",
          nextState: "authorized",
          occurredAt: "2026-11-16T12:03:00Z",
          safeReasonCode: null,
        });
      }
      if (u.pathname.endsWith("/reprocess")) {
        state.detail.state = "queued";
        state.detail.allowedActions = [
          { kind: "reconcile", label: "Consultar" },
        ];
      }
      return route.fulfill({ json: state.detail });
    }
  );
  return { state, base };
}
export const contract = {
  sourceContractVersion: "focus-nfe-v2-2026-11",
  operations: ["sale"],
  currencies: ["BRL"],
  issuerRegimes: ["simples_nacional", "lucro_real", "lucro_presumido"],
  productTypes: ["physical"],
  minimumRecipientRequirements: [
    "name",
    "taxId",
    "address.street",
    "address.number",
    "address.neighborhood",
    "address.city",
    "address.state",
    "address.postalCode",
    "address.cityCode",
  ],
};
export const providerList = ["focus", "bling", "omie", "tiny"].map((id) => ({
  id,
  label: (
    {
      focus: "Focus NF-e",
      bling: "Bling",
      omie: "Omie",
      tiny: "Tiny/Olist",
    } as Record<string, string>
  )[id],
  capabilities: {
    cancellation: id === "bling" ? "erp_panel" : "api",
    documents: ["xml", "danfe"],
  },
}));
export async function fiscalFixture(
  page: Page,
  options: {
    connected?: boolean;
    ready?: boolean;
    status?: number;
    delay?: boolean;
  } = {}
) {
  let releaseLoading: () => void = () => {};
  const loadingGate = options.delay
    ? new Promise<void>((resolve) => {
        releaseLoading = resolve;
      })
    : Promise.resolve();
  const state: any = {
    connection: options.connected ? connection() : null,
    profile: null,
    confirmedProfile: null,
    setup: {
      companyId: null,
      fiscalTimeZone: null,
      focusWebhookConfigured: false,
      paymentConfigurations: [],
      accountEvidence: null,
    },
    templates: {
      email: { subject: "Sua nota fiscal", body: "Consulte {{invoice_url}}" },
      suggested: {
        email: { subject: "Sua nota", body: "" },
        whatsapp: { body: "" },
      },
      whatsapp: {
        body: "Nota {{invoice_url}}",
        revision: 1,
        status: "DRAFT",
        rejectionReason: null,
        approvedVersions: [],
      },
      whatsappConnected: false,
      effectiveChannel: "email",
    },
    calls: [],
    status: options.status ?? 200,
    delay: !!options.delay,
  };
  function connection() {
    return {
      id: "connection-a",
      merchantId: "merchant-a",
      provider: "focus",
      environment: "homologation",
      issuerTaxId: "12ABC34501DE35",
      erpConnectionId: null,
      isActive: false,
      activatedAt: null,
      disconnectedAt: null,
      stockOwner: "zyon",
      emailOwner: "zyon",
      whatsappOwner: "zyon",
      readiness: [
        "authentication",
        "issuer",
        "certificate",
        "permissions",
        "environment",
        "stock_policy",
        "email_policy",
        "whatsapp_policy",
      ].map((code) => ({
        code,
        status: options.ready ? "verified" : "pending",
      })),
    };
  }
  await page.route("**/v1/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace("/v1/merchants/me/fiscal", ""),
      body = req.postDataJSON();
    if (
      !url.pathname.includes("/merchants/me/fiscal") &&
      !url.pathname.endsWith("/erp-connections")
    )
      return route.fallback();
    state.calls.push({ path, search: url.search, method: req.method(), body });
    if (state.delay) await loadingGate;
    if (state.status !== 200)
      return route.fulfill({
        status: state.status,
        json: { code: "tenant_role_required" },
      });
    let value: any = {};
    if (path === "/providers")
      value = {
        environment: url.searchParams.get("environment"),
        providers: providerList,
      };
    else if (path === "/connection" && req.method() === "GET")
      value = state.connection;
    else if (path === "/connection" && req.method() === "PUT") {
      state.connection = { ...connection(), ...body };
      delete state.connection.credential;
      value = state.connection;
    } else if (path.endsWith("/inspect")) {
      state.connection.readiness = connection().readiness.map((r) => ({
        ...r,
        status: "verified",
      }));
      value = state.connection;
    } else if (path.endsWith("/activate")) {
      state.connection.isActive = true;
      state.connection.activatedAt = "2026-11-16T12:00:00Z";
      value = state.connection;
    } else if (path.endsWith("/reconnect")) {
      state.connection.disconnectedAt = null;
      value = state.connection;
    } else if (path.startsWith("/connection/") && req.method() === "DELETE") {
      state.connection.isActive = false;
      state.connection.disconnectedAt = "2026-11-16T13:00:00Z";
      value = state.connection;
    } else if (path.endsWith("/setup")) {
      if (req.method() === "PUT") {
        state.setup = { ...state.setup, ...body };
        if (body.focusWebhook) state.setup.focusWebhookConfigured = true;
        if (body.paymentConfiguration)
          state.setup.paymentConfigurations = [
            {
              ...body.paymentConfiguration,
              provider: "stripe",
              confirmedAt: "2026-11-16T12:00:00Z",
            },
          ];
      }
      value = state.setup;
    } else if (path === "/profiles" && req.method() === "GET")
      value = {
        profile: state.profile,
        confirmedProfile: state.confirmedProfile,
        supportedContract: {
          ...contract,
          sourceContractVersion: (
            {
              focus: "focus-nfe-v2-2026-11",
              bling: "bling-v3-2026-11",
              omie: "omie-app-v1-2026-11",
              tiny: "olist-v3-2026-11",
            } as any
          )[url.searchParams.get("provider") ?? "focus"],
        },
      };
    else if (path === "/profiles" && req.method() === "POST") {
      state.profile = {
        ...body,
        id: "profile-a",
        version: 1,
        merchantId: "merchant-a",
        confirmedAt: null,
        confirmedBy: null,
      };
      value = state.profile;
    } else if (path.endsWith("/confirm")) {
      state.profile.confirmedAt = "2026-11-16T12:00:00Z";
      state.profile.confirmedBy = "owner";
      state.confirmedProfile = state.profile;
      value = state.profile;
    } else if (path === "/payment-sources")
      value = [
        {
          paymentIntentId: "private-source-a",
          provider: "stripe",
          method: "card",
          status: "approved",
          createdAt: "2026-11-16T10:00:00Z",
        },
      ];
    else if (path === "/templates") value = state.templates;
    else if (path === "/templates/email") {
      state.templates.email = body;
      value = { ...body, type: "fiscal_invoice", channel: "email" };
    } else if (path === "/templates/whatsapp") {
      state.templates.whatsapp = {
        ...state.templates.whatsapp,
        ...body,
        revision: 2,
        status: "DRAFT",
      };
      value = state.templates.whatsapp;
    } else if (path.endsWith("/submit")) {
      state.templates.whatsapp.status = "PENDING";
      value = state.templates.whatsapp;
    } else if (url.pathname.endsWith("/erp-connections"))
      value = [
        { id: "original-bling", provider: "bling", status: "connected" },
      ];
    return route.fulfill({ json: value });
  });
  state.releaseLoading = releaseLoading;
  return state;
}
export async function fillFocusProfile(page: Page) {
  await page
    .getByLabel("Regime tributário", { exact: true })
    .selectOption("simples_nacional");
  for (const [label, value] of Object.entries({
    "Natureza da operação": "Venda de mercadorias",
    "Tipo do documento": "1",
    "Finalidade da emissão": "1",
    "Destino da operação": "1",
    "Indicador de consumidor final": "1",
    "Presença do comprador": "2",
    "Modalidade do frete": "9",
    "Indicador de inscrição estadual": "9",
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByRole("button", { name: "Adicionar produto fiscal", exact: true })
    .click();
  for (const [label, value] of Object.entries({
    "SKU do produto": "SKU-A",
    NCM: "12345678",
    CFOP: "5102",
    "Origem da mercadoria": "0",
    "Unidade comercial": "UN",
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByRole("button", {
      name: "Adicionar tributo ao produto 1",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Tributo 1 do produto 1", { exact: true })
    .selectOption("icms_situacao_tributaria");
  await page
    .getByLabel("Valor do tributo 1 do produto 1", { exact: true })
    .fill("102");
  await page
    .getByRole("button", { name: "Salvar perfil fiscal", exact: true })
    .click();
  await expect(
    page.getByText("Configuração salva: versão 1", { exact: false })
  ).toBeVisible();
}
