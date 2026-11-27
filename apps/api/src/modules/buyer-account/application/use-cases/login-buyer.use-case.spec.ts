import test from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { PasswordHasher } from "../../../auth/domain/services/password-hasher.service.js";
import { InMemoryBuyerAccountRepository } from "../../infrastructure/in-memory-buyer-account.repository.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import { LoginBuyerUseCase } from "./login-buyer.use-case.js";

const email = "booking-buyer@example.test", password = "SyntheticBuyerPassword123!";
class ObservedBuyers extends InMemoryBuyerAccountRepository {
  readonly emails: string[] = [];
  override findByEmail(value: string) { this.emails.push(value); return super.findByEmail(value); }
}
class ObservedBuyerJwt extends BuyerJwtService {
  signCalls = 0;
  constructor() { super("synthetic-buyer-login-contract-secret", 3600); }
  override sign(...args: Parameters<BuyerJwtService["sign"]>) { this.signCalls++; return super.sign(...args); }
}
function account(passwordHash: string | null) {
  return new BuyerAccount({ globalUserId: "buyer_booking_auth_contract", email, passwordHash,
    displayName: "Synthetic Booking Buyer", phone: "5511999991234", cpf: "12345678909",
    createdAt: new Date("2026-11-17T00:00:00.000Z"), updatedAt: new Date("2026-11-17T00:00:00.000Z") });
}
async function fixture(value: BuyerAccount | null) {
  const buyers = new ObservedBuyers(), jwt = new ObservedBuyerJwt(), hasher = new PasswordHasher();
  if (value) await buyers.save(value);
  return { buyers, jwt, useCase: new LoginBuyerUseCase(buyers, hasher, jwt) };
}
async function denied(f: Awaited<ReturnType<typeof fixture>>, input = { email, password }) {
  await assert.rejects(f.useCase.execute(input), error => {
    assert.ok(error instanceof UnauthorizedException);
    assert.equal(error.getStatus(), 401); assert.equal(error.message, "invalid_credentials");
    assert.deepEqual(error.getResponse(), { message: "invalid_credentials", error: "Unauthorized", statusCode: 401 });
    return true;
  });
  assert.equal(f.jwt.signCalls, 0, "invalid credentials must never reach the actual JWT signer");
}

test("Buyer login rejects the wrong password with the real hasher and creates no JWT", async () => {
  const saved = account(await new PasswordHasher().hash(password)), f = await fixture(saved);
  await denied(f, { email, password: "WrongSyntheticPassword123!" });
  assert.deepEqual(f.buyers.emails, [email]);
  assert.deepEqual(await f.buyers.findByGlobalUserId(saved.globalUserId), saved);
});

test("Buyer login rejects malformed and unsupported stored hashes without creating a JWT", async t => {
  for (const passwordHash of ["not-a-password-hash", "argon2id:salt:hash", "scrypt::missing-salt"]) {
    await t.test(passwordHash, async () => {
      const saved = account(passwordHash), f = await fixture(saved);
      await denied(f); assert.deepEqual(await f.buyers.findByGlobalUserId(saved.globalUserId), saved);
    });
  }
});

test("Buyer login rejects a phone-only account without creating a JWT", async () => {
  const saved = account(null), f = await fixture(saved);
  await denied(f); assert.deepEqual(await f.buyers.findByGlobalUserId(saved.globalUserId), saved);
});

test("Buyer login rejects an absent account without creating a JWT", async () => {
  const f = await fixture(null); await denied(f);
  assert.deepEqual(f.buyers.emails, [email]); assert.equal(await f.buyers.findByEmail(email), null);
});

test("Buyer login accepts the correct password, normalizes email and returns a real buyer JWT", async () => {
  const saved = account(await new PasswordHasher().hash(password)), f = await fixture(saved);
  const result = await f.useCase.execute({ email: "  BOOKING-BUYER@EXAMPLE.TEST  ", password });
  assert.deepEqual(f.buyers.emails, [email]); assert.equal(f.jwt.signCalls, 1);
  assert.equal(result.globalUserId, saved.globalUserId); assert.equal(result.email, email);
  assert.equal(result.name, saved.displayName); assert.equal(result.tokenType, "Bearer");
  assert.equal(result.expiresIn, 3600); assert.equal(result.profileComplete, true);
  assert.deepEqual(f.jwt.verify(result.accessToken), { globalUserId: saved.globalUserId, email, merchantId: undefined, role: "buyer", aud: "buyer" });
  assert.deepEqual(await f.buyers.findByGlobalUserId(saved.globalUserId), saved);
  assert.equal(Object.hasOwn(result, "passwordHash"), false);
});

