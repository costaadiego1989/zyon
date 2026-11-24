import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { NestFactory } from "@nestjs/core";
import { MODULE_METADATA } from "@nestjs/common/constants.js";
import { ServiceActivationModule, SERVICE_RELEASE_ARTIFACT_SOURCE } from "./service-activation.module.js";
import { ImmutableServiceReleaseArtifact, composeServiceReleaseArtifactSource, currentServiceReleaseArtifact } from "./service-release-artifact.js";
import { ownedServiceReleaseFixtureData, syntheticServiceReleaseRuntime } from "../../../tests/service-release-fixture-data.js";

test("T94 actual module lifetime", async t => {
  const fixture = ownedServiceReleaseFixtureData(syntheticServiceReleaseRuntime());
  const original = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ServiceActivationModule) as any[];
  const matched = original.filter(provider => provider?.provide === SERVICE_RELEASE_ARTIFACT_SOURCE); assert.equal(matched.length, 1);
  const replaced = original.map(provider => provider === matched[0] ? { provide: SERVICE_RELEASE_ARTIFACT_SOURCE, useValue: fixture.source } : provider);
  Reflect.defineMetadata(MODULE_METADATA.PROVIDERS, replaced, ServiceActivationModule);
  const boot = () => NestFactory.createApplicationContext(ServiceActivationModule, { logger: false, abortOnError: false });
  try {
    await t.test("boot/close/boot constructs new immutable snapshots and closes the old instance", async () => {
      const first = await boot(), firstReader = first.get(ImmutableServiceReleaseArtifact);
      try { assert.equal(firstReader.read().kind, "verified"); assert.equal(currentServiceReleaseArtifact(), firstReader); }
      finally { await first.close(); }
      assert.equal(firstReader.read().kind, "unavailable");
      const second = await boot(), secondReader = second.get(ImmutableServiceReleaseArtifact);
      try { assert.notEqual(secondReader, firstReader); assert.equal(secondReader.read().kind, "verified"); assert.equal(currentServiceReleaseArtifact(), secondReader); }
      finally { await second.close(); }
    });
    await t.test("old or unbound lifecycle cleanup cannot remove the current application's authority", async () => {
      const first = await boot(), old = first.get(ImmutableServiceReleaseArtifact); await first.close();
      const second = await boot(), current = second.get(ImmutableServiceReleaseArtifact);
      try {
        old.onModuleDestroy(); new ImmutableServiceReleaseArtifact(fixture.source).onModuleDestroy();
        assert.equal(currentServiceReleaseArtifact(), current); assert.equal(current.read().kind, "verified");
      } finally { await second.close(); }
    });
    await t.test("an active application cannot be rebound to another datasource", async () => {
      const app = await boot(), current = app.get(ImmutableServiceReleaseArtifact);
      try { assert.throws(() => composeServiceReleaseArtifactSource(Object.freeze({ readManifest: () => undefined, measureRuntime: syntheticServiceReleaseRuntime })), /already_composed/);
        assert.equal(currentServiceReleaseArtifact(), current); assert.equal(current.read().kind, "verified"); }
      finally { await app.close(); }
    });
  } finally { assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ServiceActivationModule), replaced);
    Reflect.defineMetadata(MODULE_METADATA.PROVIDERS, original, ServiceActivationModule); }
});
