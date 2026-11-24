import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import * as artifact from "../src/shared/bookings/service-release-artifact.js";
import * as protocol from "../src/shared/bookings/service-release-manifest.js";
import {assertServiceArtifacts} from "./service-test-artifacts.mjs";
import {createOwnedServiceReleaseFixture} from "./service-release-owned-fixture.mjs";

/** Explicit private test precondition for writers importing the SAME src module.
 * SQL readiness still checks the actual owned migration ledger. */
export function composeOwnedSourceServiceRelease(variant: "matching" | "missing") {
  assert.ok(variant === "matching" || variant === "missing", "service_release_process_variant_invalid");
  assertServiceArtifacts();
  const runtime = artifact.measureServiceReleaseRuntime(fileURLToPath(new URL("../", import.meta.url)), "e".repeat(40));
  return createOwnedServiceReleaseFixture({runtime, protocol, variant, onEvidence: () => {}}).composeProcess(artifact);
}
