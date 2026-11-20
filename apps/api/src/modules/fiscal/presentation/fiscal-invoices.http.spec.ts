import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { arrangeIssuance } from "../../../../tests/fiscal-issuance-harness.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import {
  fiscalXmlFixture,
  fiscalPdfFixture,
} from "../../../../tests/fiscal-artifact-fixtures.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { registerTenantMiddleware } from "../../../shared/persistence/tenant.middleware.js";
import { TenantModule } from "../../../shared/tenant/tenant.module.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { TenantRoleGuard } from "../../auth/presentation/tenant-role.guard.js";
import { JwtService } from "../../auth/domain/services/jwt.service.js";
import { AuthCookieService } from "../../auth/domain/services/auth-cookie.service.js";
import { PrismaAuthRepository } from "../../auth/infrastructure/prisma-auth.repository.js";
import { FiscalInvoicesController } from "./fiscal-invoices.controller.js";
import { FiscalConfigurationController } from "./fiscal-configuration.controller.js";
import { FiscalMerchantInvoicesService } from "../application/fiscal-merchant-invoices.service.js";
import { FiscalPendingConfigurationService } from "../application/fiscal-pending-configuration.service.js";
import { FiscalProfileService } from "../application/fiscal-profile.service.js";
import { FiscalSetupService } from "../application/fiscal-setup.service.js";
import {
  FiscalConnectionService,
  FISCAL_READINESS_CODES,
} from "../application/fiscal-connection.service.js";
import { FiscalIssuanceService } from "../application/fiscal-issuance.service.js";
import { FiscalReconciliationService } from "../application/fiscal-reconciliation.service.js";
import { FiscalCancellationService } from "../application/fiscal-cancellation.service.js";
import { FiscalDocumentService } from "../application/fiscal-document.service.js";
import { PrismaFiscalRepository } from "../infrastructure/prisma-fiscal.repository.js";
import { PrismaFiscalIssuanceStore } from "../infrastructure/prisma-fiscal-issuance.store.js";
import { PrismaFiscalProfileRepository } from "../infrastructure/prisma-fiscal-profile.repository.js";
import { PrismaFiscalConfigurationRepository } from "../infrastructure/prisma-fiscal-configuration.repository.js";
import { PrismaFiscalDocumentAccess } from "../infrastructure/prisma-fiscal-document.access.js";
import { PrismaFiscalOrderParticipant } from "../infrastructure/prisma-fiscal-order.participant.js";
import { PrismaFiscalStockCoordinator } from "../../../shared/persistence/fiscal-stock-coordination.js";
import { FiscalArtifactStore } from "../infrastructure/fiscal-artifact.store.js";
import { FiscalCredentialCipher } from "../infrastructure/fiscal-credential-cipher.js";
import { FiscalDeliveryService } from "../application/fiscal-delivery.service.js";
import {
  fiscalProfileSupport,
  FISCAL_PROFILE_CONTRACTS,
} from "../infrastructure/fiscal-profile-support.js";
import { FiscalProviderFactory } from "../infrastructure/fiscal-provider.factory.js";
import type { FiscalProviderFactoryPort } from "../domain/fiscal-issuance.port.js";
import type { FiscalPaymentEvidence } from "../domain/fiscal-payment-evidence.port.js";
const scoped = Symbol("scoped");
let f: Awaited<ReturnType<typeof createFiscalFixture>>;
let jwt: JwtService;
let store: PrismaFiscalIssuanceStore;
let issuance: FiscalIssuanceService;
let profiles: FiscalProfileService;
let tenants: TenantContextService;
let documents: FiscalDocumentService;
const cases = new Map<
  string,
  { factory: FiscalProviderFactory; evidence: FiscalPaymentEvidence }
