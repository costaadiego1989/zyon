import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { configureApiDocumentation } from "./api-documentation.js";
import { apiVersioningMiddleware } from "./api-versioning.js";

test("production-mode documentation serves public HTTP contracts and excludes internal operations", async t => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  t.after(() => { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; });
  class CatalogFixture { list() { return []; } }
  Controller("catalog")(CatalogFixture);
  Get()(CatalogFixture.prototype, "list", Object.getOwnPropertyDescriptor(CatalogFixture.prototype, "list")!);
  class PrivateFixture { read() { return { private: true }; } }
  Controller("internal/operational-status")(PrivateFixture);
  Get()(PrivateFixture.prototype, "read", Object.getOwnPropertyDescriptor(PrivateFixture.prototype, "read")!);
  class HttpFixture {}
  Module({ controllers: [CatalogFixture, PrivateFixture] })(HttpFixture);
  const app = await NestFactory.create(HttpFixture, { logger: false });
  t.after(async () => { await app.close(); });
  app.use(apiVersioningMiddleware);
  configureApiDocumentation(app);
  await app.listen(0, "127.0.0.1"); const base = await app.getUrl();
  let response = await fetch(base + "/docs");
  assert.equal(response.status, 200); assert.match(await response.text(), /AACP Integration API/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  response = await fetch(base + "/openapi.json"); assert.equal(response.status, 200);
  const openapi = await response.json();
  assert.deepEqual(Object.keys(openapi.paths), ["/v1/catalog"]);
  assert.deepEqual(openapi.paths["/v1/catalog"].get.security, [{ console_session: [] }, { service_api_key: [] }, { legacy_api_key: [] }]);
  assert.equal(JSON.stringify(openapi).includes("internal/operational-status"), false);
  response = await fetch(base + "/postman.json"); assert.equal(response.status, 200);
  const postman = await response.json(); assert.ok(postman.item.length > 0);
  assert.equal(JSON.stringify(postman).includes("internal/operational-status"), false);
  response = await fetch(base + "/v1/catalog"); assert.equal(response.status, 200);
  assert.equal(response.headers.get("AACP-API-Version"), "v1");
});
