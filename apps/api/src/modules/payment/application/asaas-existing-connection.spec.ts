import assert from "node:assert/strict";
import test from "node:test";
import { toProblemDetails } from "../../../shared/http/problem-details.filter.js";
import { InMemoryPaymentPlatformRepository } from "../infrastructure/in-memory-payment-platform.repository.js";
import { AsaasPlatformAdapter } from "../infrastructure/asaas-platform.adapter.js";
import { SaveAsaasConnectionConfigUseCase } from "./payment-platform/connect/save-asaas-connection-config.use-case.js";
import { GetAsaasOnboardingLinkUseCase } from "./payment-platform/connect/get-asaas-onboarding-link.use-case.js";
import { providerGatewayError } from "./payment-platform/shared.js";
import { CreateAsaasSubaccountUseCase } from "./payment-platform/connect/create-asaas-subaccount.use-case.js";

const liveKey = "$aact_prod_test-only";
const testKey = "$aact_hmlg_test-only";

const automaticInput = {
  name: "Store", email: "owner@example.com", cpfCnpj: "52998224725", birthDate: "1990-01-31",
  mobilePhone: "11999999999", incomeValue: 2500, address: "Rua Teste", addressNumber: "10", province: "Centro", postalCode: "01001000",
};

function automaticFixture(options: { platformMerchant?: string; managed?: boolean; ownerEmail?: string; status?: string; failStatus?: boolean; blockKeys?: boolean } = {}) {
  const repository = new InMemoryPaymentPlatformRepository();
  const calls: string[] = [];
  let failStatus = options.failStatus;
  const adapter = new AsaasPlatformAdapter("https://api.asaas.com", liveKey, (async (url, init) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    if (path.endsWith("commercialInfo")) return Response.json({ cpfCnpj: automaticInput.cpfCnpj });
    if (path.endsWith("accessTokens")) return options.blockKeys
      ? Response.json({ errors: [{ code: "forbidden", description: "Temporarily disabled" }] }, { status: 403 })
      : Response.json({ access_token: "child-secret" });
    if (path === "/v3/accounts" && method === "GET") return Response.json({ data: options.managed ? [{ id: "child-1", cpfCnpj: automaticInput.cpfCnpj, email: options.ownerEmail ?? "owner@example.com" }] : [] });
    if (path === "/v3/accounts" && method === "POST") return Response.json({ id: "child-1", walletId: "wallet-child", apiKey: "child-secret" });
    if (path.includes("wallets")) return Response.json({ data: [{ id: "wallet-child" }] });
    if (path.endsWith("status")) {
      if (failStatus) { failStatus = false; throw new Error("temporary network failure"); }
      const status = options.status ?? "APPROVED";
      return Response.json({ general: status, commercialInfo: status, documentation: status, bankAccountInfo: status });
    }
    throw new Error("Unexpected fixture endpoint");
  }) as typeof fetch, options.platformMerchant);
  const useCase = new CreateAsaasSubaccountUseCase(repository, adapter, { stripe: "live", asaas: "live" });
  return { repository, adapter, calls, useCase };
}

test("automatic recovery finds the managed account, stores its key internally and reuses it on retry", async () => {
  const { useCase, repository, calls } = automaticFixture({ managed: true });
  const first = await useCase.execute("merchant-1", automaticInput, "owner@example.com");
  const second = await useCase.execute("merchant-1", automaticInput, "owner@example.com");
  assert.equal(first.status, "active");
  assert.equal(second.status, "active");
  assert.equal(calls.filter(call => call.endsWith("accessTokens")).length, 1);
  assert.equal(calls.includes("POST /v3/accounts"), false);
  assert.equal(await repository.getConnectionSecret("merchant-1", "asaas"), "child-secret");
  assert.doesNotMatch(JSON.stringify(first), /child-secret|apiKey/);
});

test("a tax ID and form email cannot recover another account without the matching authenticated owner", async () => {
  for (const email of [undefined, "other@example.com"]) {
    const { useCase, repository, calls } = automaticFixture({ managed: true });
    await assert.rejects(() => useCase.execute("merchant-1", automaticInput, email), /asaas_account_owner_mismatch/);
    assert.equal(calls.some(call => call.startsWith("POST")), false);
    assert.equal(await repository.getConnection("merchant-1", "asaas"), undefined);
  }
});

test("only the configured platform merchant can use the root account, with a matching tax ID", async () => {
  const { useCase, repository, adapter, calls } = automaticFixture({ platformMerchant: "platform-store", status: "AWAITING_APPROVAL" });
  assert.equal(await adapter.resolvePlatformAccount("other-store", automaticInput.cpfCnpj), null);
  assert.equal(calls.length, 0);
  await assert.rejects(() => adapter.resolvePlatformAccount("platform-store", "11222333000181"), /identity_mismatch/);
  const saved = await useCase.execute("platform-store", automaticInput, "owner@example.com");
  assert.equal(saved.externalAccountId, "platform");
  assert.equal(saved.status, "pending");
  assert.equal(saved.chargesEnabled, false);
  assert.equal(await repository.getConnectionSecret("platform-store", "asaas"), liveKey);
  assert.equal(calls.some(call => call.startsWith("POST")), false);
  assert.equal(JSON.stringify(saved).includes(liveKey), false);
});

test("recovering an account does not ask for fields needed only to create a new account", async () => {
  const { useCase } = automaticFixture({ managed: true });
  const saved = await useCase.execute("merchant-1", { ...automaticInput, birthDate: undefined }, "owner@example.com");
  assert.equal(saved.status, "active");
});

test("blocked provider key management gives a support action without creating a duplicate", async () => {
  const { useCase, calls, repository } = automaticFixture({ managed: true, blockKeys: true });
  await assert.rejects(() => useCase.execute("merchant-1", automaticInput, "owner@example.com"), /asaas_account_recovery_unavailable/);
  assert.equal(calls.includes("POST /v3/accounts"), false);
  assert.equal(await repository.getConnection("merchant-1", "asaas"), undefined);
});

test("a status outage preserves newly created credentials and the next attempt only synchronizes", async () => {
  const { useCase, repository, calls } = automaticFixture({ failStatus: true });
  const first = await useCase.execute("merchant-1", automaticInput, "owner@example.com");
  assert.equal(first.status, "degraded");
  assert.equal(await repository.getConnectionSecret("merchant-1", "asaas"), "child-secret");
  const second = await useCase.execute("merchant-1", automaticInput, "owner@example.com");
  assert.equal(second.status, "active");
  assert.equal(calls.filter(call => call === "POST /v3/accounts").length, 1);
});

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
