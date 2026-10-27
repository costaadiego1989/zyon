import test from "node:test";
import assert from "node:assert/strict";
import { ListDomainsUseCase } from "./list-domains.use-case.js";
import { RegisterDomainUseCase } from "./register-domain.use-case.js";
import { VerifyDomainUseCase } from "./verify-domain.use-case.js";
import { domainOwnershipChallenge } from "../../domain-ownership.js";
import { resolveDomainCnameTarget } from "../../domain-cname-target.js";

test("legacy domains use the registration target and still require authoritative CNAME and ownership TXT", async (t) => {
  const oldTarget = process.env.STOREFRONT_CNAME_TARGET;
  process.env.STOREFRONT_CNAME_TARGET = " stores.configured.example ";
  t.after(() => { if (oldTarget === undefined) delete process.env.STOREFRONT_CNAME_TARGET; else process.env.STOREFRONT_CNAME_TARGET = oldTarget; });
  const legacy = { id: "domain-legacy", merchantId: "merchant-a", domain: "loja.example.com", cnameTarget: null,
    verified: true, ownershipVerifiedAt: null, verifiedAt: new Date("2026-09-01"), createdAt: new Date("2026-09-01") };
  const current = { ...legacy, id: "domain-current", domain: "other.example.com", cnameTarget: "original.example.com", ownershipVerifiedAt: new Date("2026-09-01") };
  const writes: any[] = [];
  const reads: any[] = [];
  const prisma = { merchant: { findUnique: async () => ({ id: "merchant-a" }) }, merchantDomain: {
    findMany: async (query: any) => { reads.push(query); return [legacy, current]; },
    findFirst: async ({ where }: any) => where.merchantId === legacy.merchantId && where.id === legacy.id ? legacy : null,
    findUnique: async () => null,
    create: async ({ data }: any) => { writes.push(data); return { id: "domain-new", ...data }; },
    update: async ({ data }: any) => { writes.push(data); return { ...legacy, ...data }; },
  } } as any;

  const list = await new ListDomainsUseCase(prisma).execute("merchant-a");
  assert.deepEqual(reads[0].where, { merchantId: "merchant-a" });
  assert.equal(list[0].cname_target, "stores.configured.example");
  assert.equal(list[0].verified, false, "legacy verified flag cannot bypass ownership TXT");
  assert.equal(list[1].cname_target, "original.example.com");
  assert.equal(list[1].verified, true);
  assert.equal(writes.length, 0, "listing must never repair data or mark ownership verified");
  assert.deepEqual({ txt_name: list[0].txt_name, txt_value: list[0].txt_value }, domainOwnershipChallenge(legacy));
  assert.equal((await new RegisterDomainUseCase(prisma).execute({ merchant_id: "merchant-a", domain: "new.example.com" })).cname_target, list[0].cname_target);

  const lookups: unknown[][] = [];
  let txtMatches = false;
  const dns = { verifyCname: async (...args: unknown[]) => { lookups.push(args); return true; },
    verifyTxt: async (...args: unknown[]) => { lookups.push(args); return txtMatches; } } as any;
  const verify = new VerifyDomainUseCase(prisma, dns);
  assert.equal((await verify.execute({ merchant_id: "merchant-a", domain_id: legacy.id })).verified, false);
  assert.deepEqual(lookups[0], [legacy.domain, "stores.configured.example"]);
  assert.deepEqual(lookups[1], [list[0].txt_name, list[0].txt_value]);
  assert.deepEqual(writes.at(-1), { verified: false, verifiedAt: null, ownershipVerifiedAt: null });
  txtMatches = true;
  assert.equal((await verify.execute({ merchant_id: "merchant-a", domain_id: legacy.id })).verified, true);
  assert.ok(writes.at(-1).ownershipVerifiedAt instanceof Date);
  await assert.rejects(verify.execute({ merchant_id: "other-merchant", domain_id: legacy.id }), /domain_not_found/);

  const writeCount = writes.length;
  const failingDns = { verifyCname: async () => { throw new Error("dns_verification_unavailable"); } } as any;
  await assert.rejects(new VerifyDomainUseCase(prisma, failingDns).execute({ merchant_id: "merchant-a", domain_id: legacy.id }), /dns_verification_unavailable/);
  assert.equal(writes.length, writeCount, "DNS outage must not revoke or confirm ownership");
  delete process.env.STOREFRONT_CNAME_TARGET;
  assert.equal(resolveDomainCnameTarget(null), "stores.zyon.com");
  assert.equal(resolveDomainCnameTarget("preserved.example.com"), "preserved.example.com");
});
