import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { configureApiDocumentation } from "./api-documentation.js";

test("configured documentation origins are used by HTTP contracts and Scalar CSP without widening private access", async t => {
  const previous = { sandbox: process.env.AACP_SANDBOX_API_URL, production: process.env.AACP_PRODUCTION_API_URL };
  process.env.AACP_SANDBOX_API_URL = "https://sandbox.docs.example/v1/";
  process.env.AACP_PRODUCTION_API_URL = "https://production.docs.example/v1/";
  t.after(() => {
    for (const [key, value] of [["AACP_SANDBOX_API_URL", previous.sandbox], ["AACP_PRODUCTION_API_URL", previous.production]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  });
  class Products { read() { return []; } }
  Controller("products")(Products); Get()(Products.prototype, "read", Object.getOwnPropertyDescriptor(Products.prototype, "read")!);
  class Internal { read() { return {}; } }
  Controller("internal/release-state")(Internal); Get()(Internal.prototype, "read", Object.getOwnPropertyDescriptor(Internal.prototype, "read")!);
  class Fixture {}
  Module({ controllers: [Products, Internal] })(Fixture);
  const app = await NestFactory.create(Fixture, { logger: false }); t.after(async () => { await app.close(); });
  configureApiDocumentation(app); await app.listen(0, "127.0.0.1"); const base = await app.getUrl();
  const docs = await fetch(base + "/docs"); assert.equal(docs.status, 200); assert.equal(docs.headers.get("cache-control"), "no-store");
  const directives = docs.headers.get("content-security-policy")!.split("; ");
  assert.equal(directives.find(x => x.startsWith("connect-src ")), "connect-src 'self' https://sandbox.docs.example https://production.docs.example");
  assert.ok(directives.includes("frame-ancestors 'none'"));
  const specResponse = await fetch(base + "/openapi.json"); assert.equal(specResponse.status, 200); const spec = await specResponse.json();
  assert.deepEqual(spec.servers, [{ url: "https://sandbox.docs.example", description: "Sandbox" }, { url: "https://production.docs.example", description: "Production" }]);
  assert.deepEqual(Object.keys(spec.paths), ["/v1/products"]); assert.ok(spec.paths["/v1/products"].get.security.length > 0);
  const collectionResponse = await fetch(base + "/postman.json"); assert.equal(collectionResponse.status, 200); const collection = await collectionResponse.json();
  assert.equal(JSON.stringify(collection).includes("internal/release-state"), false);
  assert.equal(collection.variable.find((variable: { key: string }) => variable.key === "baseUrl")?.value, "https://sandbox.docs.example");
});
