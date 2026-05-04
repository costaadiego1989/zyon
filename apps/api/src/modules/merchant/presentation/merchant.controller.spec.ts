import test from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "../../auth/domain/services/jwt.service.js";
import { AuthCookieService } from "../../auth/domain/services/auth-cookie.service.js";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { GetMerchantProfileUseCase, GetMerchantRulesUseCase, UpdateMerchantRulesUseCase } from "../application/merchant.use-cases.js";
import { InMemoryMerchantRepository } from "../infrastructure/in-memory-merchant.repository.js";
import { MerchantController } from "./merchant.controller.js";

test("MerchantController reads and updates rules scoped by authenticated merchant", async () => {
  const repository = new InMemoryMerchantRepository();
  repository.seedProfile({ id: "mrc_1", name: "Demo Store" });
  const controller = new MerchantController(
    new GetMerchantProfileUseCase(repository),
    new GetMerchantRulesUseCase(repository),
    new UpdateMerchantRulesUseCase(repository)
  );
  const request = { user: { userId: "usr_1", merchantId: "mrc_1", email: "owner@example.com", role: "owner" } };

  assert.equal((await controller.profile(request)).id, "mrc_1");
  assert.equal((await controller.update(request, { maxDiscountPercent: 15 })).maxDiscountPercent, 15);
  assert.equal((await controller.rules(request)).maxDiscountPercent, 15);
});

test("AuthGuard rejects missing bearer tokens and accepts signed tokens", () => {
  const jwt = new JwtService("test-secret", 3600);
  const cookies = new AuthCookieService("aacp_access_token", false);
  const guard = new AuthGuard(jwt, cookies);
  const context = contextFor({});
  assert.throws(() => guard.canActivate(context), UnauthorizedException);

  const request: { headers: { authorization: string }; user?: unknown } = {
    headers: {
      authorization: `Bearer ${jwt.sign({
        userId: "usr_1",
        merchantId: "mrc_1",
        email: "owner@example.com",
        role: "owner"
      })}`
    }
  };
  assert.equal(guard.canActivate(contextFor(request)), true);
  assert.deepEqual(request.user, {
    userId: "usr_1",
    merchantId: "mrc_1",
    email: "owner@example.com",
    role: "owner"
  });

  const cookieRequest: { headers: { cookie: string }; user?: unknown } = {
    headers: {
      cookie: cookies.create({
        merchant_id: "mrc_1",
        user_id: "usr_1",
        email: "owner@example.com",
        access_token: jwt.sign({
          userId: "usr_1",
          merchantId: "mrc_1",
          email: "owner@example.com",
          role: "owner"
        }),
        token_type: "Bearer",
        expires_in: 3600
      })
    }
  };
  assert.equal(guard.canActivate(contextFor(cookieRequest)), true);
  assert.equal((cookieRequest.user as { merchantId: string }).merchantId, "mrc_1");
});

function contextFor(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as never;
}
