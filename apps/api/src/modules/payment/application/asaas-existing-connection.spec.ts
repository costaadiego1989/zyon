import assert from "node:assert/strict";
import test from "node:test";
import { toProblemDetails } from "../../../shared/http/problem-details.filter.js";
import { InMemoryPaymentPlatformRepository } from "../infrastructure/in-memory-payment-platform.repository.js";
import { AsaasPlatformAdapter } from "../infrastructure/asaas-platform.adapter.js";
import { SaveAsaasConnectionConfigUseCase } from "./payment-platform/connect/save-asaas-connection-config.use-case.js";
import { GetAsaasOnboardingLinkUseCase } from "./payment-platform/connect/get-asaas-onboarding-link.use-case.js";
import { providerGatewayError } from "./payment-platform/shared.js";

const liveKey = "$aact_prod_test-only";
const testKey = "$aact_hmlg_test-only";

function fixture(general = "APPROVED") {
  const repository = new InMemoryPaymentPlatformRepository();
  const requests: Array<{ url: string; key: string | null; userAgent: string | null }> = [];
  const adapter = new AsaasPlatformAdapter("https://api-sandbox.asaas.com", testKey, (async (url, init) => {
    const headers = new Headers(init?.headers);
    requests.push({ url: String(url), key: headers.get("access_token"), userAgent: headers.get("user-agent") });
    return Response.json(String(url).includes("/wallets") ? { data: [{ id: "wallet_test" }] } : String(url).includes("/documents") ? { data: [] } : {
      general, commercialInfo: general, documentation: general, bankAccountInfo: general,
    });
  }) as typeof fetch);
  return { repository, adapter, requests, useCase: new SaveAsaasConnectionConfigUseCase(repository, adapter) };
}

test("existing live Asaas account is verified with its key and wallet before activation", async () => {
  const { useCase, repository, requests } = fixture();
  const connection = await useCase.execute("mrc_test", { apiKey: ` ${liveKey} `, sandbox: false });
  assert.equal(connection.status, "active");
  assert.equal(connection.environment, "live");
  assert.equal(connection.walletId, "wallet_test");
  assert.equal(connection.chargesEnabled, true);
  assert.equal(connection.payoutsEnabled, true);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(r => r.url.startsWith("https://api.asaas.com/") && r.key === liveKey && r.userAgent === "Zyon/1.0"));
  assert.equal(JSON.stringify(connection).includes(liveKey), false);
  assert.equal(JSON.parse((await repository.getConnectionSecret("mrc_test", "asaas"))!).apiKey, liveKey);
});

test("an unapproved account is saved as pending, without enabling payments", async () => {
  const { useCase, adapter, repository } = fixture("AWAITING_APPROVAL");
  const connection = await useCase.execute("mrc_pending", { apiKey: liveKey, sandbox: false });
  assert.equal(connection.status, "pending");
  assert.equal(connection.chargesEnabled, false);
  assert.equal(connection.payoutsEnabled, false);
  assert.ok(connection.requirements.includes("documentation:awaiting_approval"));
  // Existing accounts do not need the new-subaccount 15-second wait.
  const onboarding = await new GetAsaasOnboardingLinkUseCase(repository, adapter).execute("mrc_pending");
  assert.equal(onboarding.url, "https://www.asaas.com/login");
});

test("mismatched environments are rejected before any provider request", async () => {
  const { useCase, repository, requests } = fixture();
  await assert.rejects(() => useCase.execute("mrc_test", { apiKey: testKey, sandbox: false }), /asaas_environment_mismatch/);
  assert.equal(requests.length, 0);
  assert.equal(await repository.getConnection("mrc_test", "asaas"), undefined);
});

test("legacy keys use the explicitly selected environment", async () => {
  const { useCase, requests } = fixture();
  await useCase.execute("mrc_test", { apiKey: "legacy-key-fixture", sandbox: false });
  assert.ok(requests.every(r => r.url.startsWith("https://api.asaas.com/")));
  requests.length = 0;
  await useCase.execute("mrc_test", { apiKey: "legacy-key-fixture", sandbox: true });
  assert.ok(requests.every(r => r.url.startsWith("https://api-sandbox.asaas.com/")));
});

test("rejected credentials never overwrite an existing connection or leak the key", async () => {
  const { useCase, repository } = fixture();
  await useCase.execute("mrc_test", { apiKey: liveKey, sandbox: false });
  const rejectedKey = "$aact_prod_invalid-test";
  const adapter = new AsaasPlatformAdapter("https://api.asaas.com", liveKey, (async () => Response.json({
    errors: [{ code: "invalid_access_token", description: `Chave inválida: ${rejectedKey}` }],
  }, { status: 401 })) as typeof fetch);
  await assert.rejects(() => new SaveAsaasConnectionConfigUseCase(repository, adapter).execute("mrc_test", { apiKey: rejectedKey, sandbox: false }), error => {
    const problem = toProblemDetails(error, "test");
    assert.equal(problem.code, "asaas_platform_failed");
    assert.match(problem.detail!, /Chave inválida/);
    assert.equal(JSON.stringify(problem).includes(rejectedKey), false);
    assert.match((error as Error).message, /Chave inválida/);
    return true;
  });
  assert.equal((await repository.getConnection("mrc_test", "asaas"))?.status, "active");
  assert.equal(JSON.parse((await repository.getConnectionSecret("mrc_test", "asaas"))!).apiKey, liveKey);
});

test("missing wallet and provider transport failures cannot create active connections", async () => {
  for (const failure of ["wallet", "network"]) {
    const { useCase, repository, adapter } = fixture();
    if (failure === "wallet") adapter.retrieveWalletId = async () => null;
    else adapter.retrieveAccountStatus = async () => { throw new Error("fetch failed"); };
    await assert.rejects(() => useCase.execute("mrc_test", { apiKey: liveKey, sandbox: false }));
    assert.equal(await repository.getConnection("mrc_test", "asaas"), undefined);
  }
});

test("only structured provider descriptions reach the merchant, never raw HTML or JSON", () => {
  for (const body of ["<html>private upstream debug</html>", '{"debug":"private upstream debug"}']) {
    const problem = toProblemDetails(providerGatewayError("asaas", new Error(`asaas_platform_request_failed_502:${body}`)), "test");
    assert.doesNotMatch(problem.detail!, /private upstream/);
  }
  const problem = toProblemDetails(providerGatewayError("asaas", new Error('asaas_platform_request_failed_400:{"errors":[{"code":"invalid_object","description":"Cadastro já existente."}]}')), "test");
  assert.equal(problem.detail, "asaas: Cadastro já existente. (invalid_object)");
});
