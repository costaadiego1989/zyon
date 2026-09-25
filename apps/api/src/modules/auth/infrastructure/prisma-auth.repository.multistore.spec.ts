import assert from "node:assert/strict";
import test from "node:test";
import { PrismaAuthRepository } from "./prisma-auth.repository.js";

test("an owner can receive a session scoped to a managed store without changing the owner account", async () => {
  const createdSessions: Array<Record<string, unknown>> = [];
  const prisma = {
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
      $queryRaw: async () => undefined,
      merchantUser: {
        findUnique: async () => ({
          id: "user_1",
          // The legacy owner record remains attached to the billing-account store.
          merchantId: "account_store",
          email: "owner@example.com",
          role: "owner",
          authVersion: 3,
          disabledAt: null,
        }),
      },
      merchantTeamMember: {
        findUnique: async ({ where }: { where: { merchantId_userId: { merchantId: string; userId: string } } }) => {
          assert.deepEqual(where.merchantId_userId, { merchantId: "child_store", userId: "user_1" });
          return { role: "OWNER" };
        },
      },
      merchantAuthSession: {
        create: async ({ data }: { data: Record<string, unknown> }) => { createdSessions.push(data); },
      },
    }),
  } as never;
  const repository = new PrismaAuthRepository(prisma);

  const created = await repository.createSession({
    id: "session_2",
    familyId: "family_1",
    userId: "user_1",
    merchantId: "child_store",
    email: "owner@example.com",
    role: "owner",
    authVersion: 3,
    refreshExpiresAt: new Date("2026-10-01T00:00:00.000Z"),
  });

  assert.equal(created, true);
  assert.equal(createdSessions[0]?.merchantId, "child_store");
});