>();
const cipher = new FiscalCredentialCipher({
  AACP_PII_ENC_KEY: "fiscal-queue-local-private-key",
});
const factory: FiscalProviderFactoryPort = {
  build: (c, date, p) => cases.get(c.intent.id)!.factory.build(c, date, p),
  create: (c, p, j) => cases.get(c.intent.id)!.factory.create(c, p, j),
};
before(
  async () => {
    f = await createFiscalFixture({
      imports: [TenantModule],
      controllers: [FiscalInvoicesController, FiscalConfigurationController],
      providers: [
        AuthGuard,
        TenantRoleGuard,
        {
          provide: scoped,
          useFactory: (p: PrismaClient, t: TenantContextService) => {
            tenants = t;
            return registerTenantMiddleware(p, t);
          },
          inject: [PRISMA_CLIENT, TenantContextService],
        },
        {
          provide: JwtService,
          useFactory: (p: PrismaClient) =>
            (jwt = new JwtService(
              "fiscal-invoice-http-auth-secret",
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
          provide: FiscalProfileService,
          useFactory: (p: PrismaClient, t: TenantContextService) => {
            const value = new FiscalProfileService(
              new PrismaFiscalProfileRepository(p),
              fiscalProfileSupport,
              (profile, actor) =>
                new FiscalPendingConfigurationService(p, value, t).confirmed(
                  profile,
                  actor
                )
            );
            profiles = value;
            return value;
          },
          inject: [scoped, TenantContextService],
        },
        {
          provide: FiscalSetupService,
          useFactory: (p: PrismaClient) => new FiscalSetupService(p, cipher),
          inject: [scoped],
        },
        {
          provide: FiscalConnectionService,
          useFactory: (p: PrismaClient) =>
            new FiscalConnectionService(
              new PrismaFiscalConfigurationRepository(p),
              cipher,
              {
                inspect: async () =>
                  FISCAL_READINESS_CODES.map((code) => ({
                    code,
                    status: "verified",
                  })),
              }
            ),
          inject: [scoped],
        },
        {
          provide: FiscalMerchantInvoicesService,
          useFactory: (
            p: PrismaClient,
            profile: FiscalProfileService,
            t: TenantContextService
          ) => {
            store = new PrismaFiscalIssuanceStore(p, () => new Date(), profile);
            issuance = new FiscalIssuanceService(store, factory, {
              read: async (snapshot) =>
                cases.get(
                  (
                    await p.fiscalIntent.findFirstOrThrow({
                      where: { snapshotId: snapshot.id },
                    })
                  ).id
                )!.evidence,
            });
            const stock = new PrismaFiscalStockCoordinator(p);
            const reconciliation = new FiscalReconciliationService(
              store,
              factory,
              {
                read: async () => ({
                  found: false,
                  reasonCode: "fiscal_stock_evidence_pending",
                }),
              },
              stock
            );
            documents = new FiscalDocumentService(
              new PrismaFiscalDocumentAccess(p),
              new FiscalArtifactStore(p),
              store,
              factory
            );
            return new FiscalMerchantInvoicesService(
              p,
              new PrismaFiscalRepository(p),
              issuance,
              reconciliation,
              new FiscalCancellationService(p, store, factory),
              documents,
              new FiscalPendingConfigurationService(p, profile, t)
            );
          },
          inject: [scoped, FiscalProfileService, TenantContextService],
        },
      ],
    });
  },
  { timeout: 120000 }
);
after(async () => f?.close());
async function auth(
  merchantId: string,
  role: "owner" | "admin" | "staff" = "owner"
) {
  await f.prisma.merchant.upsert({
    where: { id: merchantId },
    create: { id: merchantId, name: "Merchant" },
    update: {},
  });
  const u = await f.prisma.merchantUser.create({
    data: { merchantId, email: crypto.randomUUID() + "@example.test", role },
  });
  await f.prisma.merchantTeamMember.create({
    data: { merchantId, userId: u.id, role: role.toUpperCase() },
  });
  const token = await jwt.issue({
    merchantId,
    userId: u.id,
    email: u.email,
    role,
  });
  const request = (
    method: string,
    path: string,
    body?: unknown,
    authToken = token
  ) =>
    fetch(f.first.url + "/v1/merchants/me/fiscal" + path, {
      method,
      headers: {
        ...(authToken ? { authorization: "Bearer " + authToken } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { u, token, request };
}
async function sale(authorized = false) {
  const a = await arrangeIssuance(f);
  cases.set(a.sale.intent.id, { factory: a.factory, evidence: a.evidence });
  if (authorized) {
    await a.run();
    a.setRemote("authorized");
    await new FiscalReconciliationService(
      a.store,
      a.factory,
      { read: async () => ({ found: false, reasonCode: "none" }) },
      new PrismaFiscalStockCoordinator(f.prisma)
    ).reconcile(a.scope, a.sale.intent.id);
  }
  const actor = await auth(a.sale.merchantId);
  const path = "/invoices/" + a.sale.intent.id;
  return {
    ...a,
    ...actor,
    path,
    get: () => actor.request("GET", path + "?environment=homologation"),
  };
}
const confirmation = {
  confirmed: true,
  justification: "Cancelamento fiscal confirmado pelo responsável",
};
test("FISCAL-56 actual merchant invoice HTTP lists own original order recipient provider state and channel outcomes", async () => {
  const a = await sale();
  await sale();
  const r = await a.request("GET", "/invoices?environment=homologation");
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.total, 1);
  assert.equal(data.items[0].id, a.sale.intent.id);
  assert.equal(data.items[0].orderId, a.sale.orderId);
  assert.equal(data.items[0].provider, "focus");
  assert.equal(
    data.items[0].recipientName,
    (a.sale.snapshot.recipient as any).name
  );
  assert.equal(data.items[0].state, "queued");
  assert.deepEqual(data.items[0].deliveries, []);
  assert.equal(JSON.stringify(data).includes("52998224725"), false);
});
test("FISCAL-57 actual HTTP database filters search counts and deterministic pagination preserve merchant scope", async () => {
  const a = await sale();
  await seedFiscalSale(f, {
    merchantId: a.sale.merchantId,
    orderId: "needle_1",
    issuance: true,
  });
  const other = await seedFiscalSale(f, {
    merchantId: a.sale.merchantId,
    orderId: "needle_2",
    issuance: true,
  });
  await f.prisma.fiscalIntent.update({
    where: { id: other.intent.id },
    data: { state: "action_required" },
  });
  await sale();
  const first = await (
    await a.request(
      "GET",
      "/invoices?environment=homologation&search=needle&page=1&pageSize=1"
    )
  ).json();
  const second = await (
    await a.request(
      "GET",
      "/invoices?environment=homologation&search=needle&page=2&pageSize=1"
    )
  ).json();
  assert.equal(first.total, 2);
  assert.deepEqual(first.counts, { queued: 1, action_required: 1 });
  assert.equal(first.items.length, 1);
  assert.equal(second.items.length, 1);
  assert.notEqual(first.items[0].id, second.items[0].id);
  const filtered = await (
    await a.request(
      "GET",
      "/invoices?environment=homologation&search=needle&state=action_required"
    )
  ).json();
  assert.equal(filtered.total, 1);
  assert.deepEqual(filtered.counts, { action_required: 1 });
  assert.equal(filtered.items[0].id, other.intent.id);
});
test("FISCAL-57 invalid page state limit search and environment fail before unrestricted list", async () => {
  const a = await sale();
  for (const q of [
    "page=0",
    "page=-1",
    "page=1.5",
    "pageSize=101",
    "page=not-number",
    "state=arbitrary",
    "search=" + "x".repeat(121),
  ])
    assert.equal(
      (await a.request("GET", "/invoices?environment=homologation&" + q))
        .status,
      400
    );
  assert.equal((await a.request("GET", "/invoices")).status, 400);
});
test("FISCAL-56 list wrong environment returns empty without another environment note", async () => {
  const a = await sale();
  const data = await (
    await a.request("GET", "/invoices?environment=production")
  ).json();
  assert.equal(data.total, 0);
  assert.deepEqual(data.items, []);
  assert.deepEqual(data.counts, {});
});
test("FISCAL-58 actual detail exposes persisted history and only state-permitted controls", async () => {
  const a = await sale();
  const r = await a.get();
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.id, a.sale.intent.id);
  assert.equal(data.document.state, "queued");
  assert.equal(data.document.authorizationProtocol, undefined);
  assert.deepEqual(data.allowedActions, []);
  assert.deepEqual(data.document.documents, [
    { kind: "xml", available: false },
    { kind: "danfe", available: false },
  ]);
  for (const key of [
    "credentialCipher",
    "setupCipher",
    "payloadHash",
    "providerEvidenceRef",
    "privateObjectKey",
    "contentHash",
  ])
    assert.equal(JSON.stringify(data).includes(key), false);
});
test("FISCAL-58 every invoice route denies unauthenticated staff cross-tenant and wrong environment before provider IO", async () => {
  const a = await sale();
  const b = await auth(f.tag + "_foreign_" + crypto.randomUUID());
  const staff = await auth(a.sale.merchantId, "staff");
  const before = a.calls.length;
  for (const [method, suffix, body] of [
    ["GET", "?environment=homologation"],
    ["POST", "/reconcile", { environment: "homologation" }],
    [
      "POST",
      "/reprocess",
      { environment: "homologation", profileVersionId: a.sale.profile.id },
    ],
    [
      "POST",
      "/cancellation",
      { environment: "homologation", reviewId: "missing", ...confirmation },
    ],
    ["GET", "/documents/xml?environment=homologation"],
  ] as const) {
    assert.equal((await b.request(method, a.path + suffix, body)).status, 404);
    assert.equal(
      (await staff.request(method, a.path + suffix, body)).status,
      403
    );
    assert.equal(
      (await a.request(method, a.path + suffix, body, "")).status,
      401
    );
  }
  assert.equal(
    (await a.request("GET", a.path + "?environment=production")).status,
    404
  );
  assert.equal(a.calls.length, before);
});
test("FISCAL-40 merchant download pending cannot expose provider URL or invented bytes", async () => {
  const a = await sale();
  const r = await a.request(
    "GET",
    a.path + "/documents/xml?environment=homologation"
  );
  assert.equal(r.status, 409);
  assert.equal((await r.text()).includes("http"), false);
  assert.equal(a.calls.length, 0);
  assert.equal(
    (
      await a.request(
        "GET",
        a.path + "/documents/arbitrary?environment=homologation"
      )
    ).status,
    400
  );
});
test("FISCAL-44 real protected file HTTP streams only original private artifact after disconnect", async () => {
  const a = await sale(true);
  a.setArtifacts({
    xml: fiscalXmlFixture(a.sale.connection.issuerTaxId),
    pdf: await fiscalPdfFixture(true),
  });
  await documents.recover(a.scope, a.sale.intent.id);
  await f.prisma.fiscalConnection.update({
    where: { id: a.sale.connection.id },
    data: { disconnectedAt: new Date() },
  });
  const before = a.calls.length;
  const r = await a.request(
    "GET",
    a.path + "/documents/xml?environment=homologation"
  );
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(
    new Uint8Array(await r.arrayBuffer()),
    fiscalXmlFixture(a.sale.connection.issuerTaxId)
  );
  assert.equal(a.calls.length, before);
});
test("FISCAL-35 actual protected correction creates a new Focus revision only after authenticated rejection", async () => {
  const a = await sale();
  await a.run();
  a.setRemote("rejected");
  await new FiscalReconciliationService(
    a.store,
    a.factory,
    { read: async () => ({ found: false, reasonCode: "none" }) },
    new PrismaFiscalStockCoordinator(f.prisma)
  ).reconcile(a.scope, a.sale.intent.id);
  const r = await a.request("POST", a.path + "/reprocess", {
    environment: "homologation",
    profileVersionId: a.sale.profile.id,
  });
  assert.equal(r.status, 201);
  const row = await a.current();
  assert.equal(row.state, "queued");
  assert.equal(row.issuanceRevision, 2);
  assert.equal(row.stableReference, a.sale.intent.stableReference);
  await a.run();
  assert.equal(a.writes().length, 2);
  assert.equal((await a.current()).connectionId, a.sale.connection.id);
});
test("FISCAL-69 protected authorized correction cannot alter document body history or original snapshot", async () => {
  const a = await sale(true);
  const before = await f.prisma.fiscalSaleSnapshot.findUniqueOrThrow({
    where: { id: a.sale.snapshot.id },
  });
  const count = await f.prisma.fiscalEvent.count({
    where: { intentId: a.sale.intent.id },
  });
  const writes = a.writes().length;
  const r = await a.request("POST", a.path + "/reprocess", {
    environment: "homologation",
    profileVersionId: a.sale.profile.id,
    recipient: { taxId: "foreign" },
    amountCents: 1,
  });
  assert.equal(r.status, 409);
  assert.equal((await a.current()).state, "authorized");
  assert.equal(
    await f.prisma.fiscalEvent.count({ where: { intentId: a.sale.intent.id } }),
    count
  );
  assert.deepEqual(
    await f.prisma.fiscalSaleSnapshot.findUniqueOrThrow({
      where: { id: a.sale.snapshot.id },
    }),
    before
  );
  assert.equal(a.writes().length, writes);
});
test("FISCAL-35 uncertain accepted body cannot be reopened through reprocess", async () => {
  const a = await sale();
  a.setBehavior("timeout");
  await a.run();
  const r = await a.request("POST", a.path + "/reprocess", {
    environment: "homologation",
    profileVersionId: a.sale.profile.id,
  });
  assert.equal(r.status, 409);
  assert.equal((await a.current()).state, "reconciliation_required");
  assert.equal(a.writes().length, 1);
});
test("FISCAL-58 protected reconcile queries the original Focus and returns authenticated fiscal result", async () => {
  const a = await sale();
  await a.run();
  a.setRemote("authorized");
  const r = await a.request("POST", a.path + "/reconcile", {
    environment: "homologation",
  });
  assert.equal(r.status, 201);
  const row = await r.json();
  assert.equal(row.state, "authorized");
  assert.equal(row.document.authorizationProtocol, "151260029467289");
  assert.equal(row.document.number, "22");
  assert.equal(a.writes().length, 1);
});
test("FISCAL-52 actual cancellation HTTP requires explicit merchant confirmation and binds principal", async () => {
  const a = await sale(true);
  const cancellation = new FiscalCancellationService(f.prisma, store, factory);
  await cancellation.commercialChange(a.scope, a.sale.intent.id, {
    id: "refund_original",
    kind: "refund",
  });
  const review = await f.prisma.fiscalCancellationReview.findFirstOrThrow({
    where: { merchantId: a.sale.merchantId },
  });
  for (const input of [
    { ...confirmation, confirmed: false },
    { ...confirmation, justification: "short" },
  ])
    assert.equal(
      (
        await a.request("POST", a.path + "/cancellation", {
          environment: "homologation",
          reviewId: review.id,
          ...input,
        })
      ).status,
      409
    );
  const r = await a.request("POST", a.path + "/cancellation", {
    environment: "homologation",
    reviewId: review.id,
    ...confirmation,
    actorId: "forged",
    permissions: ["anything"],
  });
  assert.equal(r.status, 201);
  const current = await f.prisma.fiscalCancellationReview.findUniqueOrThrow({
    where: { id: review.id },
  });
  assert.equal(current.confirmedBy, a.u.id);
  assert.equal(current.reviewState, "pending");
  assert.equal((await a.current()).state, "authorized");
  assert.equal(a.calls.filter((v) => v.method === "DELETE").length, 1);
});
test("FISCAL-55 partial refund HTTP stays review-only with original authorized invoice", async () => {
  const a = await sale(true);
  await new FiscalCancellationService(
    f.prisma,
    store,
    factory
  ).commercialChange(a.scope, a.sale.intent.id, {
    id: "partial_original",
    kind: "partial_refund",
  });
  const review = await f.prisma.fiscalCancellationReview.findFirstOrThrow({
    where: { merchantId: a.sale.merchantId },
  });
  const r = await a.request("POST", a.path + "/cancellation", {
    environment: "homologation",
    reviewId: review.id,
    ...confirmation,
  });
  assert.equal(r.status, 201);
  const data = await r.json();
  assert.equal(data.state, "authorized");
  assert.equal(
    data.reviews[0].safeReasonCode,
    "fiscal_partial_refund_requires_review"
  );
  assert.ok(
    !data.allowedActions.some((v: any) => v.kind === "request_cancellation")
  );
  assert.equal(a.calls.filter((v) => v.method === "DELETE").length, 0);
});
test("FISCAL-58 missing invoice actions never create a guessed document or fiscal write", async () => {
  const a = await sale();
  for (const suffix of ["/reconcile", "/reprocess", "/cancellation"])
    assert.equal(
      (
        await a.request("POST", "/invoices/missing" + suffix, {
          environment: "homologation",
          profileVersionId: a.sale.profile.id,
          reviewId: "missing",
          ...confirmation,
        })
      ).status,
      404
    );
  assert.equal(
    await f.prisma.fiscalDocument.count({
      where: { merchantId: a.sale.merchantId },
    }),
    0
  );
  assert.equal(a.writes().length, 0);
});
test("FISCAL-58 protected query failure keeps paid original document reconcilable and returns safe error", async () => {
  const a = await sale();
  await a.run();
  a.setBehavior("timeout");
  const old = callsFor(a);
  a.factory.create = () => {
    throw new Error("private_company_token rawbody");
  };
  const r = await a.request("POST", a.path + "/reconcile", {
    environment: "homologation",
  });
  assert.equal(r.status, 409);
  assert.equal((await r.text()).includes("private_company_token"), false);
  assert.equal((await a.current()).state, "reconciliation_required");
  assert.equal(a.writes().length, old);
});
function callsFor(a: Awaited<ReturnType<typeof sale>>) {
  return a.writes().length;
}
async function taxPending() {
  const merchantId = f.tag + "_pending_" + crypto.randomUUID();
  const a = await auth(merchantId);
  const environment = "homologation" as const;
  const completedAt = new Date(Date.now() - 1800000);
  const sessionId = "session_" + crypto.randomUUID();
  const orderId = "original_" + crypto.randomUUID();
  const connection = await f.prisma.fiscalConnection.create({
    data: {
      merchantId,
      environment,
      provider: "focus",
      issuerTaxId: "12ABC34501DE35",
      credentialCipher: cipher.encrypt("private_company_token"),
      isActive: true,
      activatedAt: new Date(completedAt.getTime() - 3600000),
      stockOwner: "zyon",
      emailOwner: "zyon",
      whatsappOwner: "zyon",
    },
  });
  const recipient = {
    name: "Original Buyer",
    taxId: "52998224725",
    address: {
      street: "Rua Um",
      number: "12",
      neighborhood: "Centro",
      city: "Sao Paulo",
      state: "SP",
      postalCode: "01001000",
      cityCode: "3550308",
      countryCode: "1058",
    },
  };
  const lines = [
    {
      lineId: "line_original",
      sku: "shirt",
      name: "Original item",
      quantity: 1,
      unitPriceCents: 1000,
      productType: "physical" as const,
    },
  ];
  const cart = { currency: "BRL", total: 10, items: lines };
  const customer = {
    fullName: recipient.name,
    cpf: recipient.taxId,
    fiscalRecipient: recipient,
    email: "buyer@example.test",
  };
  await f.prisma.checkoutSession.create({
    data: {
      merchantId,
      sessionId,
      globalUserId: "buyer_original",
      conversationId: sessionId,
      cart,
      customer,
      createdAt: completedAt,
      updatedAt: completedAt,
    },
  });
  const payment = await f.prisma.paymentIntent.create({
    data: {
      id: "paid_" + crypto.randomUUID(),
      merchantId,
      sessionId,
      idempotencyKey: orderId,
      amountCents: 1000,
      approvedAmountCents: 1000,
      currency: "BRL",
      method: "card",
      status: "approved",
      providerPaymentId: orderId,
      creation: {
        state: "complete",
        input: {
          provider: "stripe",
          providerAccountFingerprint: "original_account",
          method: "card",
          amountCents: 1000,
          currency: "BRL",
        },
      },
    },
  });
  await f.prisma.$transaction(async (tx) => {
    await tx.completedOrder.create({
      data: {
        merchantId,
        sessionId,
        externalOrderId: orderId,
        orderTotal: 10,
        currency: "BRL",
        completedAt,
        lineItemsJson: lines,
      },
    });
    await new PrismaFiscalOrderParticipant(
      tx,
      environment,
      new TenantContextService(),
      fiscalProfileSupport
    ).record({
      order: {
        merchantId,
        sessionId,
        externalOrderId: orderId,
        orderTotal: 10,
        currency: "BRL",
        completedAt: completedAt.toISOString(),
        lineItems: lines,
      } as never,
      session: {
        merchantId,
        sessionId,
        globalUserId: "buyer_original",
        cart,
        customer,
      } as never,
      paymentIntentId: payment.id,
    });
  });
  const intent = await f.prisma.fiscalIntent.findFirstOrThrow({
    where: { merchantId, orderId },
  });
  const snapshot = await f.prisma.fiscalSaleSnapshot.findUniqueOrThrow({
    where: { id: intent.snapshotId },
  });
  let remote = false;
  const calls: Array<{ url: string; method: string; body?: any }> = [];
  const provider = new FiscalProviderFactory({
    credential: async () => "private_company_token",
    authorization: { read: async () => null },
    accountEvidence: { read: async () => null },
    fetch: (async (url, init) => {
      const method = init?.method ?? "GET";
      calls.push({
        url: String(url),
        method,
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      if (method === "POST") {
        remote = true;
        return Response.json(
          { status: "processando_autorizacao" },
          { status: 202 }
        );
      }
      if (!remote) return Response.json({}, { status: 404 });
      return Response.json({
        ref: intent.stableReference,
        cnpj_emitente: connection.issuerTaxId,
        status: "autorizado",
        numero: "22",
        serie: "1",
        chave_nfe:
          "352611" + connection.issuerTaxId + "550010000000221123456780",
        protocolo_nota_fiscal: {
          ambiente: "2",
          numero_protocolo: "151260029467289",
          data_recebimento: new Date().toISOString(),
        },
      });
    }) as typeof fetch,
  });
  const evidence: FiscalPaymentEvidence = {
    binding: {
      merchantId,
      proofRef: payment.id,
      provider: "stripe",
      accountId: "original_account",
      environment: "test",
      operationId: orderId,
      amountCents: 1000,
      currency: "BRL",
    },
    receipt: {
      merchantId,
      provider: "stripe",
      accountId: "original_account",
      environment: "test",
      operationId: orderId,
      amountCents: 1000,
      currency: "BRL",
      captured: true,
      instrument: "credit",
      acquirerTaxId: "12345678000195",
      authorizationCode: "ABC123",
      brandCode: "01",
      paidAt: completedAt.toISOString(),
      evidenceReference: "stripe:charge:original_charge",
    },
  };
  cases.set(intent.id, { factory: provider, evidence });
  const profileInput = {
    environment,
    provider: "focus",
    operation: "sale",
    issuerRegime: "simples_nacional",
    sourceContractVersion: FISCAL_PROFILE_CONTRACTS.focus,
    recipientRequirements: [
      "name",
      "taxId",
      "address.street",
      "address.number",
      "address.neighborhood",
      "address.city",
      "address.state",
      "address.postalCode",
      "address.cityCode",
      "address.countryCode",
    ],
    itemRules: {
      currency: "BRL",
      supportedProductTypes: ["physical"],
      operation: {
        natureza_operacao: "Venda de mercadoria",
        tipo_documento: 1,
        finalidade_emissao: 1,
        local_destino: 1,
        consumidor_final: 1,
        presenca_comprador: 2,
        modalidade_frete: 0,
        indicador_inscricao_estadual_destinatario: 9,
      },
      items: {
        shirt: {
          productType: "physical",
          ncm: "61091000",
          cfop: "5102",
          origin: "0",
          unit: "UN",
          taxes: {
            icms_situacao_tributaria: "102",
            pis_situacao_tributaria: "07",
            cofins_situacao_tributaria: "07",
          },
        },
      },
    },
  };
  return {
    ...a,
    scope: { merchantId, environment },
    merchantId,
    connection,
    payment,
    intent,
    snapshot,
    calls,
    profileInput,
    sessionId,
    completedAt,
    recipient,
  };
}
test("FISCAL-20 actual paid tax-pending producer through protected profile confirm reaches first valid Focus issuance using immutable original sale", async () => {
  const a = await taxPending();
  assert.equal(a.intent.state, "action_required");
  assert.equal(a.intent.lastErrorCode, "fiscal_profile_unconfirmed");
  assert.equal(
    await f.prisma.fiscalDocument.count({ where: { intentId: a.intent.id } }),
    0
  );
  assert.equal(a.snapshot.paymentProofRef, a.payment.id);
  assert.equal((a.snapshot.items as any).pendingLines.length, 1);
  assert.equal(a.calls.length, 0);
  await f.prisma.checkoutSession.update({
    where: {
      merchantId_sessionId: {
        merchantId: a.merchantId,
        sessionId: a.sessionId,
      },
    },
    data: {
      customer: { fullName: "Changed current buyer", cpf: "11111111111" },
      cart: {
        items: [{ sku: "shirt", quantity: 99, unitPriceCents: 99999 }],
        total: 99999,
      },
    },
  });
  const draftResponse = await a.request("POST", "/profiles", a.profileInput);
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();
  const confirmation = await a.request(
    "POST",
    "/profiles/" + draft.id + "/confirm",
    { environment: "homologation", confirmedBy: "forged" }
  );
  assert.equal(confirmation.status, 201);
  assert.equal((await confirmation.json()).confirmedBy, a.u.id);
  await a.request("POST", "/profiles/" + draft.id + "/confirm", {
    environment: "homologation",
  });
  const queued = await f.prisma.fiscalIntent.findUniqueOrThrow({
    where: { id: a.intent.id },
  });
  assert.equal(queued.state, "queued");
  assert.equal(queued.connectionId, a.connection.id);
  assert.equal(queued.stableReference, a.intent.stableReference);
  assert.equal(queued.profileVersionId, draft.id);
  assert.equal(
    await f.prisma.fiscalEvent.count({
      where: {
        intentId: a.intent.id,
        action: "configuration.first_issuance_admitted",
      },
    }),
    1
  );
  assert.equal(
    await f.prisma.outboxMessage.count({
      where: { eventId: "fiscal.configured:" + a.intent.id },
    }),
    1
  );
  const claim = await new PrismaFiscalRepository(f.prisma).claim(
    a.scope,
    new Date(),
    60000
  );
  assert.ok(claim);
  await issuance.run(claim);
  const writes = a.calls.filter((c) => c.method === "POST");
  assert.equal(writes.length, 1);
  const body = writes[0].body;
  assert.equal(body.valor_total, 10);
  assert.equal(body.items[0].quantidade_comercial, 1);
  assert.equal(body.items[0].valor_unitario_comercial, 10);
  assert.equal(body.cpf_destinatario, a.recipient.taxId);
  assert.equal(body.nome_destinatario, a.recipient.name);
  assert.equal(body.formas_pagamento[0].valor_pagamento, 10);
  assert.ok(
    writes[0].url.startsWith(
      "https://homologacao.focusnfe.com.br/v2/nfe?ref=" +
        a.intent.stableReference
    )
  );
  const result = await a.request(
    "POST",
    "/invoices/" + a.intent.id + "/reconcile",
    { environment: "homologation" }
  );
  assert.equal(result.status, 201);
  assert.equal((await result.json()).state, "authorized");
  assert.deepEqual(
    await f.prisma.fiscalSaleSnapshot.findUniqueOrThrow({
      where: { id: a.snapshot.id },
    }),
    a.snapshot
  );
  assert.equal(
    await f.prisma.paymentIntent.count({ where: { merchantId: a.merchantId } }),
    1
  );
  assert.equal(
    (
      await f.prisma.paymentIntent.findUniqueOrThrow({
        where: { id: a.payment.id },
      })
    ).status,
    "approved"
  );
  assert.equal(
    await f.prisma.fiscalProviderStageReceipt.count({
      where: {
        intentId: a.intent.id,
        outcome: "accepted",
        stage: "invoice.submit",
      },
    }),
    1
  );
});
test("FISCAL-20 first-issuance correction refuses partial-refund and preserves original immutable pending sale", async () => {
  const a = await taxPending();
  await new FiscalCancellationService(
    f.prisma,
    store,
    factory
  ).commercialChange(a.scope, a.intent.id, {
    id: "original_partial",
    kind: "partial_refund",
  });
  const draft = await (
    await a.request("POST", "/profiles", a.profileInput)
  ).json();
  await a.request("POST", "/profiles/" + draft.id + "/confirm", {
    environment: "homologation",
  });
  const res = await a.request(
    "POST",
    "/invoices/" + a.intent.id + "/reprocess",
    { environment: "homologation", profileVersionId: draft.id }
  );
  assert.equal(res.status, 409);
  const intent = await f.prisma.fiscalIntent.findUniqueOrThrow({
    where: { id: a.intent.id },
  });
  assert.equal(intent.lastErrorCode, "fiscal_partial_refund_requires_review");
  assert.equal(a.calls.length, 0);
  assert.deepEqual(
    await f.prisma.fiscalSaleSnapshot.findUniqueOrThrow({
      where: { id: a.snapshot.id },
    }),
    a.snapshot
  );
});
test("FISCAL-53 actual Bling panel HTTP retains actionable verification pending on authenticated Cancelada without inventing protocol", async () => {
  const sale = await seedFiscalSale(f, { provider: "bling", issuance: true });
  const actor = await auth(sale.merchantId);
  const scope = { merchantId: sale.merchantId, environment: sale.environment };
  const key =
    "352611" + sale.connection.issuerTaxId + "550010000000221123456780";
  await f.prisma.fiscalIntent.update({
    where: { id: sale.intent.id },
    data: {
      state: "authorized",
      remoteInvoiceId: "77",
      writeStartedAt: new Date(),
    },
  });
  const doc = await f.prisma.fiscalDocument.create({
    data: {
      ...scope,
      intentId: sale.intent.id,
      issuerTaxId: sale.connection.issuerTaxId,
      state: "authorized",
      number: "22",
      series: "1",
      accessKey: key,
      authorizationProtocol: "151260029467289",
      authorizedAt: new Date(),
    },
  });
  await f.prisma.fiscalIssuanceRevision.create({
    data: {
      ...scope,
      intentId: sale.intent.id,
      revision: 1,
      profileVersionId: sale.profile.id,
      issuedAt: new Date(),
      payload: {},
      payloadHash: "a".repeat(64),
      paymentEvidence: {},
    },
  });
  const calls: Array<{ url: string; method: string }> = [];
  const actualFactory = new FiscalProviderFactory({
    credential: async () => "original_bling_account_token",
    authorization: { read: async () => null },
    accountEvidence: { read: async () => null },
    policyVersion: () => "original_confirmed_v1",
    fetch: (async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      return Response.json({
        data: {
          id: 77,
          numeroPedidoLoja: sale.intent.stableReference,
          situacao: 2,
          chaveAcesso: key,
        },
      });
    }) as typeof fetch,
  });
  cases.set(sale.intent.id, {
    factory: actualFactory,
    evidence: {} as FiscalPaymentEvidence,
  });
  const cancellation = new FiscalCancellationService(f.prisma, store, factory);
  await cancellation.commercialChange(scope, sale.intent.id, {
    id: "bling_commercial_refund",
    kind: "refund",
  });
  const review = await f.prisma.fiscalCancellationReview.findFirstOrThrow({
    where: { documentId: doc.id },
  });
  const path = "/invoices/" + sale.intent.id;
  const panel = await actor.request("POST", path + "/cancellation", {
    environment: "homologation",
    reviewId: review.id,
    ...confirmation,
  });
  assert.equal(panel.status, 201);
  const panelState = await panel.json();
  assert.ok(
    panelState.allowedActions.some(
      (v: any) => v.kind === "erp_panel" && v.label === "Cancelar no ERP"
    )
  );
  assert.equal(calls.length, 0);
  const reconciled = await actor.request("POST", path + "/reconcile", {
    environment: "homologation",
  });
  assert.equal(reconciled.status, 201);
  const row = await reconciled.json();
  assert.equal(row.state, "authorized");
  assert.equal(row.reviews[0].reviewState, "action_required");
  assert.equal(
    row.reviews[0].safeReasonCode,
    "fiscal_cancellation_verification_pending"
  );
  assert.equal(row.document.authorizationProtocol, doc.authorizationProtocol);
  assert.equal(row.document.cancellationProtocol, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url, "https://api.bling.com.br/Api/v3/nfe/77");
});

test("FISCAL-58 actual protected detail separates authorized NF original stock ownership and persisted blocked channels", async () => {
  const a = await sale(true);
  await new FiscalDeliveryService(f.prisma, a.store, {}).dispatchAll(a.scope, a.sale.intent.id);
  const detail = await (await a.get()).json();
  assert.equal(detail.state, "authorized"); assert.equal(detail.document.state, "authorized");
  assert.deepEqual(detail.stock, { owner: "zyon", state: "managed_by_zyon" });
  assert.equal(detail.deliveries.length, 2); assert.ok(detail.deliveries.every((channel: any) => channel.state === "blocked"));
  assert.ok(detail.document.authorizationProtocol);
});
