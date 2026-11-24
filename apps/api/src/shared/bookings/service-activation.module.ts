import { Global, Module } from "@nestjs/common";
import { composeServiceReleaseArtifactSource, filesystemServiceReleaseSource, ImmutableServiceReleaseArtifact, type ServiceReleaseArtifactSource } from "./service-release-artifact.js";

/** Internal DI only. An owned test may replace this datasource with immutable
 * fixture bytes plus measured runtime facts; it never replaces the verifier. */
export const SERVICE_RELEASE_ARTIFACT_SOURCE = Symbol("SERVICE_RELEASE_ARTIFACT_SOURCE");
@Global()
@Module({ providers: [
  { provide: SERVICE_RELEASE_ARTIFACT_SOURCE, useFactory: () => filesystemServiceReleaseSource() },
  { provide: ImmutableServiceReleaseArtifact, useFactory: (source: ServiceReleaseArtifactSource) => composeServiceReleaseArtifactSource(source), inject: [SERVICE_RELEASE_ARTIFACT_SOURCE] },
], exports: [ImmutableServiceReleaseArtifact] })
export class ServiceActivationModule {}
