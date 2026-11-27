import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { AuthCookieService } from "../../auth/domain/services/auth-cookie.service.js";
import { MerchantController } from "./merchant.controller.js";
import { GetMerchantProfileUseCase } from "../application/merchant.use-cases.js";
import { InMemoryMerchantRepository } from "../infrastructure/in-memory-merchant.repository.js";

const user = { userId: "staff_1", merchantId: "mrc_1", email: "staff@example.test", role: "staff" };
function context(handler: (...args: any[]) => unknown, controller: any) {
  const request: any = { headers: { authorization: "Bearer fixture" } };
  return { request, context: { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => handler, getClass: () => controller } as any };
}

test("staff can resolve their own dashboard actor without access to merchant configuration operations", async () => {
  const guard = new AuthGuard({ authenticate: async () => user } as never, new AuthCookieService());
  const allowed = context(MerchantController.prototype.profile, MerchantController);
  assert.equal(await guard.canActivate(allowed.context), true);
  assert.deepEqual(allowed.request.tenantPrincipal, {
    kind: "human", tenantId: "mrc_1", userId: "staff_1", email: "staff@example.test", role: "staff",
  });
  for (const method of ["getStoreSettings", "putStoreSettings", "update", "createStore"]) {
    const denied = context((MerchantController.prototype as any)[method], MerchantController);
    await assert.rejects(guard.canActivate(denied.context), (error: any) => error.getStatus() === 403);
    assert.equal(denied.request.tenantPrincipal, undefined);
  }
});

test("staff bootstrap exposes only the store and verified actor; owner profile retains existing configuration", async () => {
  const repository = new InMemoryMerchantRepository();
  const settings = { company: { email: "private@example.test" } };
  repository.seedProfile({ id: "mrc_1", name: "Store", slug: "store", storeSettings: settings, stripeConnectAccountId: "private-account", budgetModeEnabled: true });
  const profile = new GetMerchantProfileUseCase(repository);
  const principal = { kind: "human", tenantId: "mrc_1", userId: "staff_1", email: user.email, role: "staff" } as const;
  assert.deepEqual(await profile.execute("mrc_1", principal), { id: "mrc_1", name: "Store", slug: "store", userId: "staff_1", role: "staff" });
  const owner = await profile.execute("mrc_1", { ...principal, role: "owner", userId: "owner_1" });
  assert.deepEqual(owner.storeSettings, settings);
  assert.equal(owner.stripeConnectAccountId, "private-account");
  assert.equal(owner.userId, "owner_1");
});
