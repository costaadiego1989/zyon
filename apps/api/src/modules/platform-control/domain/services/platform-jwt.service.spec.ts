import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import type {
  PlatformOperatorRepository,
  PlatformSessionRecord,
} from "../ports/platform-operator-repository.port.js";
import { hasPlatformPermission } from "../platform-operator.js";
import { PlatformJwtService } from "./platform-jwt.service.js";

const SECRET = "platform-control-test-secret-at-least-32-bytes";

test("platform token requires its explicit audience and a live platform session", async () => {
  const repository = new InMemoryPlatformOperatorRepository();
  const jwt = new PlatformJwtService(repository, SECRET, 900);
  const principal = { operatorId: "operator_1", email: "ops@zyon.test", role: "platform_admin" as const };

  const token = await jwt.issue(principal, 0);
  assert.deepEqual(await jwt.authenticate(token), principal);

  const merchantToken = signedToken({
    sub: "merchant_user_1",
    merchant_id: "merchant_1",
    email: "merchant@zyon.test",
    role: "owner",
    jti: "merchant_session_1",
    iat: 1_700_000_000,
    exp: 1_700_000_900,
  });
  await assert.rejects(() => jwt.authenticate(merchantToken), /platform_jwt_wrong_audience/);
});

test("platform permissions deny unassigned commercial and infrastructure access", () => {
  assert.equal(hasPlatformPermission("billing_ops", "platform:billing:read"), true);
  assert.equal(hasPlatformPermission("billing_ops", "platform:infrastructure:read"), false);
  assert.equal(hasPlatformPermission("support_ops", "platform:feedback:write"), true);
  assert.equal(hasPlatformPermission("support_ops", "platform:billing:read"), false);
  assert.equal(hasPlatformPermission("auditor", "platform:exports:read"), false);
});

class InMemoryPlatformOperatorRepository implements PlatformOperatorRepository {
  private readonly sessions = new Map<string, PlatformSessionRecord>();

  async findByEmail() {
    return undefined;
  }

  async createSession(input: PlatformSessionRecord): Promise<boolean> {
    this.sessions.set(input.id, input);
    return true;
  }

  async findActiveSession(id: string): Promise<PlatformSessionRecord | undefined> {
    return this.sessions.get(id);
  }

  async rotateSession(id: string, replacement: PlatformSessionRecord): Promise<boolean> {
    if (!this.sessions.has(id)) return false;
    this.sessions.delete(id);
    this.sessions.set(replacement.id, replacement);
    return true;
  }

  async revokeSessionFamily(id: string): Promise<void> {
    const current = this.sessions.get(id);
    if (!current) return;
    for (const [sessionId, session] of this.sessions) {
      if (session.familyId === current.familyId) this.sessions.delete(sessionId);
    }
  }
}

function signedToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}
