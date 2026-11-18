import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { TenantModule } from "../../../shared/tenant/tenant.module.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { registerTenantMiddleware } from "../../../shared/persistence/tenant.middleware.js";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { TenantRoleGuard } from "../../auth/presentation/tenant-role.guard.js";
import { JwtService } from "../../auth/domain/services/jwt.service.js";
import { AuthCookieService } from "../../auth/domain/services/auth-cookie.service.js";
import { PrismaAuthRepository } from "../../auth/infrastructure/prisma-auth.repository.js";
import { FiscalConfigurationController } from "./fiscal-configuration.controller.js";
import { FiscalTemplateController } from "./fiscal-template.controller.js";
import { FiscalConnectionService } from "../application/fiscal-connection.service.js";
import { FiscalProfileService } from "../application/fiscal-profile.service.js";
import { FiscalSetupService } from "../application/fiscal-setup.service.js";
import { PrismaFiscalConfigurationRepository } from "../infrastructure/prisma-fiscal-configuration.repository.js";
import { PrismaFiscalProfileRepository } from "../infrastructure/prisma-fiscal-profile.repository.js";
import { FiscalCredentialCipher } from "../infrastructure/fiscal-credential-cipher.js";
import { FiscalRuntimeConfiguration } from "../infrastructure/fiscal-runtime-configuration.js";
import {
  fiscalProfileSupport,
  FISCAL_PROFILE_CONTRACTS,
} from "../infrastructure/fiscal-profile-support.js";
import { RecoveryTemplateLifecycleUseCase } from "../../whatsapp-templates/application/use-cases/recovery-template-lifecycle.use-case.js";
import { PrismaRecoveryTemplateLifecycleRepository } from "../../whatsapp-templates/infrastructure/repositories/prisma-recovery-template-lifecycle.repository.js";
import { PrismaWhatsAppConfigRepository } from "../../whatsapp-channel/infrastructure/repositories/prisma-whatsapp-config.repository.js";
import { encryptErpSecret } from "../../../shared/crypto/erp-secret-cipher.js";
import { blingTokenGrantMetadata } from "../../../shared/integrations/bling-credentials.js";
import { blingClientFingerprint } from "../../../shared/integrations/bling-token-identity.js";
const scoped = Symbol("scoped");
const cipher = new FiscalCredentialCipher({
  AACP_PII_ENC_KEY: "fiscal-http-private-local-key",
});
let f: Awaited<ReturnType<typeof createFiscalFixture>>;
let jwt: JwtService;
const calls: Array<{
  url: string;
  method: string;
  authorization: string | null;
}> = [];
const state = {
  company: undefined as undefined | Record<string, unknown>,
  status: 200,
};
const grants: NodeJS.ProcessEnv = {};
const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
  calls.push({
    url: String(url),
    method: init?.method ?? "GET",
    authorization: new Headers(init?.headers).get("authorization"),
  });
  if (String(url).includes("/empresas/me/dados-basicos"))
    return Response.json({ data: { cnpj: "12ABC34501DE35" } });
  return Response.json(state.company ?? {}, { status: state.status });
}) as typeof fetch;
const originalEnv = {
  BLING_CLIENT_ID: process.env.BLING_CLIENT_ID,
  BLING_CLIENT_SECRET: process.env.BLING_CLIENT_SECRET,
  AACP_ERP_ENC_KEY: process.env.AACP_ERP_ENC_KEY,
};
before(
  async () => {
    Object.assign(process.env, {
      BLING_CLIENT_ID: "fiscal-http-app",
      BLING_CLIENT_SECRET: "fiscal-http-app-secret",
      AACP_ERP_ENC_KEY: "fiscal-http-erp-key",
    });
    f = await createFiscalFixture({
      imports: [TenantModule],
      controllers: [FiscalConfigurationController, FiscalTemplateController],
      providers: [
        AuthGuard,
        TenantRoleGuard,
        {
          provide: scoped,
          useFactory: (p: PrismaClient, t: TenantContextService) =>
            registerTenantMiddleware(p, t),
          inject: [PRISMA_CLIENT, TenantContextService],
        },
        {
          provide: JwtService,
          useFactory: (p: PrismaClient) =>
            (jwt = new JwtService(
              "fiscal-http-merchant-auth-secret",
              3600,
              new PrismaAuthRepository(p)
            )),
          inject: [PRISMA_CLIENT],
        },
        {
          provide: AuthCookieService,
          useFactory: () => new AuthCookieService(),
        },
        {
          provide: FiscalSetupService,
          useFactory: (p: PrismaClient, t: TenantContextService) => new FiscalSetupService(p, cipher, t),
          inject: [scoped, TenantContextService],
        },
        {
          provide: FiscalRuntimeConfiguration,
          useFactory: (p: PrismaClient, s: FiscalSetupService) =>
            new FiscalRuntimeConfiguration(p, cipher, s, grants, fetcher),
          inject: [scoped, FiscalSetupService],
        },
        {
          provide: FiscalConnectionService,
          useFactory: (p: PrismaClient, i: FiscalRuntimeConfiguration) =>
            new FiscalConnectionService(
              new PrismaFiscalConfigurationRepository(p),
              cipher,
              i
            ),
          inject: [scoped, FiscalRuntimeConfiguration],
        },
        {
          provide: FiscalProfileService,
          useFactory: (p: PrismaClient) =>
            new FiscalProfileService(
              new PrismaFiscalProfileRepository(p),
              fiscalProfileSupport
            ),
          inject: [scoped],
        },
        {
          provide: RecoveryTemplateLifecycleUseCase,
          useFactory: (p: PrismaClient) =>
            new RecoveryTemplateLifecycleUseCase(
              new PrismaRecoveryTemplateLifecycleRepository(p),
              {
                createAndSubmit: async () => {
                  throw new Error("no_remote_template_account");
                },
                syncStatus: async () => {
                  throw new Error("no_remote_template_account");
                },
              } as any,
              new PrismaWhatsAppConfigRepository(p)
            ),
          inject: [scoped],
        },
      ],
    });
  },
  { timeout: 120000 }
);
after(async () => {
  await f?.close();
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
async function actor(role: "owner" | "admin" | "staff" = "owner") {
  const merchantId = f.tag + "_" + crypto.randomUUID();
  await f.prisma.merchant.create({
    data: { id: merchantId, name: "Synthetic fiscal merchant" },
  });
  const user = await f.prisma.merchantUser.create({
    data: { merchantId, email: crypto.randomUUID() + "@example.test", role },
  });
  await f.prisma.merchantTeamMember.create({
    data: { merchantId, userId: user.id, role: role.toUpperCase() },
  });
  const token = await jwt.issue({
    merchantId,
    userId: user.id,
    email: user.email,
    role,
  });
  const request = (
    method: string,
    path: string,
    body?: unknown,
    auth = token
  ) =>
    fetch(f.first.url + "/v1/merchants/me/fiscal" + path, {
      method,
      headers: {
        ...(auth ? { authorization: "Bearer " + auth } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { merchantId, user, token, request };
}
async function connection(role: "owner" | "admin" = "owner") {
  const a = await actor(role);
  const body = {
    environment: "homologation",
    provider: "focus",
    issuerTaxId: "12ABC34501DE35",
    credential: { kind: "company_token", secret: "private_company_token" },
    stockOwner: "zyon",
    emailOwner: "zyon",
    whatsappOwner: "zyon",
  };
  const res = await a.request("PUT", "/connection", body);
  assert.equal(res.status, 200);
  const row = await res.json();
  await a.request("PUT", "/connection/" + row.id + "/setup", {
    environment: "homologation",
    companyId: "company_123",
    fiscalTimeZone: "America/Sao_Paulo",
  });
  state.status = 200;
  state.company = {
    id: "company_123",
    cnpj: body.issuerTaxId,
    habilita_nfe: true,
    certificado_cnpj: body.issuerTaxId,
    certificado_valido_de: "2020-01-01",
    certificado_valido_ate: "2099-01-01",
    enviar_email_destinatario: false,
    enviar_email_homologacao: false,
    token_homologacao: "private_company_token",
    token_producao: "production_secret",
  };
  return { ...a, body, row };
}
test("FISCAL-01 actual authenticated configuration HTTP lists four providers and requires explicit environment", async () => {
  const a = await actor();
  const r = await a.request("GET", "/providers?environment=homologation");
  assert.equal(r.status, 200);
  assert.deepEqual(
    (await r.json()).providers.map((v: any) => v.id),
    ["bling", "omie", "tiny", "focus"]
  );
  assert.equal((await a.request("GET", "/providers")).status, 400);
});
test("FISCAL-05 actual configuration HTTP encrypts company-only token with safe explicit public projection", async () => {
  const a = await connection();
  const stored = await f.prisma.fiscalConnection.findUniqueOrThrow({
    where: { id: a.row.id },
  });
  assert.equal(
    cipher.decrypt(stored.credentialCipher!),
    "private_company_token"
  );
  const res = await a.request("GET", "/connection?environment=homologation");
  const text = await res.text();
  for (const secret of [
    "private_company_token",
    "production_secret",
    "credentialCipher",
    "setupCipher",
  ])
    assert.equal(text.includes(secret), false);
  assert.equal(a.row.isActive, false);
});
test("FISCAL-02 actual Focus readiness uses management GET Basic and keeps homologation separate", async () => {
  const a = await connection();
  calls.length = 0;
  const res = await a.request("POST", "/connection/" + a.row.id + "/inspect", {
    environment: "homologation",
  });
  assert.equal(res.status, 201);
  const row = await res.json();
  assert.equal(
    row.readiness.filter((v: any) => v.status !== "verified").length,
    0
  );
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.focusnfe.com.br/v2/empresas/company_123"
  );
  assert.equal(calls[0].method, "GET");
  assert.equal(
    calls[0].authorization,
    "Basic " + Buffer.from("private_company_token:").toString("base64")
  );
  assert.equal(
    row.readiness.find((v: any) => v.code === "certificate").evidenceReference,
    "focus:company:company_123"
  );
});
test("FISCAL-03 activation records trusted actor and first cutoff before HTTP success", async () => {
  const a = await connection();
  const first = await (
    await a.request("POST", "/connection/" + a.row.id + "/activate", {
      environment: "homologation",
      actorId: "forged",
    })
  ).json();
  const repeated = await (
    await a.request("POST", "/connection/" + a.row.id + "/activate", {
      environment: "homologation",
    })
  ).json();
  assert.equal(first.isActive, true);
  assert.equal(first.activatedAt, repeated.activatedAt);
  const audit = await f.prisma.merchantAuditEvent.findFirstOrThrow({
    where: { resourceId: a.row.id, action: "fiscal.activate" },
  });
  assert.equal(audit.actorId, a.user.id);
  assert.notEqual(audit.actorId, "forged");
});
for (const [caseName, patch] of Object.entries({
  company: { id: "other_company" },
  issuer: { cnpj: "12345678000195" },
  environmentToken: { token_homologacao: "foreign_token" },
  certificate: { certificado_valido_ate: "2000-01-01" },
  disabled: { habilita_nfe: false },
}))
  test(
    "FISCAL-02 actual Focus " + caseName + " mismatch cannot activate",
    async () => {
      const a = await connection();
      state.company = { ...state.company, ...patch };
      const res = await a.request(
        "POST",
        "/connection/" + a.row.id + "/activate",
        { environment: "homologation" }
      );
      assert.equal(res.status, 409);
      assert.equal(
        (
          await f.prisma.fiscalConnection.findUniqueOrThrow({
            where: { id: a.row.id },
          })
        ).isActive,
        false
      );
    }
  );
test("FISCAL-02 provider404 or denied company read remains pending without fabricated certificate or master requirement", async () => {
  const a = await connection();
  for (const status of [404, 403, 503]) {
    state.status = status;
    const r = await a.request("POST", "/connection/" + a.row.id + "/activate", {
      environment: "homologation",
    });
    assert.equal(r.status, 409);
    assert.equal((await r.text()).includes("private_company_token"), false);
  }
  state.status = 200;
});
test("FISCAL-04 wrong environment and another merchant cannot inspect activate configure disconnect original connection", async () => {
  const a = await connection();
  const b = await actor();
  for (const path of ["/inspect", "/activate", "/reconnect"]) {
    const r = await b.request("POST", "/connection/" + a.row.id + path, {
      environment: "homologation",
      credential: a.body.credential,
    });
    assert.equal(r.status, 404);
  }
  assert.equal(
    (
      await b.request("PUT", "/connection/" + a.row.id + "/setup", {
        environment: "homologation",
        companyId: "other",
      })
    ).status,
    404
  );
  assert.equal(
    (
      await b.request(
        "DELETE",
        "/connection/" + a.row.id + "?environment=homologation"
      )
    ).status,
    404
  );
  assert.equal(
    (
      await a.request("POST", "/connection/" + a.row.id + "/inspect", {
        environment: "production",
      })
    ).status,
    404
  );
});
test("FISCAL-01 all configuration routes reject unauthenticated and staff actors", async () => {
  const a = await connection();
  const staff = await actor("staff");
  for (const [method, path, body] of [
    ["GET", "/providers?environment=homologation"],
    ["GET", "/connection?environment=homologation"],
    ["PUT", "/connection", a.body],
    [
      "POST",
      "/connection/" + a.row.id + "/activate",
      { environment: "homologation" },
    ],
    ["POST", "/profiles", { environment: "homologation" }],
    ["DELETE", "/connection/" + a.row.id + "?environment=homologation"],
  ] as const) {
    assert.equal((await a.request(method, path, body, "")).status, 401);
    assert.equal((await staff.request(method, path, body)).status, 403);
  }
});
test("FISCAL-05 invalid credentials and master kind never persist a connection", async () => {
  const a = await connection();
  const initial = await f.prisma.fiscalConnection.count({
    where: { merchantId: a.merchantId },
  });
  for (const patch of [
    { credential: { kind: "master_token", secret: "master" } },
    { issuerTaxId: "invalid" },
    { credential: { kind: "company_token", secret: "" } },
  ])
    assert.ok(
      (await a.request("PUT", "/connection", { ...a.body, ...patch })).status >=
        400
    );
  assert.equal(
    await f.prisma.fiscalConnection.count({
      where: { merchantId: a.merchantId },
    }),
    initial
  );
});
test("FISCAL-21 HTTP profile confirmation persists principal version and time and rejects unsupported contracts", async () => {
  const a = await connection("admin");
  const body = {
    environment: "homologation",
    provider: "focus",
    operation: "sale",
    issuerRegime: "simples_nacional",
    sourceContractVersion: FISCAL_PROFILE_CONTRACTS.focus,
    recipientRequirements: ["name", "taxId"],
    itemRules: {
      currency: "BRL",
      supportedProductTypes: ["physical"],
      items: {
        shirt: {
          productType: "physical",
          ncm: "61091000",
          cfop: "5102",
          origin: "0",
          unit: "UN",
          taxes: { icms_situacao_tributaria: "102" },
        },
      },
    },
  };
  const draft = await (await a.request("POST", "/profiles", body)).json();
  assert.equal(draft.confirmedAt, null);
  const confirmed = await a.request(
    "POST",
    "/profiles/" + draft.id + "/confirm",
    { environment: "homologation", confirmedBy: "forged" }
  );
  assert.equal(confirmed.status, 201);
  const row = await confirmed.json();
  assert.equal(row.confirmedBy, a.user.id);
  assert.equal(row.version, 1);
  assert.ok(row.confirmedAt);
  const bad = await (
    await a.request("POST", "/profiles", {
      ...body,
      sourceContractVersion: "invented_contract",
    })
  ).json();
  assert.equal(
    (
      await a.request("POST", "/profiles/" + bad.id + "/confirm", {
        environment: "homologation",
      })
    ).status,
    400
  );
  const b = await actor();
  assert.equal(
    (
      await b.request("POST", "/profiles/" + draft.id + "/confirm", {
        environment: "homologation",
      })
    ).status,
    404
  );
});
test("FISCAL-61 protected setup keeps Focus callback secret encrypted and public read contains only state", async () => {
  const a = await connection();
  const res = await a.request("PUT", "/connection/" + a.row.id + "/setup", {
    environment: "homologation",
    focusWebhook: {
      authorizationHeader: "x-private-focus-hook",
      authorization: "private_focus_callback_secret",
    },
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text.includes("private_focus_callback_secret"), false);
  assert.equal(text.includes("x-private-focus-hook"), false);
  assert.equal(JSON.parse(text).focusWebhookConfigured, true);
  const row = await f.prisma.fiscalConnection.findUniqueOrThrow({
    where: { id: a.row.id },
  });
  assert.equal(
    row.setupCipher!.includes("private_focus_callback_secret"),
    false
  );
  assert.equal(
    JSON.parse(cipher.decrypt(row.setupCipher!)).focusWebhook.authorization,
    "private_focus_callback_secret"
  );
});
test("FISCAL-62 concrete reconnect keeps original connection issuer environment and activation cutoff", async () => {
  const a = await connection();
  await a.request("POST", "/connection/" + a.row.id + "/activate", {
    environment: "homologation",
  });
  const before = await f.prisma.fiscalConnection.findUniqueOrThrow({
    where: { id: a.row.id },
  });
  assert.equal(
    (
      await a.request(
        "DELETE",
        "/connection/" + a.row.id + "?environment=homologation"
      )
    ).status,
    200
  );
  const res = await a.request(
    "POST",
    "/connection/" + a.row.id + "/reconnect",
    {
      environment: "homologation",
      credential: a.body.credential,
      issuerTaxId: "forged",
    }
  );
  assert.equal(res.status, 201);
  const row = await res.json();
  assert.equal(row.id, before.id);
  assert.equal(row.issuerTaxId, before.issuerTaxId);
  assert.equal(row.activatedAt, before.activatedAt!.toISOString());
  assert.equal(row.disconnectedAt, null);
  await a.request("POST", "/connection/" + a.row.id + "/activate", {
    environment: "homologation",
  });
  assert.equal(
    (
      await f.prisma.fiscalConnection.findUniqueOrThrow({
        where: { id: a.row.id },
      })
    ).activatedAt?.toISOString(),
    before.activatedAt!.toISOString()
  );
});
test("FISCAL-46 narrow fiscal template HTTP initializes only fiscal_invoice and preserves legitimate blocked setup", async () => {
  const a = await actor();
  const res = await a.request("GET", "/templates");
  assert.equal(res.status, 200);
  const row = await res.json();
  assert.equal(row.whatsapp.status, "waiting_connection");
  const rows = await f.prisma.postSaleMessageTemplate.findMany({
    where: { merchantId: a.merchantId },
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((v) => v.type === "fiscal_invoice"));
  const save = await a.request("PUT", "/templates/email", {
    subject: row.email.subject,
    body: row.email.body,
    revision: row.whatsapp.revision,
  });
  assert.equal(save.status, 200);
  const submit = await a.request("POST", "/templates/whatsapp/submit", {});
  assert.equal(submit.status, 201);
  assert.equal((await submit.json()).metaStatus, "waiting_connection");
});
test("FISCAL-18 actual protected Bling reconnect revalidates original shared ERP without a duplicate credential or cutoff change", async () => {
  const a = await actor();
  const token = "original_shared_bling_token";
  const metadata = blingTokenGrantMetadata({
    access_token: token,
    scope: ["fixture-readwrite"],
  });
  const erp = await f.prisma.erpConnection.create({
    data: {
      merchantId: a.merchantId,
      provider: "bling",
      status: "connected",
      accessTokenCipher: encryptErpSecret(token),
      refreshTokenCipher: encryptErpSecret("original_refresh"),
      tokenExpiresAt: new Date(Date.now() + 3600000),
      config: metadata,
    },
  });
  const connected = await a.request("PUT", "/connection", {
    environment: "homologation",
    provider: "bling",
    issuerTaxId: "12ABC34501DE35",
    erpConnectionId: erp.id,
    stockOwner: "zyon",
    emailOwner: "zyon",
    whatsappOwner: "zyon",
  });
  assert.equal(connected.status, 200);
  const row = await connected.json();
  assert.equal(
    (
      await f.prisma.fiscalConnection.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).credentialCipher,
    null
  );
  const profile = await f.prisma.fiscalProfileVersion.create({
    data: {
      merchantId: a.merchantId,
      environment: "homologation",
      provider: "bling",
      operation: "sale",
      version: 1,
      issuerRegime: "simples_nacional",
      itemRules: {},
      recipientRequirements: ["name", "taxId"],
      sourceContractVersion: FISCAL_PROFILE_CONTRACTS.bling,
      confirmedBy: a.user.id,
      confirmedAt: new Date(),
    },
  });
  const scope = {
    merchantId: a.merchantId,
    connectionId: row.id,
    provider: "bling",
    environment: "homologation",
    issuerTaxId: "12ABC34501DE35",
  };
  grants.FISCAL_CREDENTIAL_GRANTS = JSON.stringify([
    {
      scope,
      credentialHash: createHash("sha256").update(token).digest("hex"),
      clientFingerprint: blingClientFingerprint(),
      scopeIds: ["fixture-readwrite"],
      permissions: [
        "fiscal_read",
        "fiscal_write",
        "order_write",
        "contact_write",
      ],
      reference: "authenticated_grant:fixture_bling_oauth",
    },
  ]);
  const setup = await a.request("PUT", "/connection/" + row.id + "/setup", {
    environment: "homologation",
    accountConfiguration: {
      profileVersionId: profile.id,
      policyVersion: "merchant_confirmed_v1",
      confirmed: true,
      confirmedBy: "forged",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      certificateValidUntil: "2099-01-01",
      effects: {
        stockOnSave: false,
        stockOnAuthorize: false,
        stockOnCancel: false,
        accountsOnSave: false,
        accountsOnAuthorize: false,
        accountsOnCancel: false,
        automaticEmail: false,
      },
    },
  });
  assert.equal(setup.status, 200);
  assert.equal((await setup.json()).accountEvidence.confirmedBy, a.user.id);
  const active = await a.request(
    "POST",
    "/connection/" + row.id + "/activate",
    { environment: "homologation" }
  );
  assert.equal(active.status, 201);
  const cutoff = (await active.json()).activatedAt;
  await f.prisma.erpConnection.update({
    where: { id: erp.id },
    data: {
      status: "error",
      lastErrorCode: "erp_bling_reauthorization_required",
    },
  });
  const pending = await (
    await a.request("POST", "/connection/" + row.id + "/inspect", {
      environment: "homologation",
    })
  ).json();
  assert.ok(
    pending.readiness.every(
      (v: any) =>
        v.status === "pending" &&
        v.action === "reconnect" &&
        v.reasonCode === "fiscal_erp_reconnect_required"
    )
  );
  assert.equal(JSON.stringify(pending).includes(token), false);
  // The original OAuth integration remains the single rotating credential source.
  await f.prisma.erpConnection.update({
    where: { id: erp.id },
    data: { status: "connected", lastErrorCode: null },
  });
  const restored = await a.request(
    "POST",
    "/connection/" + row.id + "/reconnect",
    { environment: "homologation" }
  );
  assert.equal(restored.status, 201);
  const result = await restored.json();
  assert.equal(result.id, row.id);
  assert.equal(result.erpConnectionId, erp.id);
  assert.equal(result.activatedAt, cutoff);
  assert.equal(
    result.readiness.filter((v: any) => v.status !== "verified").length,
    0
  );
  assert.equal(
    (
      await f.prisma.fiscalConnection.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).credentialCipher,
    null
  );
  assert.equal(
    (await f.prisma.erpConnection.findUniqueOrThrow({ where: { id: erp.id } }))
      .accessTokenCipher,
    erp.accessTokenCipher
  );
  const wrong = await a.request("PUT", "/connection", {
    environment: "homologation",
    provider: "bling",
    issuerTaxId: "12ABC34501DE35",
    erpConnectionId: erp.id,
    credential: { kind: "oauth", secret: "duplicate_token" },
    stockOwner: "zyon",
    emailOwner: "zyon",
    whatsappOwner: "zyon",
  });
  assert.ok(wrong.status >= 400);
});
test("FISCAL-01 remaining setup profile reconnect and template operations retain real HTTP RBAC", async () => {
  const a = await connection();
  const staff = await actor("staff");
  for (const [method, path, body] of [
    [
      "POST",
      "/connection/" + a.row.id + "/inspect",
      { environment: "homologation" },
    ],
    [
      "POST",
      "/connection/" + a.row.id + "/reconnect",
      { environment: "homologation", credential: a.body.credential },
    ],
    ["GET", "/connection/" + a.row.id + "/setup?environment=homologation"],
    [
      "PUT",
      "/connection/" + a.row.id + "/setup",
      { environment: "homologation", companyId: "company_123" },
    ],
    ["POST", "/profiles/missing/confirm", { environment: "homologation" }],
    ["GET", "/templates"],
    ["PUT", "/templates/email", { body: "untrusted" }],
    ["POST", "/templates/whatsapp/submit", {}],
  ] as const) {
    assert.equal((await staff.request(method, path, body)).status, 403);
    assert.equal((await a.request(method, path, body, "")).status, 401);
  }
});
test("FISCAL-02 setup validates technical host-independent fields and rejects tenant-spoofed authority", async () => {
  const a = await connection();
  for (const input of [
    { companyId: "https://arbitrary.example" },
    { fiscalTimeZone: "invalid/timezone" },
    {
      focusWebhook: {
        authorizationHeader: "host",
        authorization: "private_secret_value",
      },
    },
    { accountConfiguration: { confirmed: true, permissionGranted: true } },
  ])
    assert.equal(
      (
        await a.request("PUT", "/connection/" + a.row.id + "/setup", {
          environment: "homologation",
          ...input,
        })
      ).status,
      400
    );
  assert.equal(
    (
      await a.request("PUT", "/connection", {
        ...a.body,
        merchantId: "foreign",
      })
    ).status,
    403
  );
});
test("FISCAL-03 activation audit persistence failure rolls back active state and never exposes raw database content", async () => {
  const a = await connection();
  await f.sql.query(
    `CREATE FUNCTION fail_activation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='fiscal.activate' THEN RAISE EXCEPTION 'synthetic private_company_token'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_activation_audit BEFORE INSERT ON merchant_audit_events FOR EACH ROW EXECUTE FUNCTION fail_activation_audit()`
  );
  const res = await a.request("POST", "/connection/" + a.row.id + "/activate", {
    environment: "homologation",
  });
  await f.sql.query(
    "DROP TRIGGER fail_activation_audit ON merchant_audit_events; DROP FUNCTION fail_activation_audit()"
  );
  assert.equal(res.status, 503);
  const text = await res.text();
  assert.equal(text.includes("private_company_token"), false);
  const row = await f.prisma.fiscalConnection.findUniqueOrThrow({
    where: { id: a.row.id },
  });
  assert.equal(row.isActive, false);
  assert.equal(row.activatedAt, null);
});

test("FISCAL-56 protected payment source uses its own store intent and exposes only provider method date", async () => {
  const seller = await actor(), foreign = await actor(), host = seller.merchantId;
  const sale = await seedFiscalSale(f, { merchantId: seller.merchantId, orderMerchantId: host, issuance: true });
  const input = { merchantId: host, sessionId: sale.completedOrder.sessionId, intentId: sale.snapshot.paymentProofRef!, amountCents: 2101, currency: "BRL", method: "card", provider: "stripe", providerAccountFingerprint: "private-original-account-fingerprint" };
  const payment = await f.prisma.paymentIntent.create({ data: { id: input.intentId, merchantId: host, sessionId: input.sessionId, idempotencyKey: crypto.randomUUID(), amountCents: 2101, currency: "BRL", method: "card", status: "requires_action", creation: { state: "complete", input } } });
  const before = calls.length, suffix = "/payment-sources?environment=homologation&intentId=" + sale.intent.id;
  const response = await seller.request("GET", suffix); assert.equal(response.status, 200); const sources = await response.json();
  assert.deepEqual(sources, [{ intentId: sale.intent.id, provider: "stripe", method: "card", status: "requires_action", createdAt: payment.createdAt.toISOString() }]);
  const text = JSON.stringify(sources); assert.equal(text.includes(input.intentId), false); assert.equal(text.includes("private-original-account-fingerprint"), false); assert.equal(calls.length, before);
  assert.equal((await foreign.request("GET", suffix)).status, 404); assert.equal((await seller.request("GET", suffix.replace("homologation", "production"))).status, 404);
  const ownSources = await (await seller.request("GET", "/payment-sources?environment=homologation")).json();
  assert.equal(ownSources.length, 1); assert.equal(ownSources[0].paymentIntentId, payment.id);
  assert.equal(JSON.stringify(ownSources).includes("private-original-account-fingerprint"), false);
});

test("FISCAL-21 protected profile reload preserves the saved draft and responsible confirmed version with reviewed contract metadata", async () => {
  const a = await actor(), other = await actor();
  const body = { environment: "homologation", provider: "focus", operation: "sale", issuerRegime: "simples_nacional", sourceContractVersion: FISCAL_PROFILE_CONTRACTS.focus, recipientRequirements: ["name", "taxId"], itemRules: { currency: "BRL", supportedProductTypes: ["physical"], items: { shirt: { productType: "physical", ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { icms_situacao_tributaria: "102" } } } } };
  const first = await (await a.request("POST", "/profiles", body)).json(); assert.equal((await a.request("POST", "/profiles/" + first.id + "/confirm", { environment: "homologation" })).status, 201);
  const second = await (await a.request("POST", "/profiles", { ...body, itemRules: { ...body.itemRules, items: { shirt: { ...body.itemRules.items.shirt, unit: "PC" } } } })).json();
  const path = "/profiles?environment=homologation&provider=focus&operation=sale";
  const response = await a.request("GET", path); assert.equal(response.status, 200); const value = await response.json();
  assert.equal(value.profile.id, second.id); assert.equal(value.profile.confirmedAt, null); assert.equal(value.profile.itemRules.items.shirt.unit, "PC"); assert.equal(value.confirmedProfile.id, first.id); assert.equal(value.confirmedProfile.itemRules.items.shirt.unit, "UN"); assert.equal(value.confirmedProfile.confirmedBy, a.user.id);
  assert.equal(value.supportedContract.sourceContractVersion, FISCAL_PROFILE_CONTRACTS.focus); assert.deepEqual(value.supportedContract.currencies, ["BRL"]); assert.deepEqual(value.supportedContract.operations, ["sale"]); assert.ok(value.supportedContract.minimumRecipientRequirements.includes("address.number"));
  const forged = await other.request("GET", path + "&merchantId=" + a.merchantId); assert.equal(forged.status, 403); assert.equal((await forged.json()).message, "tenant_mismatch_query");
  const foreign = await (await other.request("GET", path)).json(); assert.equal(foreign.profile, null); assert.equal(foreign.confirmedProfile, null); assert.equal(JSON.stringify(foreign).includes(first.id), false);
  const production = await (await a.request("GET", path.replace("homologation", "production"))).json(); assert.equal(production.profile, null); assert.equal(production.confirmedProfile, null);
});

test("FISCAL-21 profile read denies staff and invalid provider operation or environment before an unrestricted lookup", async () => {
  const a = await actor(), staff = await actor("staff");
  assert.equal((await staff.request("GET", "/profiles?environment=homologation&provider=focus&operation=sale")).status, 403);
  for (const query of ["environment=homologation&provider=unknown&operation=sale", "environment=homologation&provider=focus&operation=return", "provider=focus&operation=sale"]) assert.equal((await a.request("GET", "/profiles?" + query)).status, 400);
});
