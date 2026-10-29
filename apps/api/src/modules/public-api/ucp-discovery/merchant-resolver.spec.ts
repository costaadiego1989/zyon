import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryMerchantRepository } from "../../merchant/infrastructure/in-memory-merchant.repository.js";
import {
  extractSlugFromHost,
  readResolverConfig,
  resolveMerchantFromHost,
} from "./merchant-resolver.js";

const BASE = ["zyon-payments.com.br", "sualoja.com.br"];
const PLATFORM = ["api.zyon-payments.com.br"];

// ─── extractSlugFromHost ────────────────────────────────────────────────────

test("extractSlugFromHost returns slug for matching subdomain", () => {
  assert.equal(
    extractSlugFromHost("loja.zyon-payments.com.br", ["zyon-payments.com.br"]),
    "loja",
  );
});

test("extractSlugFromHost returns null for platform host", () => {
  assert.equal(
    extractSlugFromHost("api.zyon-payments.com.br", ["zyon-payments.com.br"]),
    null,
  );
});

test("extractSlugFromHost returns null for bare base domain", () => {
  assert.equal(
    extractSlugFromHost("zyon-payments.com.br", ["zyon-payments.com.br"]),
    null,
  );
});

test("extractSlugFromHost handles multi-level subdomain label", () => {
  assert.equal(
    extractSlugFromHost("loja-a.loja-b.com.br", ["loja-b.com.br"]),
    "loja-a",
  );
});

test("extractSlugFromHost returns null for deep subdomains", () => {
  // slug itself contains a dot → ambiguous, return null
  assert.equal(
    extractSlugFromHost("loja.a.zyon-payments.com.br", ["zyon-payments.com.br"]),
    null,
  );
});

test("extractSlugFromHost returns null for IPv4 host", () => {
  assert.equal(
    extractSlugFromHost("192.168.0.1", ["zyon-payments.com.br"]),
    null,
  );
});

test("extractSlugFromHost returns null for localhost", () => {
  assert.equal(
    extractSlugFromHost("localhost", ["zyon-payments.com.br"]),
    null,
  );
});

test("extractSlugFromHost strips port suffix", () => {
  assert.equal(
    extractSlugFromHost("loja.zyon-payments.com.br:3009", ["zyon-payments.com.br"]),
    "loja",
  );
});

test("extractSlugFromHost returns null for empty/null input", () => {
  assert.equal(extractSlugFromHost(null, BASE), null);
  assert.equal(extractSlugFromHost("", BASE), null);
  assert.equal(extractSlugFromHost(undefined, BASE), null);
});

test("extractSlugFromHost is case-insensitive", () => {
  assert.equal(
    extractSlugFromHost("Loja.Zyon-Payments.com.br", ["zyon-payments.com.br"]),
    "loja",
  );
});

test("extractSlugFromHost matches any base domain in the list", () => {
  assert.equal(
    extractSlugFromHost("loja.sualoja.com.br", ["zyon-payments.com.br", "sualoja.com.br"]),
    "loja",
  );
});

test("extractSlugFromHost returns null when host doesn't end with any base", () => {
  assert.equal(
    extractSlugFromHost("loja.example.org", ["zyon-payments.com.br"]),
    null,
  );
});

// ─── readResolverConfig ────────────────────────────────────────────────────

test("readResolverConfig builds base set from env + storeDomain", () => {
  const cfg = readResolverConfig({
    AACP_STORE_DOMAIN: "zyon-payments.com.br",
    AACP_API_BASE_DOMAINS: "sualoja.com.br, parceiro.com",
  });
  assert(cfg.baseDomains.includes("zyon-payments.com.br"));
  assert(cfg.baseDomains.includes("sualoja.com.br"));
  assert(cfg.baseDomains.includes("parceiro.com"));
});

test("readResolverConfig adds api.<storeDomain> to platformHosts by default", () => {
  const cfg = readResolverConfig({ AACP_STORE_DOMAIN: "zyon-payments.com.br" });
  assert(cfg.platformHosts.includes("api.zyon-payments.com.br"));
});

test("readResolverConfig respects explicit AACP_PLATFORM_HOSTS", () => {
  const cfg = readResolverConfig({
    AACP_STORE_DOMAIN: "zyon-payments.com.br",
    AACP_PLATFORM_HOSTS: "platform.example.org",
  });
  assert(cfg.platformHosts.includes("platform.example.org"));
  assert(cfg.platformHosts.includes("api.zyon-payments.com.br"));
});

