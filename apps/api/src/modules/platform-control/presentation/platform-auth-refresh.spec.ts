import assert from "node:assert/strict";
import test from "node:test";
import { PlatformAuthController } from "./platform-auth.controller.js";

test("SESSION AC2 refresh distinguishes revoked credentials from a temporary server outage", async () => {
  const request = { headers: { authorization: "Bearer operator-credential" } };
  for (const reason of ["platform_session_invalid", "platform_refresh_replayed", "platform_jwt_expired", "platform_jwt_invalid_signature"]) {
    const controller = new PlatformAuthController({} as never, { execute: async () => { throw Error(reason); } } as never);
    await assert.rejects(controller.refresh(request), (error: any) => error.getStatus() === 401 && error.message === "platform_refresh_failed");
  }
  const controller = new PlatformAuthController({} as never, { execute: async () => { throw Object.assign(Error("connection unavailable"), { code: "P1001" }); } } as never);
  await assert.rejects(controller.refresh(request), (error: any) => error.getStatus() === 503 && error.message === "platform_auth_unavailable");
  await assert.rejects(controller.refresh({ headers: {} }), (error: any) => error.getStatus() === 401);
});
