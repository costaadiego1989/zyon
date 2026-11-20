import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createHash } from "node:crypto";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { FiscalRuntimeConfiguration } from "./fiscal-runtime-configuration.js";
import { FiscalCredentialCipher } from "./fiscal-credential-cipher.js";
import { FiscalSetupService } from "../application/fiscal-setup.service.js";
import type { FiscalScope } from "../domain/fiscal-provider.js";
let f: Awaited<ReturnType<typeof createFiscalFixture>>;
before(async () => {
  f = await createFiscalFixture();
});
after(async () => {
  await f?.close();
});
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
async function original(provider: "omie" | "tiny", fetcher: typeof fetch) {
  const sale = await seedFiscalSale(f, { provider });
  const scope: FiscalScope = {
    merchantId: sale.merchantId,
    connectionId: sale.connection.id,
    provider,
    environment: sale.environment,
    issuerTaxId: sale.connection.issuerTaxId,
  };
  const env = {
    AACP_PII_ENC_KEY: "synthetic-runtime-continuity-key",
    FISCAL_CREDENTIAL_GRANTS: JSON.stringify([
      {
        scope,
        credentialHash: hash("original-access"),
        clientFingerprint: hash("original-app"),
        scopeIds: [],
        permissions: ["fiscal_read", "fiscal_write"],
        reference: "authenticated_grant:synthetic_original_account",
      },
    ]),
  };
  const cipher = new FiscalCredentialCipher(env);
  const secret = {
    contract: provider === "omie" ? "omie_app_v1" : "olist_oauth_v3",
    environment: scope.environment,
    issuerTaxId: scope.issuerTaxId,
    token: "original-access",
    refreshToken: "original-refresh",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    appHash: "original-app",
    clientId: "original-app",
    clientSecret: "synthetic-client-secret",
  };
  const save = async (value: object) =>
    f.prisma.fiscalConnection.update({
      where: { id: scope.connectionId },
      data: { credentialCipher: cipher.encrypt(JSON.stringify(value)) },
    });
  await save(secret);
  const runtime = new FiscalRuntimeConfiguration(
    f.prisma,
    cipher,
    new FiscalSetupService(f.prisma, cipher),
    env,
    fetcher
  );
  const read = async () =>
    JSON.parse(
      cipher.decrypt(
        (
          await f.prisma.fiscalConnection.findUniqueOrThrow({
            where: { id: scope.connectionId },
          })
        ).credentialCipher!
      )
    );
  return { scope, env, secret, save, read, runtime };
}
for (const provider of ["omie", "tiny"] as const)
  test(`FISCAL-18 actual ${provider} authenticated refresh retains original grant with unchanged protected environment`, async () => {
    let calls = 0;
    const a = await original(provider, (async (_url, init) => {
      calls++;
      assert.equal(init?.method, "POST");
      return Response.json(
        provider === "omie"
          ? { token: "rotated-" + calls, refresh_token: "refresh-" + calls }
          : {
              access_token: "rotated-" + calls,
              refresh_token: "refresh-" + calls,
              expires_in: 3600,
            }
      );
    }) as typeof fetch);
    const frozen = JSON.stringify(a.env);
    assert.deepEqual(
      (await a.runtime.credentials.authorization(a.scope))?.permissions,
      ["fiscal_read", "fiscal_write"]
    );
    for (let i = 0; i < 2; i++) {
      await a.save({
        ...(await a.read()),
        expiresAt: new Date(0).toISOString(),
      });
      assert.deepEqual(
        (await a.runtime.credentials.authorization(a.scope))?.permissions,
        ["fiscal_read", "fiscal_write"]
      );
    }
    assert.equal(calls, 2);
    assert.equal(JSON.stringify(a.env), frozen);
    const rotated = await a.read();
    assert.equal(
      rotated.grantContinuity.initialCredentialHash,
      hash("original-access")
    );
    await a.save({ ...rotated, token: "manually-replaced" });
    assert.equal(await a.runtime.credentials.authorization(a.scope), null);
    await assert.rejects(
      a.runtime.credentials.authorization({
        ...a.scope,
        issuerTaxId: "99999999000199",
      }),
      /scope_or_connection/
    );
  });
test("FISCAL-18 transient 503 refresh preserves original pair and grant, bounded retry is not revocation", async () => {
  let calls = 0;
  const a = await original("omie", (async () => {
    calls++;
    return Response.json(
      { error: "temporarily_unavailable" },
      { status: 503, headers: { "retry-after": "1" } }
    );
  }) as typeof fetch);
  await a.save({ ...a.secret, expiresAt: new Date(0).toISOString() });
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      a.runtime.credentials.credential(a.scope),
      /temporarily_unavailable/
    );
  const stored = await a.read();
  assert.equal(calls, 1);
  assert.equal(stored.revoked, undefined);
  assert.equal(stored.refreshUnknown, undefined);
  assert.equal(stored.token, "original-access");
  assert.equal(stored.refreshToken, "original-refresh");
});
test("FISCAL-18 uncertain rotating refresh persists unknown and never blindly reposts original pair", async () => {
  let calls = 0;
  const a = await original("tiny", (async () => {
    calls++;
    throw new Error("network timeout with private payload");
  }) as typeof fetch);
  await a.save({ ...a.secret, expiresAt: new Date(0).toISOString() });
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      a.runtime.credentials.credential(a.scope),
      /refresh_unknown_reauthorization_required/
    );
  assert.equal(calls, 1);
  const stored = await a.read();
  assert.equal(stored.refreshUnknown, true);
  assert.equal(stored.revoked, undefined);
});
test("FISCAL-18 confirmed invalid_grant persists revoked without leaking provider body", async () => {
  const a = await original("omie", (async () =>
    Response.json(
      { error: "invalid_grant", secret: "private-provider-error" },
      { status: 401 }
    )) as typeof fetch);
  await a.save({ ...a.secret, expiresAt: new Date(0).toISOString() });
  await assert.rejects(
    a.runtime.credentials.credential(a.scope),
    (e) =>
      String(e).includes("reauthorization_required") &&
      !String(e).includes("private-provider-error")
  );
  assert.equal((await a.read()).revoked, true);
});
