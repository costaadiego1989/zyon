import test from "node:test";
import assert from "node:assert/strict";
import { promises as dns } from "node:dns";
import { RegisterDomainUseCase } from "./register-domain.use-case.js";
import { VerifyDomainUseCase } from "./verify-domain.use-case.js";
import { DnsVerificationService } from "../../infrastructure/dns-verification.service.js";

test("domain registration rejects malformed hosts and normalizes valid domains", async () => {
  const writes: any[] = [];
  const useCase = new RegisterDomainUseCase({ merchant: { findUnique: async () => ({ id: "m1" }) }, merchantDomain: {
    findUnique: async () => null, create: async ({ data }: any) => { writes.push(data); return { id: "d1", ...data }; },
  } } as any);
  for (const domain of [undefined, null, [], "", "https://example.com", "a..com", "-shop.com", "shop-.com", "a".repeat(64) + ".com", "a.com:443", "a.com/path"]) {
    await assert.rejects(useCase.execute({ merchant_id: "m1", domain: domain as any }), /invalid_domain/);
  }
  assert.equal(writes.length, 0);
  assert.equal((await useCase.execute({ merchant_id: "m1", domain: " SHOP.Example.COM. " })).domain, "shop.example.com");
});

test("domain revalidation is tenant scoped, persists mismatches, and preserves state on outages", async () => {
  const record = { merchantId: "m1", id: "d1", domain: "shop.example.com", verified: true, verifiedAt: new Date(), cnameTarget: "stores.example.com" };
  const writes: any[] = [];
  const prisma = { merchantDomain: {
    findFirst: async ({ where }: any) => where.merchantId === "m1" && where.id === "d1" ? record : null,
    update: async ({ data }: any) => { writes.push(data); return { ...record, ...data }; },
  } } as any;
  const useCase = new VerifyDomainUseCase(prisma, { verifyCname: async () => false, verifyTxt: async () => false } as any);
  await assert.rejects(useCase.execute({ merchant_id: "other", domain_id: "d1" }), /domain_not_found/);
  assert.equal(writes.length, 0);
  assert.equal((await useCase.execute({ merchant_id: "m1", domain_id: "d1" })).verified, false);
  assert.deepEqual(writes, [{ verified: false, verifiedAt: null, ownershipVerifiedAt: null }]);
  await assert.rejects(new VerifyDomainUseCase(prisma, { verifyCname: async () => { throw new Error("unavailable"); } } as any).execute({ merchant_id: "m1", domain_id: "d1" }), /unavailable/);
  assert.equal(writes.length, 1);
});

test("DNS differentiates missing records from transient resolver failures", async (t) => {
  const lookup = t.mock.method(dns, "resolveCname", async () => ["STORES.EXAMPLE.COM."]);
  const service = new DnsVerificationService();
  assert.equal(await service.verifyCname("shop.example.com", "stores.example.com"), true);
  lookup.mock.mockImplementation(async () => { throw Object.assign(new Error("missing"), { code: "ENODATA" }); });
  assert.equal(await service.verifyCname("shop.example.com", "stores.example.com"), false);
  lookup.mock.mockImplementation(async () => { throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" }); });
  await assert.rejects(service.verifyCname("shop.example.com", "stores.example.com"), /dns_verification_unavailable/);
});
