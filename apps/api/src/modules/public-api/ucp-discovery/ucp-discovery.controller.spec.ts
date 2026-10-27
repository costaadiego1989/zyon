import test from "node:test";
import assert from "node:assert/strict";
import { UcpDiscoveryController } from "./ucp-discovery.controller.js";
import { InMemoryMerchantRepository } from "../../merchant/infrastructure/in-memory-merchant.repository.js";

function makeRepo() {
  const repo = new InMemoryMerchantRepository();
  repo.seedProfile({
    id: "mrc_loja_teste",
    name: "Casa Decoração",
    storeSettings: { slug: "loja-teste", company: { email: "suporte@lojateste.com.br" }, styles: { logoUrl: "https://cdn.example.com/loja/logo.png" } },
  });
  repo.seedProfile({
    id: "mrc_casa_decorao",
    name: "Casa Decoração Premium",
    storeSettings: { slug: "casa-decorao" },
  });
  repo.seedCustomDomain("cliente.com.br", "mrc_cliente");
  repo.seedProfile({
    id: "mrc_cliente",
    name: "Loja do Cliente",
    storeSettings: { slug: "cliente" },
  });
  return repo;
}

function makeReq(host: string) {
  return { headers: { host } } as any;
}

test("UcpDiscoveryController returns /.well-known/ucp discovery metadata", async () => {
  const controller = new UcpDiscoveryController(makeRepo());
  const result = await controller.discovery(makeReq("api.zyon-payments.com.br"));

  assert.equal(result.version, "1.0");
  assert.equal(result.name, "AACP");
  assert.equal(result.merchant_id, "platform-default");
  assert.deepEqual(result.capabilities, ["checkout", "product_discovery", "payment"]);
  assert.deepEqual(result.supported_protocols, ["acp", "ucp", "ap2"]);
  assert.equal(result.checkout_sessions_endpoint, "/v1/acp/checkout_sessions");
  assert.equal(result.feed_endpoint, "/v1/acp/products/feed");
  assert.equal(result.webhook_endpoint, "/v1/acp/webhooks");
  assert(result.created_at);
  assert(new Date(result.created_at).getTime() > 0);
});

test("UcpDiscoveryController response has all required fields", async () => {
  const controller = new UcpDiscoveryController(makeRepo());
  const result = await controller.discovery(makeReq("api.zyon-payments.com.br"));

  const requiredFields = [
    "version",
    "name",
    "merchant_id",
    "merchant_name",
    "merchant_url",
    "robots_txt_url",
    "capabilities",
    "supported_protocols",
    "checkout_sessions_endpoint",
    "feed_endpoint",
    "webhook_endpoint",
    "created_at",
  ];

  for (const field of requiredFields) {
    assert(field in result, `Missing required field: ${field}`);
    assert(
      result[field as keyof typeof result] !== undefined,
      `Field ${field} is undefined`
    );
    assert(
      result[field as keyof typeof result] !== null,
      `Field ${field} is null`
    );
  }
});

test("UcpDiscoveryController returns valid ISO 8601 timestamp", async () => {
  const controller = new UcpDiscoveryController(makeRepo());
  const result = await controller.discovery(makeReq("api.zyon-payments.com.br"));

  const timestamp = new Date(result.created_at);
  assert(!isNaN(timestamp.getTime()), `created_at is not a valid ISO 8601 timestamp: ${result.created_at}`);
  assert(timestamp.getTime() > 0);
});

test("UcpDiscoveryController resolves merchant by subdomain slug", async () => {
  const controller = new UcpDiscoveryController(makeRepo());
  const result = await controller.discovery(makeReq("loja-teste.zyon-payments.com.br"));

  assert.equal(result.merchant_id, "mrc_loja_teste");
  assert.equal(result.merchant_name, "Casa Decoração");
  assert.equal(result.merchant_url, "https://loja-teste.zyon-payments.com.br");
  assert.equal(result.robots_txt_url, "/robots.txt");
  assert.equal(result.support_email, "suporte@lojateste.com.br");
  assert.equal(result.logo_url, "https://cdn.example.com/loja/logo.png");
});

test("UcpDiscoveryController falls back to platform default when host is unknown", async () => {
  const controller = new UcpDiscoveryController(makeRepo());
  const result = await controller.discovery(makeReq("unknown.example.com"));

  assert.equal(result.merchant_id, "platform-default");
  assert.equal(result.merchant_name, "AACP");
});

test("UcpDiscoveryController resolves merchant by custom domain", async () => {
  const controller = new UcpDiscoveryController(makeRepo());
  const result = await controller.discovery(makeReq("cliente.com.br"));

  assert.equal(result.merchant_id, "mrc_cliente");
  assert.equal(result.merchant_name, "Loja do Cliente");
  assert.equal(result.merchant_url, "https://cliente.com.br");
});

test("UcpDiscoveryController resolves platform host (api.<store-domain>) to default", async () => {
  const controller = new UcpDiscoveryController(makeRepo());
  const result = await controller.discovery(makeReq("api.zyon-payments.com.br"));

  assert.equal(result.merchant_id, "platform-default");
});

test("UcpDiscoveryController resolves platform host when host header is missing", async () => {
  const controller = new UcpDiscoveryController(makeRepo());
  const result = await controller.discovery({ headers: {} } as any);

  assert.equal(result.merchant_id, "platform-default");
  assert.equal(result.merchant_name, "AACP");
});

test("UcpDiscoveryController resolves slug host with multi-level subdomain label correctly", async () => {
  const controller = new UcpDiscoveryController(makeRepo());
  // host has 3+ labels before base — `casa-decorao` should NOT match the
  // `casa-decorao` slug (slug comes BEFORE base domain).
  const result = await controller.discovery(makeReq("loja-test.casa-decorao.zyon-payments.com.br"));

  // Not a clean subdomain of the base → falls back to platform.
  assert.equal(result.merchant_id, "platform-default");
});

test("UcpDiscoveryController host port suffix is stripped before resolution", async () => {
  const controller = new UcpDiscoveryController(makeRepo());
  const result = await controller.discovery(makeReq("loja-teste.zyon-payments.com.br:3009"));

  assert.equal(result.merchant_id, "mrc_loja_teste");
  assert.equal(result.merchant_name, "Casa Decoração");
});
