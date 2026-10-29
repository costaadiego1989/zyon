import assert from "node:assert/strict";
import test from "node:test";
import { dockerEnvironment, assertLocalDockerEndpoint, assertOwnedContainer } from "./local-disposable-postgres.mjs";

test("Docker child environment excludes database/provider/daemon override variables", () => {
  const env = dockerEnvironment({ PATH: "fixture-path", SystemRoot: "fixture-root", DATABASE_URL: "private-canary",
    READY_PROD_TEST_DATABASE_URL: "private-canary", PGHOST: "external", DOCKER_HOST: "tcp://external:2375",
    DOCKER_CONTEXT: "remote", NODE_OPTIONS: "private-canary", OPENAI_API_KEY: "private-canary" });
  assert.deepEqual(env, { PATH: "fixture-path", SystemRoot: "fixture-root" });
});
for (const endpoint of ["npipe:////./pipe/dockerDesktopLinuxEngine", "unix:///var/run/docker.sock"]) test(`accept local Docker endpoint ${endpoint}`, () => {
  assert.doesNotThrow(() => assertLocalDockerEndpoint(endpoint));
});
for (const endpoint of ["tcp://127.0.0.1:2375", "tcp://external:2375", "ssh://external", "npipe:////remote/pipe/docker", "unix://external/docker.sock", "", "unix:///socket\n"]) test(`reject Docker endpoint ${JSON.stringify(endpoint)}`, () => {
  assert.throws(() => assertLocalDockerEndpoint(endpoint));
});
test("cleanup authority requires exact full ID, UUID label and name", () => {
  const id = "a".repeat(64), runId = "synthetic-run";
  const info = { Id: id, Name: `/aacp-write-db-${runId}`, Config: { Labels: { "com.zyon.storefront-write-test": runId } } };
  assert.doesNotThrow(() => assertOwnedContainer(info, id, runId));
  for (const changed of [{ ...info, Id: "b".repeat(64) }, { ...info, Name: "/unrelated" },
    { ...info, Config: { Labels: { "com.zyon.storefront-write-test": "other" } } }]) assert.throws(() => assertOwnedContainer(changed, id, runId));
  assert.throws(() => assertOwnedContainer(info, "a", runId));
});

test("endpoint guards reject actual whitespace/control characters, not just escaped labels", () => {
  for (const endpoint of ["unix:///socket" + String.fromCharCode(10), " unix:///socket", "npipe:////./pipe/docker" + String.fromCharCode(13)])
    assert.throws(() => assertLocalDockerEndpoint(endpoint));
});
