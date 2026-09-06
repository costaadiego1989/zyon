import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { PrismaAuthRepository } from "./prisma-auth.repository.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { LoginUseCase } from "../application/login.use-case.js";
import { InviteMemberUseCase } from "../../team/application/use-cases/invite-member.use-case.js";
import { UpdateRoleUseCase } from "../../team/application/use-cases/update-role.use-case.js";
import { RemoveMemberUseCase } from "../../team/application/use-cases/remove-member.use-case.js";
import { AcceptInviteUseCase } from "../../team/application/use-cases/accept-invite.use-case.js";

const clientPath = process.env.READY_PROD_TEST_PRISMA_CLIENT;
const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
describe("durable merchant authentication and membership (PostgreSQL)", { skip: !clientPath || !databaseUrl }, () => {
  let prisma: any;
  let replica: any;
  let repo: PrismaAuthRepository;
  let otherRepo: PrismaAuthRepository;
  const merchants: string[] = [];
  const secret = "test-durable-merchant-auth-secret-32-characters";
  const hasher = new PasswordHasher();
  before(async () => {
    const { PrismaClient } = createRequire(import.meta.url)(clientPath!);
    const options = { datasources: { db: { url: databaseUrl } }, transactionOptions: { maxWait: 30000, timeout: 15000 } };
    prisma = new PrismaClient(options); replica = new PrismaClient(options);
    repo = new PrismaAuthRepository(prisma); otherRepo = new PrismaAuthRepository(replica);
  });
  after(async () => {
    if (!prisma) return;
    await prisma.merchantInvite.deleteMany({ where: { merchantId: { in: merchants } } });
    await prisma.merchant.deleteMany({ where: { id: { in: merchants } } });
    await prisma.$disconnect(); await replica.$disconnect();
  });
  async function fixture() {
    const merchantId = `auth_stage2_${randomUUID()}`; merchants.push(merchantId);
    const { user } = await repo.createMerchantWithOwner({ merchantId, merchantName: "Auth test", email: `${randomUUID()}@example.test`, passwordHash: "fixture" });
    const principal = { userId: user.id, merchantId, email: user.email, role: user.role };
    return { user, merchantId, principal, jwt: new JwtService(secret, 3600, repo), jwtOther: new JwtService(secret, 3600, otherRepo) };
  }
  it("twenty parallel refreshes of an expired token across replicas have exactly one winner", async () => {
    const f = await fixture();
    const old = f.jwt.sign(f.principal, Math.floor(Date.now() / 1000) - 3700);
    const claims = JSON.parse(Buffer.from(old.split(".")[1]!, "base64url").toString());
    await repo.createSession({ id: claims.jti, familyId: randomUUID(), ...f.principal, authVersion: 0, refreshExpiresAt: new Date((claims.exp + 604800) * 1000) });
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => (i % 2 ? f.jwt : f.jwtOther).rotate(old)));
    const winners = outcomes.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<JwtService["rotate"]>>> => r.status === "fulfilled");
    assert.equal(winners.length, 1);
    assert.equal((await f.jwtOther.authenticate(winners[0]!.value.token)).userId, f.user.id);
    await assert.rejects(f.jwt.rotate(old));
    assert.equal(await prisma.merchantAuthSession.count({ where: { userId: f.user.id } }), 2);
  });
  it("logout revokes the entire family on another replica including a refreshed descendant", async () => {
    const f = await fixture(); const old = await f.jwt.issue(f.principal);
    const next = await f.jwt.rotate(old);
    await f.jwtOther.revoke(old);
    await assert.rejects(f.jwt.authenticate(next.token));
    await assert.rejects(f.jwtOther.rotate(next.token));
    const fresh = await f.jwt.issue(f.principal);
    assert.equal((await f.jwtOther.authenticate(fresh)).userId, f.user.id);
  });
  it("a reset hash survives new repository instances; concurrent consumers update once and invalidate all sessions", async () => {
    const f = await fixture(); const session = await f.jwt.issue(f.principal); const reset = randomUUID();
    await repo.storePasswordResetToken(f.user.id, reset, new Date(Date.now() + 60000));
    const row = await prisma.merchantPasswordResetToken.findUnique({ where: { tokenHash: createHash("sha256").update(reset).digest("hex") } });
    assert.ok(row); assert.ok(!Object.values(row).includes(reset));
    const outcomes = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? repo : new PrismaAuthRepository(replica)).consumePasswordReset(reset, `hash_${i}`, new Date())));
    assert.equal(outcomes.filter(Boolean).length, 1);
    assert.equal((await prisma.merchantUser.findUnique({ where: { id: f.user.id } })).authVersion, 1);
    await assert.rejects(f.jwtOther.authenticate(session)); await assert.rejects(f.jwt.rotate(session));
    assert.equal(await repo.consumePasswordReset(reset, "replay", new Date()), false);
  });
  it("expired or superseded password reset tokens never mutate credentials", async () => {
    const f = await fixture();
    await repo.storePasswordResetToken(f.user.id, "expired", new Date(Date.now() - 1));
    assert.equal(await otherRepo.consumePasswordReset("expired", "bad", new Date()), false);
    await repo.storePasswordResetToken(f.user.id, "first", new Date(Date.now() + 60000));
    await otherRepo.storePasswordResetToken(f.user.id, "second", new Date(Date.now() + 60000));
    assert.equal(await repo.consumePasswordReset("first", "bad", new Date()), false);
    assert.equal(await repo.consumePasswordReset("second", "good", new Date()), true);
  });
  it("invite every supported role, login, change role, and removal invalidate credentials across replicas", async () => {
    const f = await fixture();
    const sent: Array<{ html?: string }> = [];
    const invite = new InviteMemberUseCase(prisma, { send: async (email: any) => { sent.push(email); } } as never);
    for (const role of ["OWNER", "ADMIN", "STAFF"] as const) {
      const email = `${randomUUID()}@example.test`;
      await invite.execute({ merchant_id: f.merchantId, email, role, invited_by: f.user.id });
      const user = await otherRepo.findUserByEmail(email); assert.equal(user?.role, role.toLowerCase());
      const password = sent.at(-1)!.html!.match(/<code[^>]*>([^<]+)<\/code>/)![1]!;
      const auth = await new LoginUseCase(otherRepo, hasher, f.jwtOther).execute({ email, password });
      assert.equal((await f.jwt.authenticate(auth.access_token)).role, role.toLowerCase());
      await new UpdateRoleUseCase(prisma).execute({ merchant_id: f.merchantId, user_id: user!.id, new_role: "STAFF", requester_role: "OWNER", requester_id: f.user.id });
      await assert.rejects(f.jwtOther.authenticate(auth.access_token));
      const changed = await new LoginUseCase(otherRepo, hasher, f.jwtOther).execute({ email, password });
      assert.equal((await f.jwt.authenticate(changed.access_token)).role, "staff");
      await new RemoveMemberUseCase(prisma).execute({ merchant_id: f.merchantId, user_id: user!.id, requester_id: f.user.id });
      await assert.rejects(f.jwt.authenticate(changed.access_token));
      await assert.rejects(new LoginUseCase(otherRepo, hasher, f.jwtOther).execute({ email, password }));
    }
  });
  it("admin cannot invite an owner, remove an owner, or spoof requester_role", async () => {
    const f = await fixture();
    const admin = await prisma.merchantUser.create({ data: { merchantId: f.merchantId, email: `${randomUUID()}@example.test`, role: "admin", teamMembers: { create: { merchantId: f.merchantId, role: "ADMIN" } } } });
    await assert.rejects(new InviteMemberUseCase(prisma, { send: async () => {} } as never).execute({ merchant_id: f.merchantId, email: `${randomUUID()}@example.test`, role: "OWNER", invited_by: admin.id }));
    await assert.rejects(new RemoveMemberUseCase(prisma).execute({ merchant_id: f.merchantId, user_id: f.user.id, requester_id: admin.id }));
    await assert.rejects(new UpdateRoleUseCase(prisma).execute({ merchant_id: f.merchantId, user_id: admin.id, new_role: "OWNER", requester_role: "OWNER", requester_id: admin.id }));
    await assert.rejects(new UpdateRoleUseCase(prisma).execute({ merchant_id: f.merchantId, user_id: admin.id, new_role: "OWNER", requester_role: "OWNER", requester_id: "" }));
  });
  it("concurrent owner self-removals keep one active owner", async () => {
    const f = await fixture();
    const other = await prisma.merchantUser.create({ data: { merchantId: f.merchantId, email: `${randomUUID()}@example.test`, role: "owner", teamMembers: { create: { merchantId: f.merchantId, role: "OWNER" } } } });
    const outcomes = await Promise.allSettled([f.user.id, other.id].map((id, i) => new RemoveMemberUseCase(i ? replica : prisma).execute({ merchant_id: f.merchantId, user_id: id, requester_id: id })));
    assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(await prisma.merchantUser.count({ where: { merchantId: f.merchantId, role: "owner", disabledAt: null } }), 1);
  });
  it("legacy invites cannot transfer an account between tenants or restore a removed account", async () => {
    const f = await fixture(); const foreign = await fixture();
    const invite = await prisma.merchantInvite.create({ data: { merchantId: f.merchantId, email: foreign.user.email, invitedBy: f.user.id, role: "ADMIN", expiresAt: new Date(Date.now() + 60000) } });
    await assert.rejects(new AcceptInviteUseCase(prisma).execute({ invite_id: invite.id, user_id: foreign.user.id }));
    await assert.rejects(new InviteMemberUseCase(prisma, { send: async () => {} } as never).execute({ merchant_id: f.merchantId, email: foreign.user.email, role: "STAFF", invited_by: f.user.id }));
    assert.equal((await prisma.merchantInvite.findUnique({ where: { id: invite.id } })).status, "PENDING");
    assert.equal((await otherRepo.findUserByEmail(foreign.user.email))!.merchantId, foreign.merchantId);
  });
});
