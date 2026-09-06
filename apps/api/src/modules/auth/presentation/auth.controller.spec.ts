import test from "node:test";
import assert from "node:assert/strict";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import { AuthController } from "./auth.controller.js";
import { UnauthorizedException } from "@nestjs/common";

test("AuthController.logout clears the auth cookie", async () => {
  const controller = new AuthController(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    new AuthCookieService("aacp_access_token", false)
  );
  const headers = new Map<string, string>();

  await controller.logout({
    setHeader(name: string, value: string) {
      headers.set(name, value);
    }
  }, {});

  assert.equal(headers.get("Set-Cookie"), "aacp_access_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
});

test("AuthController refresh waits for durable rotation before setting the cookie and maps replay to401", async () => {
  let settled = false;
  const expected = { merchant_id: "mrc_1", user_id: "user_1", email: "owner@example.test", access_token: "rotated", token_type: "Bearer" as const, expires_in: 60 };
  const refresh = { execute: async () => { await Promise.resolve(); settled = true; return expected; } };
  const cookies = { read: () => undefined, create: (auth: typeof expected) => { assert.equal(settled, true); assert.equal(auth, expected); return "cookie"; } };
  const controller = new AuthController(null as never, null as never, refresh as never, null as never, null as never, null as never, cookies as never);
  const result = await controller.refresh({ headers: { authorization: "Bearer old" } }, { setHeader: () => {} });
  assert.equal(result, expected);
  refresh.execute = async () => { throw new Error("jwt_refresh_replayed"); };
  await assert.rejects(controller.refresh({ headers: { authorization: "Bearer old" } }, { setHeader: () => {} }), (error: any) => error instanceof UnauthorizedException && error.getStatus() === 401);
  refresh.execute = async () => { throw new Error("database connection unavailable; secret details"); };
  await assert.rejects(controller.refresh({ headers: { authorization: "Bearer old" } }, { setHeader: () => assert.fail("must preserve existing cookie on database failure") }),
    (error: any) => error.getStatus() === 503 && error.message === "auth_session_store_unavailable");
});

test("AuthController logout waits for revocation and clears cookie even when invalid credentials are rejected", async () => {
  const events: string[] = [];
  const revoke = { logout: async (token: string) => { assert.equal(token, "session"); await Promise.resolve(); events.push("revoked"); } };
  const controller = new AuthController(null as never, null as never, revoke as never, null as never, null as never, null as never, new AuthCookieService());
  const response = { setHeader: () => { events.push("cleared"); } };
  await controller.logout(response, { headers: { authorization: "Bearer session" } });
  assert.deepEqual(events, ["revoked", "cleared"]);
  revoke.logout = async () => { throw new Error("jwt_invalid_signature"); };
  await assert.rejects(controller.logout(response, { headers: { authorization: "Bearer invalid" } }), (error: any) => error.getStatus() === 401);
  assert.equal(events.at(-1), "cleared");
});
