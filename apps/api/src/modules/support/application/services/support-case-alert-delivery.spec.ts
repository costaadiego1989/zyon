import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { parseStaffMetaReceipt, SupportCaseAlertDeliveryService } from "./support-case-alert-delivery.service.js";
import { staffAlertId } from "../../domain/support-case-alert.js";

test("HUM-10 staff callbacks cannot borrow the operator/order correlation or omit the actual destination", () => {
  const id = staffAlertId("merchant-a", "ticket-a", 1), value = { id: "provider-a", status: "sent", recipient_id: "5511999991111", biz_opaque_callback_data: id };
  assert.deepEqual(parseStaffMetaReceipt("account-a", value), { provider: "META_CLOUD", providerAccountId: "account-a", providerMessageId: "provider-a", status: "accepted", recipient: "+5511999991111", correlationId: id });
  for (const patch of [{ biz_opaque_callback_data: "support_message:private" }, { biz_opaque_callback_data: "order_notification:private" }, { recipient_id: undefined }, { status: "queued" }])
    assert.equal(parseStaffMetaReceipt("account-a", { ...value, ...patch }), undefined);
});
test("HUM-10 historical staff receipts cannot access a different canonical tenant", async () => {
  let queries = 0; const tenant = new TenantContextService();
  const prisma = { whatsAppDelivery: { findMany: async () => { queries++; return []; } } } as unknown as PrismaClient;
  const service = new SupportCaseAlertDeliveryService(prisma, tenant);
  await tenant.run({ merchantId: "merchant-b", userId: "technical-test", role: "system" }, async () => {
    assert.equal(await service.reconcile({ merchantId: "merchant-a", provider: "META_CLOUD" } as never,
      { provider: "META_CLOUD", providerAccountId: "account-a", providerMessageId: "provider-a", status: "read", recipient: "+5511999991111" }), false);
  });
  assert.equal(queries, 0); assert.equal(tenant.get(), null);
});
