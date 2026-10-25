import test from "node:test";
import assert from "node:assert/strict";
import { PrismaBuyerAccountRepository } from "./prisma-buyer-account.repository.js";
import { BuyerAccount } from "../domain/entities/buyer-account.entity.js";
import { isPiiEncrypted } from "../../../shared/crypto/pii-cipher.service.js";

test("an encrypted account is found by canonical WhatsApp phone and remains encrypted after profile changes", async () => {
  let row: any;
  const prisma: any = { buyerAccount: {
    upsert: async ({ create, update }: any) => { row = row ? { ...row, ...update } : create; },
    findMany: async ({ where }: any) => row.phoneLookupHash === where.phoneLookupHash ? [row] : [],
    findFirst: async () => { assert.fail("encrypted lookup must use its index"); },
  } };
  const repo = new PrismaBuyerAccountRepository(prisma);
  const account = new BuyerAccount({ globalUserId: "buyer", email: "buyer@example.com", displayName: "Pessoa", phone: "21971191446", passwordHash: "hash", createdAt: new Date(), updatedAt: new Date() });
  await repo.save(account);
  assert.equal(isPiiEncrypted(row.phone), true);
  assert.equal(row.phoneLookupHash.length, 64);
  const found = await repo.findByPhone("552171191446");
  assert.equal(found?.globalUserId, account.globalUserId);
  assert.equal(found?.phone, "21971191446");
  await repo.save(account.withUpdatedProfile(undefined, "21971191447"));
  assert.equal((await repo.findByPhone("552171191447"))?.email, "buyer@example.com");
});

test("a shared phone never selects an arbitrary buyer account", async () => {
  const repo = new PrismaBuyerAccountRepository({ buyerAccount: { findMany: async () => [{ globalUserId: "one" }, { globalUserId: "two" }] } } as any);
  assert.equal(await repo.findByPhone("21971191446"), null);
});
