import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { ServiceAppointmentOperationSummaryController } from "./service-appointment-operation-summary.controller.js";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { TENANT_ROLES_METADATA } from "../../../auth/presentation/tenant-role.decorator.js";

test("T80 command review uses the established human tenant boundary and private cache policy", () => {
  assert.equal(Reflect.getMetadata("path", ServiceAppointmentOperationSummaryController), "merchants/:mid/service-appointments");
  assert.equal(Reflect.getMetadata("path", ServiceAppointmentOperationSummaryController.prototype.summary), ":appointmentId/operation-summary");
  assert.deepEqual(Reflect.getMetadata("__guards__", ServiceAppointmentOperationSummaryController), [AuthGuard, MerchantOwnershipGuard]);
  assert.deepEqual(Reflect.getMetadata(TENANT_ROLES_METADATA, ServiceAppointmentOperationSummaryController.prototype.summary), ["owner", "admin"]);
  assert.deepEqual(Reflect.getMetadata("__headers__", ServiceAppointmentOperationSummaryController.prototype.summary), [{ name: "Cache-Control", value: "no-store" }]);
});
test("T80 command review receives authenticated actor and exact resource, with no body identity", async () => {
  const calls: unknown[] = [], result = { appointmentId: "appointment-a" };
  const controller = new ServiceAppointmentOperationSummaryController({ execute: async (...args: unknown[]) => { calls.push(args); return result; } } as never);
  const request = { tenantPrincipal: { kind: "human" as const, tenantId: "tenant-a", userId: "owner-a", role: "owner" as const, email: "private@example.test" } };
  assert.equal(await controller.summary(request, "appointment-a"), result);
  assert.deepEqual(calls, [[{ merchantId: "tenant-a", userId: "owner-a", role: "owner" }, "appointment-a"]]);
});
test("T80 command review rejects absent and machine principals before invoking a reader", () => {
  const controller = new ServiceAppointmentOperationSummaryController({ execute: () => assert.fail("reader must not run") } as never);
  for (const request of [{}, { tenantPrincipal: { kind: "service", tenantId: "tenant-a", credentialId: "key", environment: "test", scopes: ["analytics:read"] } }])
    assert.throws(() => controller.summary(request as never, "appointment-a"));
});
