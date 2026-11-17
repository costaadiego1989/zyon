import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { ManageSupportNotificationSettingsUseCase } from "./manage-support-notification-settings.use-case.js";

type Row = { merchantId: string; fallbackWhatsapp: string | null; version: number; updatedAt: Date; internalMarker: string };
const phone = "+12125550183";
function fixture() {
  const tenant = new TenantContextService();
  const merchants = new Set(["merchant-a", "merchant-b"]);
  const rows = new Map<string, Row>([["merchant-b", { merchantId: "merchant-b", fallbackWhatsapp: "+12125550184",
    version: 9, updatedAt: new Date("2030-01-01T00:00:00Z"), internalMarker: "never-return-this-field" }]]);
  let tick = 0, calls = 0, failure: Error | null = null;
  const snapshot = () => structuredClone([...rows]);
  const findUnique = async ({ where }: { where: { merchantId: string } }) => {
    calls += 1;
    return structuredClone(rows.get(where.merchantId) ?? null);
  };
  const supportNotificationSetting = {
    findUnique,
    create: async ({ data }: { data: { merchantId: string; fallbackWhatsapp: string | null } }) => {
      calls += 1;
      if (failure) throw failure;
      assert.ok(merchants.has(data.merchantId));
      assert.equal(rows.has(data.merchantId), false);
      const row: Row = { ...data, version: 1, updatedAt: new Date(1_900_000_000_000 + ++tick), internalMarker: "never-return-this-field" };
      rows.set(data.merchantId, row);
      return structuredClone(row);
    },
    update: async ({ where, data }: { where: { merchantId: string }; data: { fallbackWhatsapp: string | null; version: { increment: number } | number } }) => {
      calls += 1;
      if (failure) throw failure;
      const current = rows.get(where.merchantId);
      assert.ok(current);
      const version = typeof data.version === "number" ? data.version : current.version + data.version.increment;
      const row = { ...current, fallbackWhatsapp: data.fallbackWhatsapp, version, updatedAt: new Date(1_900_000_000_000 + ++tick) };
      rows.set(where.merchantId, row);
      return structuredClone(row);
    },
  };
  const tx = { supportNotificationSetting, $queryRaw: async (_sql: unknown, merchantId: string) => {
    calls += 1;
    return merchants.has(merchantId) ? [{ id: merchantId }] : [];
  } };
  const prisma = { supportNotificationSetting, $transaction: async <T>(work: (client: typeof tx) => Promise<T>) => {
    calls += 1;
    return work(tx);
  } };
  const useCase = new ManageSupportNotificationSettingsUseCase(prisma as unknown as PrismaClient, tenant);
  return { useCase, rows, merchants, snapshot, calls: () => calls, fail: (error: Error) => { failure = error; },
    within: <T>(merchantId: string, work: () => T) => tenant.run({ merchantId, userId: "synthetic-operator", role: "owner" }, work) };
}

