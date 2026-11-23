import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ServiceAppointmentsController, ServiceAppointmentReadsController } from "./service-appointments.controller.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { TENANT_ROLES_METADATA } from "../../../auth/presentation/tenant-role.decorator.js";

const request = { tenantPrincipal: { kind: "human" as const, tenantId: "merchant", userId: "owner", role: "owner" as const, email: "private@example.test" } };
test("T41", async t => {
  await t.test("list and detail carry owner/admin roles and the same merchant guards", () => {
    assert.deepEqual(Reflect.getMetadata(TENANT_ROLES_METADATA, ServiceAppointmentReadsController.prototype.list), ["owner", "admin"]);
    assert.deepEqual(Reflect.getMetadata(TENANT_ROLES_METADATA, ServiceAppointmentReadsController.prototype.detail), ["owner", "admin"]);
    assert.equal(Reflect.getMetadata("path", ServiceAppointmentReadsController), "merchants/:mid/service-appointments");
    assert.equal(Reflect.getMetadata("__guards__", ServiceAppointmentReadsController).includes(MerchantOwnershipGuard), true);
  });
  await t.test("reader receives authenticated tenant and actor, not query/body identity", async () => {
    const calls: unknown[] = [], reader = { list: async (...args: unknown[]) => { calls.push(args); return { items: [] }; },
      detail: async (...args: unknown[]) => { calls.push(args); return { id: "appointment" }; } };
    const controller = new ServiceAppointmentReadsController(reader as never), query = { fromDate: "2030-01-01", toDate: "2030-01-01" };
    assert.deepEqual(await controller.list(request, query), { items: [] }); assert.deepEqual(await controller.detail(request, "appointment"), { id: "appointment" });
    assert.deepEqual(calls, [[{ merchantId: "merchant", userId: "owner", role: "owner" }, query], [{ merchantId: "merchant", userId: "owner", role: "owner" }, "appointment"]]);
  });
  await t.test("shared operator refuses absent or nonhuman principals before reader execution", () => {
    const controller = new ServiceAppointmentReadsController({ list: () => assert.fail("must not read") } as never);
    for (const invalid of [{}, { tenantPrincipal: { kind: "service", tenantId: "merchant", credentialId: "credential", environment: "live", scopes: [] } }])
      assert.throws(() => controller.list(invalid as never, {}));
  });
  await t.test("public sanitizer removes private lease and continuation metadata from both reads", async () => {
    const unsafe = { id: "appointment", history: [{ privateLease: "private", privatePaymentContinuation: "private", action: "manual_create" }] };
    const controller = new ServiceAppointmentReadsController({ list: async () => ({ items: [unsafe] }), detail: async () => unsafe } as never);
    assert.equal(JSON.stringify(await controller.list(request, {})).includes("private"), false);
    assert.equal(JSON.stringify(await controller.detail(request, "appointment")).includes("private"), false);
  });
  await t.test("the existing five-dependency writer controller and manual delegation stay intact", async () => {
    const result = { appointment: { id: "written" } }, command = { commandId: "existing-command" }, calls: unknown[] = [];
    const writer = new ServiceAppointmentsController({ execute: async (...args: unknown[]) => { calls.push(args); return result; } } as never,
      {} as never, {} as never, {} as never, {} as never);
    assert.deepEqual(await writer.createManual(request, command as never), result);
    assert.deepEqual(calls, [[{ merchantId: "merchant", userId: "owner", role: "owner" }, command]]);
  });
});
