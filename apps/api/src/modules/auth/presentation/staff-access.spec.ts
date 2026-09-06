import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { AuthGuard } from "./auth.guard.js";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import { TENANT_ROLES_METADATA } from "./tenant-role.decorator.js";
import { SupportController } from "../../support/presentation/http/support.controller.js";
import { SupportMessagesController } from "../../support/presentation/http/support-messages.controller.js";
import { TenantCredentialGuard } from "../../integrations/presentation/http/tenant-credential.guard.js";
import { EmbedSessionIssuerGuard } from "../../embed/presentation/http/embed-session-issuer.guard.js";

const user = { userId: "staff_1", merchantId: "mrc_1", email: "staff@example.test", role: "staff" };
function context(handler: (...args: any[]) => unknown = () => {}, controller: any = class TestController {}) {
  const request: any = { headers: { authorization: "Bearer fixture" } };
  return { request, context: { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => handler, getClass: () => controller } as any };
}
test("staff denied by default with HTTP403 on every merchant credential guard", async () => {
  const jwt = { authenticate: async () => user } as never;
  for (const guard of [new AuthGuard(jwt, new AuthCookieService()), new TenantCredentialGuard(jwt, new AuthCookieService(), null as never),
    new EmbedSessionIssuerGuard(jwt, new AuthCookieService(), null as never)]) {
    const f = context();
    await assert.rejects(guard.canActivate(f.context), (error: any) => error.getStatus() === 403);
    assert.equal(f.request.tenantPrincipal, undefined);
  }
});
test("staff support message permission is explicit and cannot reach support settings", async () => {
  const guard = new TenantCredentialGuard({ authenticate: async () => user } as never, new AuthCookieService(), null as never);
  const allowed = context(SupportMessagesController.prototype.send, SupportMessagesController);
  assert.equal(await guard.canActivate(allowed.context), true);
  assert.equal(allowed.request.tenantPrincipal.role, "staff");
  const methods = Object.getOwnPropertyNames(SupportController.prototype);
  const ticketMethod = methods.find(name => Reflect.getMetadata(TENANT_ROLES_METADATA, (SupportController.prototype as any)[name])?.includes("staff"));
  assert.ok(ticketMethod);
  const unknown = context(() => {}, SupportController);
  await assert.rejects(guard.canActivate(unknown.context), (error: any) => error.getStatus() === 403);
});