test("HUM-09 private recipient application", async t => {
  await t.test("absent settings return the private empty projection without creating a record", async () => {
    const f = fixture(), before = f.snapshot();
    const result = await f.within("merchant-a", () => f.useCase.get("merchant-a"));
    assert.deepEqual(result, { channel: "whatsapp", fallbackPhone: null, version: 0, updatedAt: null });
    assert.deepEqual(f.snapshot(), before);
  });
  await t.test("missing and foreign tenant contexts reject before persistence access", async () => {
    const f = fixture(), before = f.snapshot();
    const forbidden = (error: unknown) => {
      assert.equal((error as { getStatus(): number }).getStatus(), 403);
      assert.equal((error as Error).message, "support_notification_scope_mismatch");
      return true;
    };
    await assert.rejects(f.useCase.get("merchant-a"), forbidden);
    await f.within("merchant-a", async () => {
      await assert.rejects(f.useCase.get("merchant-b"), forbidden);
      await assert.rejects(f.useCase.save("merchant-b", { fallbackPhone: phone }), forbidden);
    });
    assert.equal(f.calls(), 0);
    assert.deepEqual(f.snapshot(), before);
  });
  await t.test("first save persists the normalized recipient only for its merchant and exposes the specified fields", async () => {
    const f = fixture(), foreign = structuredClone(f.rows.get("merchant-b"));
    const result = await f.within("merchant-a", () => f.useCase.save("merchant-a", { fallbackPhone: "+1 (212) 555-0183" }));
    assert.deepEqual(Object.keys(result).sort(), ["channel", "fallbackPhone", "updatedAt", "version"]);
    assert.equal(result.channel, "whatsapp");assert.equal(result.fallbackPhone, phone);assert.equal(result.version, 1);
    assert.equal(result.updatedAt, f.rows.get("merchant-a")?.updatedAt.toISOString());
    assert.equal(f.rows.get("merchant-a")?.fallbackWhatsapp, phone);
    assert.deepEqual(await f.within("merchant-a", () => f.useCase.get("merchant-a")), result);
    assert.deepEqual(f.rows.get("merchant-b"), foreign);
  });
  await t.test("an identically normalized save preserves the stored version and timestamp", async () => {
    const f = fixture();
    const first = await f.within("merchant-a", () => f.useCase.save("merchant-a", { fallbackPhone: phone }));
    const before = f.snapshot();
    const next = await f.within("merchant-a", () => f.useCase.save("merchant-a", { fallbackPhone: "+1 212 555 0183" }));
    assert.deepEqual(next, first);assert.deepEqual(f.snapshot(), before);
  });
  await t.test("a different non-null recipient increments once and an equivalent replacement remains a no-op", async () => {
    const f = fixture(), foreign = structuredClone(f.rows.get("merchant-b"));
    const first = await f.within("merchant-a", () => f.useCase.save("merchant-a", { fallbackPhone: phone }));
    const replacement = await f.within("merchant-a", () => f.useCase.save("merchant-a", { fallbackPhone: "+1 (212) 555-0184" }));
    assert.equal(replacement.channel, "whatsapp");
    assert.equal(replacement.fallbackPhone, "+12125550184");
    assert.equal(replacement.version, first.version + 1);
    assert.notEqual(replacement.updatedAt, first.updatedAt);
    assert.equal(f.rows.get("merchant-a")?.fallbackWhatsapp, "+12125550184");
    assert.equal(f.rows.get("merchant-a")?.version, first.version + 1);
    assert.equal(replacement.updatedAt, f.rows.get("merchant-a")?.updatedAt.toISOString());
    assert.deepEqual(await f.within("merchant-a", () => f.useCase.get("merchant-a")), replacement);
    const before = f.snapshot();
    const equivalent = await f.within("merchant-a", () => f.useCase.save("merchant-a", { fallbackPhone: "+1 212 555 0184" }));
    assert.deepEqual(equivalent, replacement);
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.rows.get("merchant-b"), foreign);
  });
  await t.test("explicit clear persists null and increments once while a repeated clear remains a no-op", async () => {
    const f = fixture();
    await f.within("merchant-a", () => f.useCase.save("merchant-a", { fallbackPhone: phone }));
    const cleared = await f.within("merchant-a", () => f.useCase.save("merchant-a", { fallbackPhone: null }));
    assert.equal(cleared.fallbackPhone, null);assert.equal(cleared.version, 2);
    assert.equal(f.rows.get("merchant-a")?.fallbackWhatsapp, null);assert.equal(f.rows.get("merchant-a")?.version, 2);
    const before = f.snapshot();
    assert.deepEqual(await f.within("merchant-a", () => f.useCase.save("merchant-a", { fallbackPhone: null })), cleared);
    assert.deepEqual(f.snapshot(), before);
  });
  await t.test("invalid and forged recipient bodies cannot change persistence", async () => {
    const f = fixture(), before = f.snapshot();
    await f.within("merchant-a", async () => {
      for (const body of [{}, { fallbackPhone: "private@example.test" }, { fallbackPhone: phone, merchantId: "merchant-b" }]) {
        await assert.rejects(f.useCase.save("merchant-a", body), error => {
          assert.equal((error as { getStatus(): number }).getStatus(), 400);
          assert.equal((error as Error).message, "support_notification_settings_invalid");
          return true;
        });
      }
    });
    assert.equal(f.calls(), 0);assert.deepEqual(f.snapshot(), before);
  });
  await t.test("a removed merchant cannot create a recipient record", async () => {
    const f = fixture();f.merchants.delete("merchant-a");const before = f.snapshot();
    await assert.rejects(f.within("merchant-a", () => f.useCase.save("merchant-a", { fallbackPhone: phone })), error => {
      assert.equal((error as { getStatus(): number }).getStatus(), 404);
      assert.equal((error as Error).message, "support_notification_merchant_not_found");return true;
    });
    assert.deepEqual(f.snapshot(), before);
  });
  await t.test("persistence failure propagates without a successful result or stored recipient", async () => {
    const f = fixture(), before = f.snapshot(), failure = new Error("synthetic_private_store_unavailable");
    f.fail(failure);
    await assert.rejects(f.within("merchant-a", () => f.useCase.save("merchant-a", { fallbackPhone: phone })), error => error === failure);
    assert.deepEqual(f.snapshot(), before);
  });
});
