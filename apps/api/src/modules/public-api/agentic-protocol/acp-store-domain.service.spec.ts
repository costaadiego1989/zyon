import test from "node:test";
import assert from "node:assert/strict";
import {
  AcpStoreDomainService,
  buildConfirmationUrl,
  DEFAULT_STORE_DOMAIN,
  resolveStoreDomain,
} from "./acp-store-domain.service.js";

test("store-domain: default when env unset", () => {
  assert.equal(resolveStoreDomain({}), DEFAULT_STORE_DOMAIN);
});

test("store-domain: ignores whitespace-only values", () => {
  assert.equal(resolveStoreDomain({ AACP_STORE_DOMAIN: "   " }), DEFAULT_STORE_DOMAIN);
});

test("store-domain: uses env value when set", () => {
  assert.equal(
    resolveStoreDomain({ AACP_STORE_DOMAIN: "store.example.com" }),
    "store.example.com",
  );
});

test("buildConfirmationUrl: uses slug as subdomain", () => {
  assert.equal(
    buildConfirmationUrl({ id: "mrc_1", slug: "acme" }, "ord_1", "zyon-payments.com.br"),
    "https://acme.zyon-payments.com.br/orders/ord_1",
  );
});

test("buildConfirmationUrl: falls back to merchant id when slug missing", () => {
  assert.equal(
    buildConfirmationUrl({ id: "mrc_1" }, "ord_1", "zyon-payments.com.br"),
    "https://mrc_1.zyon-payments.com.br/orders/ord_1",
  );
});

test("buildConfirmationUrl: encodes order id", () => {
  const url = buildConfirmationUrl({ id: "m" }, "ord/1", "store.com");
  assert.equal(url, "https://m.store.com/orders/ord%2F1");
});

test("AcpStoreDomainService.buildConfirmationUrl reads env at construction", () => {
  const saved = process.env.AACP_STORE_DOMAIN;
  process.env.AACP_STORE_DOMAIN = "x.com";
  try {
    const svc = new AcpStoreDomainService();
    assert.equal(
      svc.buildConfirmationUrl({ id: "m" }, "o"),
      "https://m.x.com/orders/o",
    );
  } finally {
    if (saved === undefined) delete process.env.AACP_STORE_DOMAIN;
    else process.env.AACP_STORE_DOMAIN = saved;
  }
});

test("AcpStoreDomainService falls back to default when env empty", () => {
  const saved = process.env.AACP_STORE_DOMAIN;
  delete process.env.AACP_STORE_DOMAIN;
  try {
    const svc = new AcpStoreDomainService();
    assert.equal(
      svc.buildConfirmationUrl({ id: "m" }, "o"),
      `https://m.${DEFAULT_STORE_DOMAIN}/orders/o`,
    );
  } finally {
    if (saved !== undefined) process.env.AACP_STORE_DOMAIN = saved;
  }
});

test("AcpStoreDomainService.buildConfirmationUrl allows override at call site", () => {
  const svc = new AcpStoreDomainService();
  assert.equal(
    svc.buildConfirmationUrl({ id: "m" }, "o", "override.com"),
    "https://m.override.com/orders/o",
  );
});