test("Buyer login preserves independent complete account snapshots across password outcomes", async t => {
  const correctHash = await new PasswordHasher().hash(password);
  const address = { zip: "01310000", street: "Synthetic Street", number: "47", neighborhood: "Synthetic District", city: "Synthetic City", state: "SP", complement: "Synthetic Unit" };
  const cases = [
    { name: "wrong password", hash: correctHash, supplied: "WrongSyntheticPassword123!", accepted: false },
    { name: "unsupported stored hash", hash: "argon2id:synthetic-salt:synthetic-hash", supplied: password, accepted: false },
    { name: "correct password", hash: correctHash, supplied: password, accepted: true },
  ];
  const snapshot = (value: BuyerAccount) => structuredClone({
    globalUserId: value.globalUserId, email: value.email, displayName: value.displayName,
    passwordHash: value.passwordHash, phone: value.phone, phoneCountryCode: value.phoneCountryCode,
    cpf: value.cpf, dateOfBirth: value.dateOfBirth, gender: value.gender, asaasCustomerId: value.asaasCustomerId,
    address: value.address, createdAt: value.createdAt, updatedAt: value.updatedAt,
  });
  for (const current of cases) {
    await t.test(current.name, async () => {
      const saved = new BuyerAccount({ ...account(current.hash), phoneCountryCode: "55", address: { ...address },
        dateOfBirth: new Date("2000-01-02T00:00:00.000Z"), gender: "synthetic-value", asaasCustomerId: "synthetic-private-customer" });
      const f = await fixture(saved), before = Object.freeze(snapshot(saved));
      // Expected data is explicit and nonempty. This clone exists before the
      // command and shares neither nested profile data nor Date objects with
      // the account reference retained by the in-memory repository.
      assert.deepEqual(before, {
        globalUserId: "buyer_booking_auth_contract", email, displayName: "Synthetic Booking Buyer",
        passwordHash: current.hash, phone: "5511999991234", phoneCountryCode: "55", cpf: "12345678909",
        dateOfBirth: new Date("2000-01-02T00:00:00.000Z"), gender: "synthetic-value", asaasCustomerId: "synthetic-private-customer",
        address, createdAt: new Date("2026-11-17T00:00:00.000Z"), updatedAt: new Date("2026-11-17T00:00:00.000Z"),
      });
      assert.ok(typeof before.passwordHash === "string" && before.passwordHash.length > 0);
      assert.notEqual(before.address, saved.address); assert.notEqual(before.createdAt, saved.createdAt);
      assert.notEqual(before.updatedAt, saved.updatedAt); assert.notEqual(before.dateOfBirth, saved.dateOfBirth);
      if (current.accepted) {
        const result = await f.useCase.execute({ email: "  BOOKING-BUYER@EXAMPLE.TEST  ", password: current.supplied });
        assert.equal(f.jwt.signCalls, 1); assert.equal(result.globalUserId, before.globalUserId); assert.equal(result.email, before.email);
        assert.deepEqual(f.jwt.verify(result.accessToken), { globalUserId: before.globalUserId, email: before.email, merchantId: undefined, role: "buyer", aud: "buyer" });
      } else await denied(f, { email, password: current.supplied });
      const stored = await f.buyers.findByGlobalUserId(before.globalUserId);
      assert.ok(stored, "the original account must remain persisted");
      assert.deepEqual(snapshot(stored), before, "login must preserve profile, private credential and lifecycle fields");
    });
  }
});


test("Buyer login rejects empty, wrong-length and noncanonical scrypt keys without a JWT or account changes", async t => {
  const hash = await new PasswordHasher().hash(password);
  const [algorithm, salt, key] = hash.split(":");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const aliasedLastByte = key!.slice(0, -1) + alphabet[alphabet.indexOf(key!.at(-1)!) + 1];
  const cases = [
    ["ignored punctuation decodes to an empty key", "scrypt:synthetic-salt:!"],
    ["one-byte key", `scrypt:synthetic-salt:${Buffer.alloc(1).toString("base64url")}`],
    ["63-byte key", `scrypt:synthetic-salt:${Buffer.alloc(63).toString("base64url")}`],
    ["65-byte key", `scrypt:synthetic-salt:${Buffer.alloc(65).toString("base64url")}`],
    ["padded key", `${hash}=`],
    ["key with ignored punctuation", `${hash}!`],
    ["key with ignored whitespace", `${hash}\n`],
    ["key with nonzero unused bits", `${algorithm}:${salt}:${aliasedLastByte}`],
  ];
  for (const [name, passwordHash] of cases) {
    await t.test(name!, async () => {
      const saved = account(passwordHash!), before = structuredClone(saved), f = await fixture(saved);
      await denied(f);
      assert.deepEqual(f.buyers.emails, [email]);
      assert.deepEqual(structuredClone(await f.buyers.findByGlobalUserId(saved.globalUserId)), before);
    });
  }
});
