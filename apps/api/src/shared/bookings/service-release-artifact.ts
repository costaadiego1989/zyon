import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { dirname, resolve, relative, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICE_RELEASE_WRITERS, verifyServiceReleaseManifest, type ServiceReleaseRuntimeFacts, type ServiceReleaseResult } from "./service-release-manifest.js";

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const ownApiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const SERVICE_RELEASE_ASSET = "assets/service-activation/release-v1.json";
const sort = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
type FileEntry = { path: string; sha256: string };
function inventory(repoRoot: string, roots: string[], suffixes: string[], required: string[] = []): FileEntry[] {
  const entries = new Map<string, FileEntry>();
  const add = (file: string) => {
    const own = relative(repoRoot, file).split(sep).join("/");
    if (!own || own.startsWith("../") || own === "apps/api/" + SERVICE_RELEASE_ASSET) throw new Error("service_release_payload_path");
    const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("service_release_payload_file");
    entries.set(own, { path: own, sha256: hash(readFileSync(file)) });
  };
  const walk = (directory: string) => {
    const stat = lstatSync(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("service_release_payload_directory");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("service_release_payload_symlink");
      const target = join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && suffixes.some(suffix => entry.name.endsWith(suffix))) {
        if (relative(repoRoot, target).split(sep).join("/") !== "apps/api/" + SERVICE_RELEASE_ASSET) add(target);
      }
    }
  };
  for (const path of roots) walk(resolve(repoRoot, path));
  for (const path of required) add(resolve(repoRoot, path));
  return [...entries.values()].sort((a, b) => sort(a.path, b.path));
}
/** Same deterministic inventory for the producer, server and owned fixtures.
 * An image of a different OS/build is not certified by another payload hash. */
export function measureServiceReleaseRuntime(apiRoot: string, sourceRevision: string): ServiceReleaseRuntimeFacts {
  const repoRoot = resolve(apiRoot, "../.."), apiPackage = JSON.parse(readFileSync(resolve(apiRoot, "package.json"), "utf8"));
  const packages = Object.keys(apiPackage.dependencies ?? {}).filter(name => name.startsWith("@zyon/"))
    .map(name => { if (!/^@zyon\/[a-z0-9-]+$/.test(name)) throw new Error("service_release_package_name"); return "packages/" + name.slice(6); }).sort(sort);
  const config = ["package.json", "pnpm-lock.yaml", "tsconfig.base.json", "apps/api/package.json", "apps/api/tsconfig.json", "apps/api/tsconfig.build.json",
    "apps/api/prisma.config.ts", "apps/api/prisma/schema.prisma", "apps/api/prisma.company-directory.config.ts", "apps/api/prisma/company-directory.prisma"];
  const source = inventory(repoRoot, ["apps/api/src", ...packages.map(path => path + "/src")], [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"],
    [...config, ...packages.map(path => path + "/package.json")]);
  const emitted = inventory(repoRoot, ["apps/api/dist", ...packages.map(path => path + "/dist"), "apps/api/assets"], [".js", ".jsx", ".mjs", ".cjs", ".json", ".gif", ".webp", ".mp4", ".png", ".svg"], config);
  const migrations = inventory(repoRoot, ["apps/api/prisma/deploy-migrations"], ["migration.sql"]);
  if (!source.length || !emitted.some(value => value.path === "apps/api/dist/app.module.js") || !migrations.length) throw new Error("service_release_payload_incomplete");
  const writers = SERVICE_RELEASE_WRITERS.map(writer => {
    const file = emitted.find(value => value.path === writer.emittedPath); if (!file) throw new Error("service_release_writer_missing");
    return { ...writer, emittedSha256: file.sha256 };
  });
  const target = { platform: process.platform, arch: process.arch, nodeVersion: process.version, nodeAbi: process.versions.modules };
  return { sourceRevision, sourceInputSha256: hash(JSON.stringify(source)), apiPayloadSha256: hash(JSON.stringify({ target,
    files: [...emitted, ...migrations].sort((a, b) => sort(a.path, b.path)) })),
    writers, managedSchema: migrations.map(value => ({ migrationId: value.path.split("/").at(-2)!, checksum: value.sha256 })) };
}

/** Datasource is composed inside the server/test process; never deserialized
 * from a route. It supplies bytes and measured identity, not a success boolean. */
export interface ServiceReleaseArtifactSource {
  readManifest(): unknown;
  measureRuntime(): ServiceReleaseRuntimeFacts;
}
export function filesystemServiceReleaseSource(apiRoot = ownApiRoot): ServiceReleaseArtifactSource {
  return Object.freeze({ readManifest: () => {
    const file = resolve(apiRoot, SERVICE_RELEASE_ASSET), stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256_000) throw new Error("service_release_manifest_invalid");
    return JSON.parse(readFileSync(file, "utf8"));
  }, measureRuntime: () => measureServiceReleaseRuntime(apiRoot, process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown") });
}
export class ImmutableServiceReleaseArtifact {
  private result?: ServiceReleaseResult;
  private closed = false;
  constructor(private readonly source: ServiceReleaseArtifactSource = filesystemServiceReleaseSource()) {}
  onModuleDestroy(): void {
    if (this.closed) return; this.closed = true;
    if (composedArtifact === this) { composedArtifact = undefined; productiveArtifact = new ImmutableServiceReleaseArtifact(); }
  }
  read(): ServiceReleaseResult {
    if (this.closed) return Object.freeze({ kind: "unavailable", blocker: "release_manifest_missing" });
    if (this.result) return this.result;
    let value: unknown;
    try { value = this.source.readManifest(); }
    catch (error) { return this.result = Object.freeze({ kind: "unavailable", blocker: (error as { code?: string })?.code === "ENOENT" ? "release_manifest_missing" : "release_manifest_invalid" }); }
    if (value === undefined || value === null) return this.result = Object.freeze({ kind: "unavailable", blocker: "release_manifest_missing" });
    try { return this.result = verifyServiceReleaseManifest(value, this.source.measureRuntime()); }
    catch { return this.result = Object.freeze({ kind: "unavailable", blocker: "release_payload_changed" }); }
  }
}
let productiveArtifact = new ImmutableServiceReleaseArtifact();
let composedArtifact: ImmutableServiceReleaseArtifact | undefined;
/** Called once by the internal module factory, before the application listens.
 * No request, model, environment-ready flag or persisted JSON calls this. */
export function composeServiceReleaseArtifactSource(source: ServiceReleaseArtifactSource): ImmutableServiceReleaseArtifact {
  if (composedArtifact) throw new Error("service_release_source_already_composed");
  return composedArtifact = new ImmutableServiceReleaseArtifact(source);
}
export const currentServiceReleaseArtifact = (): ImmutableServiceReleaseArtifact => composedArtifact ?? productiveArtifact;
export const readServiceReleaseArtifact = (): ServiceReleaseResult => currentServiceReleaseArtifact().read();
