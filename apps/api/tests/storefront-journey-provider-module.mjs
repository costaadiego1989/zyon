import assert from "node:assert/strict";
import "reflect-metadata";
import { readJourneyCapability, revalidateJourneyCapability } from "./storefront-journey-guards.mjs";
import { journeyArtifactModuleUrl } from "./storefront-journey-canonical-bindings.mjs";
import { assertJourneyTransportCapability } from "./storefront-journey-transport.mjs";

/** Test root only. Global visibility provides the ONE approved optional fetch
 * token to the original StorefrontModule; auth/repos remain real and unchanged.
 * Laziness breaks bootstrap->HTTP conversation->capability->transport ordering:
 * until actual preflight succeeds every provider request fails closed. */
export async function createJourneyProviderModule(artifactTree) {
  const [{ Global, Module }, { STOREFRONT_PROVIDER_FETCH_FACTORY: token }] = await Promise.all([
    import("@nestjs/common"), import(journeyArtifactModuleUrl(artifactTree, "modules/storefront/infrastructure/adapters/storefront-conversation.adapter")),
  ]);
  let installed, attempted = false;
  const fetchFactory = channel => {
    assert.ok(channel === "primary" || channel === "fallback", "journey_provider_channel_invalid");
    return async (...args) => {
      assert.ok(installed, "journey_verified_transport_not_installed");
      return installed.transport.fetchFactory(channel)(...args);
    };
  };
  class JourneyProviderModule {}
  Global()(JourneyProviderModule);
  Module({ providers: [{ provide: token, useValue: fetchFactory }], exports: [token] })(JourneyProviderModule);
  return Object.freeze({ module: JourneyProviderModule,
    async bindVerifiedTransport({ capability, transport }) {
      assert.equal(attempted, false, "journey_transport_binding_is_single_use");
      attempted = true;
      readJourneyCapability(capability); await revalidateJourneyCapability(capability);
      assert.ok(transport && typeof transport.fetchFactory === "function" && typeof transport.runOperation === "function", "journey_controlled_transport_required");
      assertJourneyTransportCapability(transport, capability);
      installed = Object.freeze({ capability, transport });
    } });
}
