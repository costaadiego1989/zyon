import assert from "node:assert/strict";
import test from "node:test";
import { BadGatewayException } from "@nestjs/common";
import { HttpClientService } from "../../../shared/http/http-client.service.js";
import { InMemoryCommerceConnectionRepository } from "../infrastructure/in-memory-commerce-connection.repository.js";
import { TenantCommerceAdapterFactory } from "../infrastructure/tenant-commerce-adapter.factory.js";
import {
  ConnectCommerceUseCase,
  DisconnectCommerceUseCase,
  GetCommerceConnectionUseCase,
} from "./manage-commerce-connection.use-cases.js";

test("commerce connection use cases persist, test and disconnect WooCommerce without exposing secrets", async () => {
  const repository = new InMemoryCommerceConnectionRepository();
  const http = new HttpClientService({
    fetchFn: async () =>
      Response.json({
        environment: { site_title: "AACP Store" },
        settings: { currency: "BRL", store_name: "AACP Store" },
      }),
  });
  const adapters = new TenantCommerceAdapterFactory(repository, http);
  const connect = new ConnectCommerceUseCase(repository, adapters);
  const get = new GetCommerceConnectionUseCase(repository);
  const disconnect = new DisconnectCommerceUseCase(repository);

  const connection = await connect.execute({
    merchantId: "mrc_1",
    provider: "woocommerce",
    storeUrl: "https://shop.example.com",
    consumerKey: "ck_abcdef1234567890abcdef1234567890",
    consumerSecret: "cs_abcdef1234567890abcdef1234567890",
  });

  assert.equal(connection.status, "healthy");
  assert.equal(connection.provider, "woocommerce");
  assert.equal("consumerKey" in connection, false);
  assert.equal("consumerSecret" in connection, false);
  assert.ok((await repository.getCredentials("mrc_1")) !== undefined);

  await disconnect.execute("mrc_1");
  assert.equal(await get.execute("mrc_1"), undefined);
});

test("failed provider validation keeps a degraded connection without leaking WooCommerce credentials", async () => {
  const repository = new InMemoryCommerceConnectionRepository();
  const http = new HttpClientService({
    fetchFn: async () => new Response(null, { status: 401 }),
  });
  const adapters = new TenantCommerceAdapterFactory(repository, http);
  const connect = new ConnectCommerceUseCase(repository, adapters);
  const get = new GetCommerceConnectionUseCase(repository);

  await assert.rejects(
    connect.execute({
      merchantId: "mrc_2",
      provider: "woocommerce",
      storeUrl: "https://shop.example.com",
      consumerKey: "ck_private_value",
      consumerSecret: "cs_private_value",
    }),
    (error: unknown) =>
      error instanceof BadGatewayException &&
      (error.getResponse() as { code?: string }).code ===
        "commerce_connection_failed",
  );

  const connection = await get.execute("mrc_2");
  assert.equal(connection?.provider, "woocommerce");
  assert.equal(connection?.status, "degraded");
  assert.equal("consumerKey" in (connection ?? {}), false);
  assert.equal("consumerSecret" in (connection ?? {}), false);
});

test("WooCommerce connection rejects local and IP-literal targets", async () => {
  const repository = new InMemoryCommerceConnectionRepository();
  const adapters = new TenantCommerceAdapterFactory(
    repository,
    new HttpClientService({
      fetchFn: async () => Response.json({}),
    }),
  );
  const connect = new ConnectCommerceUseCase(repository, adapters);

  await assert.rejects(
    connect.execute({
      merchantId: "mrc_3",
      provider: "woocommerce",
      storeUrl: "https://127.0.0.1",
      consumerKey: "ck_private_value",
      consumerSecret: "cs_private_value",
    }),
    /invalid_woocommerce_connection/,
  );
});
