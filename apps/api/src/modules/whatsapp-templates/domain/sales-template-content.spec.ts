import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { prepareSalesWhatsApp, salesDefaults } from "./sales-template-content.js";
import { getTemplateDefinition } from "./catalog/template-catalog.js";
import { WHATSAPP_TEMPLATE_TYPES } from "./catalog/template-types.js";
import { PrismaRecoveryTemplateLifecycleRepository } from "../infrastructure/repositories/prisma-recovery-template-lifecycle.repository.js";
import { RecoveryTemplateLifecycleUseCase } from "../application/use-cases/recovery-template-lifecycle.use-case.js";
import { PostSaleDashboardController } from "../../post-sale/presentation/http/post-sale-dashboard.controller.js";

const operationalType = "marketplace_operational_alert";

function persistenceHarness() {
  const rows = new Map<string, any>();
  let transactions = 0;
  const table = {
    async createMany({ data, skipDuplicates }: any) {
      const key = `${data.merchantId}:${data.type}:${data.channel}`;
      if (rows.has(key)) {
        assert.equal(skipDuplicates, true);
        return { count: 0 };
      }
      rows.set(key, { id: key, metaRevision: 1, metaStatus: "draft", ...structuredClone(data) });
      return { count: 1 };
    },
    async findMany({ where }: any) {
      return [...rows.values()].filter(row => row.merchantId === where.merchantId && (!where.type || row.type === where.type));
    },
  };
  const prisma = {
    async $transaction(work: (tx: any) => Promise<void>) {
      transactions++;
      await work({ postSaleMessageTemplate: table });
    },
    postSaleMessageTemplate: table,
  };
  const repository = new PrismaRecoveryTemplateLifecycleRepository(prisma as any);
  return { rows, repository, transactionCount: () => transactions, table };
}

test("operational defaults prepare the canonical five-variable utility template for submission", () => {
  const expected = getTemplateDefinition(operationalType);
  const prepared = prepareSalesWhatsApp(operationalType, salesDefaults(operationalType).whatsapp.body);
  assert.equal(prepared.category, "UTILITY");
  assert.equal(prepared.metaBody, expected.metaBody);
  assert.deepEqual(prepared.variableMap, expected.variableMap);
  assert.deepEqual(Object.values(prepared.variableMap), ["alertName", "alertStatus", "alertSeverity", "observedAt", "dashboardLink"]);
  assert.ok(Object.values(prepared.sampleVariables).every(value => value.trim().length > 0));
  assert.doesNotMatch(prepared.metaBody, /buyerName|orderId|coupon|\{\{[a-zA-Z]/);
});

test("existing defaults remain supported while undeclared placeholders remain refused", () => {
  for (const type of WHATSAPP_TEMPLATE_TYPES.filter(type => type !== operationalType)) {
    const prepared = prepareSalesWhatsApp(type, salesDefaults(type).whatsapp.body);
    assert.ok(prepared.metaBody.trim(), type);
    assert.doesNotMatch(prepared.metaBody, /\{\{[a-zA-Z]/, type);
    assert.ok(Object.values(prepared.sampleVariables).every(value => value.trim()), type);
  }
  assert.equal(prepareSalesWhatsApp("order_confirmation", salesDefaults("order_confirmation").whatsapp.body).category, "UTILITY");
  assert.equal(prepareSalesWhatsApp("cart_recovery", salesDefaults("cart_recovery").whatsapp.body).category, "MARKETING");
  assert.throws(() => prepareSalesWhatsApp(operationalType, "Aviso {{customerEmail}}"), /unsupported_template_variable/);
  assert.throws(() => prepareSalesWhatsApp("undeclared_template", "Aviso"), /unsupported_template_type/);
});

test("real lifecycle repository initializes both operational channels once and preserves stored content", async () => {
  const h = persistenceHarness();
  await h.repository.ensure("operational-store", operationalType);
  assert.equal(h.transactionCount(), 1);
  assert.equal(h.rows.size, 2);
  const stored = h.rows.get(`operational-store:${operationalType}:whatsapp`);
  assert.equal(stored.metaCategory, "UTILITY");
  assert.equal(stored.metaLanguage, "pt_BR");
  assert.deepEqual(stored.metaVariableMap, getTemplateDefinition(operationalType).variableMap);
  assert.equal(stored.metaTemplateBody, getTemplateDefinition(operationalType).metaBody);
  stored.body += " Texto operacional revisado.";
  const retained = structuredClone([...h.rows.values()]);
  await h.repository.ensure("operational-store", operationalType);
  assert.equal(h.rows.size, 2);
  assert.deepEqual([...h.rows.values()], retained);
});

test("real template-list controller initializes every declared default including operations without transport calls", async () => {
  const h = persistenceHarness();
  const noTransport = async () => { assert.fail("template listing must not contact Meta"); };
  const lifecycle = new RecoveryTemplateLifecycleUseCase(h.repository, { createAndSubmit: noTransport, syncStatus: noTransport } as any,
    { findByMerchantId: async () => null } as any);
  const controller = new PostSaleDashboardController(lifecycle, {} as any, {} as any, {} as any, {} as any,
    { findAllByMerchant: async (merchantId: string) => h.table.findMany({ where: { merchantId } }) } as any);
  const request = { tenantPrincipal: { kind: "human" as const, tenantId: "operational-store", userId: "operator", email: "operator@example.invalid", role: "owner" as const } };
  const result = await controller.listTemplates(request);
  assert.equal(result.templates.length, WHATSAPP_TEMPLATE_TYPES.length * 2);
  assert.equal(h.transactionCount(), WHATSAPP_TEMPLATE_TYPES.length);
  const operational = result.templates.find(row => row.type === operationalType && row.channel === "whatsapp");
  assert.ok(operational);
  assert.equal(operational.metaStatus, "draft");
  assert.deepEqual(operational.metaVariableMap, getTemplateDefinition(operationalType).variableMap);
  assert.ok(result.templates.every(row => row.merchantId === "operational-store"));
});
