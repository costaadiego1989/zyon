import assert from "node:assert/strict";
import { BadRequestException, ConflictException } from "@nestjs/common";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { UpdateMarketplaceCheckoutAddressService } from "./update-marketplace-checkout-address.service.js";
import { checkoutAddressRegistrationSchema, checkoutExplicitAddressSchema } from "../../checkout/domain/services/checkout-explicit-address.schema.js";

const explicitAddress = { zip: "01310100", street: "Synthetic", number: "S/N", complement: "",
  neighborhood: "Synthetic district", city: "Synthetic city", state: "SP" };
test("shared explicit-address normalization preserves the existing marketplace contract", () => {
  assert.deepEqual(checkoutExplicitAddressSchema.parse({ ...explicitAddress, zip: " 01310-100 ", street: " Synthetic ",
    number: " S/N ", state: "sp", complement: undefined }), explicitAddress);
  assert.deepEqual(checkoutExplicitAddressSchema.parse({ ...explicitAddress, complement: null }), explicitAddress);
  const { complement: _complement, ...withoutComplement } = explicitAddress;
  assert.deepEqual(checkoutExplicitAddressSchema.parse(withoutComplement), explicitAddress);
  assert.deepEqual(checkoutExplicitAddressSchema.parse(Object.assign(Object.create(null), explicitAddress)), explicitAddress);
  for (const state of "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "))
    assert.equal(checkoutExplicitAddressSchema.parse({ ...explicitAddress, state: state.toLowerCase() }).state, state);
});

for (const address of [null, [], "address", new Date(), Object.assign(Object.create({ inherited: true }), explicitAddress),
  ...["zip", "street", "number", "neighborhood", "city", "state"].flatMap(field => [null, undefined].map(value => ({ ...explicitAddress, [field]: value }))),
  ...[{ zip: "00000000" }, { zip: "00000-000" }, { zip: "01310" }, { zip: "01310 100" }, { state: "ZZ" },
    { state: " SPX " }, { street: "" }, { street: "a\nb" }, { city: "\tSynthetic" }, { neighborhood: "\u0000" },
    { number: "" }, { number: "1".repeat(33) }, { street: "a".repeat(201) }, { complement: "a".repeat(161) },
    { city: "a".repeat(121) }, { neighborhood: "a".repeat(121) }, { shipping: {} }, { address_verified: true },
    { street: null }, { zip: 1310100 }, { complement: false }].map(patch => ({ ...explicitAddress, ...patch }))]) {
  test(`marketplace invalid-address boundary remains 400 before transaction (${JSON.stringify(address)})`, async () => {
    let transactions = 0;
    const prisma = { async $transaction() { transactions++; throw new Error("must_not_reach_transaction"); } };
    await assert.rejects(new UpdateMarketplaceCheckoutAddressService(prisma as unknown as PrismaClient).execute({
      merchantId: "synthetic-address-merchant", sessionId: "synthetic-address-checkout", address,
    }), error => error instanceof BadRequestException && error.message === "marketplace_address_invalid");
    assert.equal(transactions, 0); assert.equal(checkoutExplicitAddressSchema.safeParse(address).success, false);
  });
}

test("shared registration prerequisite preserves presence checks without inventing email/phone proof", () => {
  const customer = { fullName: " Synthetic ", email: " buyer@example.test ", cpf: "123.456.789-01", phone: "(11) 9",
    email_verified: false, phone_verified: false };
  assert.equal(checkoutAddressRegistrationSchema.safeParse(customer).success, true);
  for (const patch of [{ fullName: "" }, { email: " " }, { cpf: "123" }, { phone: "abc" }])
    assert.equal(checkoutAddressRegistrationSchema.safeParse({ ...customer, ...patch }).success, false);
});

test("explicit-address guard rejects throwing accessors/proxies without exposing their error", async () => {
  const secretError = "synthetic_caller_error_not_for_public_output";
  const accessor = { ...explicitAddress };
  Object.defineProperty(accessor, "street", { enumerable: true, get() { throw new Error(secretError); } });
  const proxy = new Proxy({}, { getPrototypeOf() { throw new Error(secretError); } });
  const readTrap = new Proxy({ ...explicitAddress }, { get() { throw new Error(secretError); } });
  // Snapshot descriptors once; parsing never invokes untrusted property reads.
  assert.deepEqual(checkoutExplicitAddressSchema.parse(readTrap), explicitAddress);
  for (const address of [accessor, proxy]) {
    assert.equal(checkoutExplicitAddressSchema.safeParse(address).success, false);
    const prisma = { async $transaction() { throw new Error("must_not_reach_transaction"); } };
    await assert.rejects(new UpdateMarketplaceCheckoutAddressService(prisma as unknown as PrismaClient).execute({
      merchantId: "synthetic-address-merchant", sessionId: "synthetic-address-checkout", address,
    }), error => error instanceof BadRequestException && error.message === "marketplace_address_invalid");
  }
});

for (const pilot of [false, true]) {
  for (const merchantId of ["synthetic-address-merchant", "synthetic-address-other"]) {
    test(`address wrapper takes merchant before anchor/row (incentive ${pilot}, ${merchantId})`, async () => {
      const previousEnabled = process.env.REVENUE_INCENTIVE_EXECUTION_ENABLED;
      const previousIds = process.env.REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS;
      process.env.REVENUE_INCENTIVE_EXECUTION_ENABLED = String(pilot);
      process.env.REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS = merchantId;
      const calls: Array<{ sql: string; values: unknown[] }> = [];
      const stop = new ConflictException("synthetic_stop_before_row");
      const tx = { async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
        const sql = parts.join("?"); calls.push({ sql, values });
        if (sql.includes("pg_advisory_xact_lock")) throw stop;
        assert.match(sql, /FROM merchants.*FOR UPDATE/); return [];
      } };
      const prisma = { async $transaction<T>(work: (client: typeof tx) => Promise<T>) { return work(tx); } };
      try {
        await assert.rejects(new UpdateMarketplaceCheckoutAddressService(prisma as unknown as PrismaClient).execute({
          merchantId, sessionId: "synthetic-address-checkout", address: { zip: "01310100", street: "Synthetic",
            number: "1", neighborhood: "Synthetic", city: "Synthetic", state: "SP" },
        }), error => error === stop);
        assert.equal(calls.length, 2);
        assert.match(calls[0]!.sql, /FROM merchants.*FOR UPDATE/);
        assert.deepEqual(calls[0]!.values, [merchantId]);
        assert.match(calls[1]!.sql, /pg_advisory_xact_lock/);
        assert.deepEqual(calls[1]!.values, [JSON.stringify(["checkout-session", merchantId, "synthetic-address-checkout"])]);
      } finally {
        if (previousEnabled === undefined) delete process.env.REVENUE_INCENTIVE_EXECUTION_ENABLED;
        else process.env.REVENUE_INCENTIVE_EXECUTION_ENABLED = previousEnabled;
        if (previousIds === undefined) delete process.env.REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS;
        else process.env.REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS = previousIds;
      }
    });
  }
}