// ─── resolveMerchantFromHost ───────────────────────────────────────────────

test("resolveMerchantFromHost returns platform default when host is null", async () => {
  const repo = new InMemoryMerchantRepository();
  const result = await resolveMerchantFromHost(null, repo, { baseDomains: BASE, platformHosts: PLATFORM });
  assert.equal(result.kind, "platform");
  assert.equal(result.merchantId, "platform-default");
});

test("resolveMerchantFromHost returns platform default when host is platform host", async () => {
  const repo = new InMemoryMerchantRepository();
  const result = await resolveMerchantFromHost(
    "api.zyon-payments.com.br",
    repo,
    { baseDomains: BASE, platformHosts: PLATFORM },
  );
  assert.equal(result.kind, "platform");
});

test("resolveMerchantFromHost resolves slug → merchant", async () => {
  const repo = new InMemoryMerchantRepository();
  repo.seedProfile({
    id: "mrc_loja",
    name: "Loja do Bairro",
    storeSettings: { slug: "loja-bairro" },
  });
  const result = await resolveMerchantFromHost(
    "loja-bairro.zyon-payments.com.br",
    repo,
    { baseDomains: BASE, platformHosts: PLATFORM },
  );
  assert.equal(result.kind, "merchant");
  if (result.kind === "merchant") {
    assert.equal(result.merchantId, "mrc_loja");
    assert.equal(result.merchantName, "Loja do Bairro");
    assert.equal(result.slug, "loja-bairro");
    assert.equal(result.merchantUrl, "https://loja-bairro.zyon-payments.com.br");
  }
});

test("resolveMerchantFromHost resolves custom domain → merchant", async () => {
  const repo = new InMemoryMerchantRepository();
  repo.seedProfile({
    id: "mrc_cliente",
    name: "Cliente SA",
    storeSettings: { slug: "cliente" },
  });
  repo.seedCustomDomain("cliente.com.br", "mrc_cliente");

  const result = await resolveMerchantFromHost(
    "cliente.com.br",
    repo,
    { baseDomains: BASE, platformHosts: PLATFORM },
  );
  assert.equal(result.kind, "merchant");
  if (result.kind === "merchant") {
    assert.equal(result.merchantId, "mrc_cliente");
    assert.equal(result.merchantName, "Cliente SA");
    assert.equal(result.merchantUrl, "https://cliente.com.br");
  }
});

test("resolveMerchantFromHost returns platform default when slug has no match", async () => {
  const repo = new InMemoryMerchantRepository();
  const result = await resolveMerchantFromHost(
    "fantasma.zyon-payments.com.br",
    repo,
    { baseDomains: BASE, platformHosts: PLATFORM },
  );
  assert.equal(result.kind, "platform");
  assert.equal(result.merchantId, "platform-default");
});

test("resolveMerchantFromHost returns platform default for completely unknown host", async () => {
  const repo = new InMemoryMerchantRepository();
  const result = await resolveMerchantFromHost(
    "nope.example.org",
    repo,
    { baseDomains: BASE, platformHosts: PLATFORM },
  );
  assert.equal(result.kind, "platform");
});

test("resolveMerchantFromHost prefers slug match over custom domain when both could apply", async () => {
  // "loja.zyon-payments.com.br" matches the subdomain pattern first.
  // We only register it under findByCustomDomain to confirm slug takes priority.
  const repo = new InMemoryMerchantRepository();
  repo.seedProfile({
    id: "mrc_via_slug",
    name: "Loja via Slug",
    storeSettings: { slug: "loja" },
  });
  repo.seedCustomDomain("loja.zyon-payments.com.br", "mrc_via_customdomain");

  const result = await resolveMerchantFromHost(
    "loja.zyon-payments.com.br",
    repo,
    { baseDomains: BASE, platformHosts: PLATFORM },
  );
  assert.equal(result.kind, "merchant");
  if (result.kind === "merchant") {
    assert.equal(result.merchantId, "mrc_via_slug");
  }
});

test("resolveMerchantFromHost swallows repo errors and falls back to platform default", async () => {
  const boomRepo = {
    findBySlug: async () => {
      throw new Error("db down");
    },
    findByCustomDomain: async () => {
      throw new Error("db down");
    },
  };
  const result = await resolveMerchantFromHost(
    "loja.zyon-payments.com.br",
    boomRepo,
    { baseDomains: BASE, platformHosts: PLATFORM },
  );
  assert.equal(result.kind, "platform");
});
