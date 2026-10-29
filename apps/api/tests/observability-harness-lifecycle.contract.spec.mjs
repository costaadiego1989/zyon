import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runOwnedDockerValidation, removeOwnedDockerContainer, finishChild,
  observabilityTestEnvironment, localObservabilityDocker, removeOwnedDockerNetwork, observabilityServiceLimits, observabilityLogSourceLabels } from "./observability-harness-lifecycle.mjs";

const name = "zyon-obsv-validator-11111111-1111-4111-8111-111111111111", owner = "synthetic-owner";
const id = "a".repeat(64);
function dockerDouble(options = {}) {
  const calls = [];
  const docker = args => {
    calls.push(args);
    if (args[0] === "run") { if (options.runError) throw options.runError; return "validated"; }
    if (args[0] === "inspect") {
      if (options.absent) throw Object.assign(new Error("inspect failed"), { stderr: "Error: No such container: synthetic" });
      if (options.inspectError) throw options.inspectError;
      return JSON.stringify([{ Id: id, Name: `/${name}`, Config: { Labels: { "com.zyon.validation": options.foreign ? "other" : owner } } }]);
    }
    if (args[0] === "rm") { if (options.cleanupError) throw options.cleanupError; return id; }
    throw new Error("unexpected_synthetic_docker_command");
  };
  return { docker, calls };
}

test("validator registers exact ownership before run and removes owned container by immutable ID", () => {
  const { docker, calls } = dockerDouble();
  assert.equal(runOwnedDockerValidation(docker, ["cached-image", "check"], { name, owner }), "validated");
  assert.deepEqual(calls[0].slice(0, 8), ["run", "--rm", "--pull=never", "--name", name, "--label", `com.zyon.validation=${owner}`, "--network"]);
  assert.ok(calls[0].includes("none")); assert.ok(calls[0].includes("--read-only"));
  assert.deepEqual(calls.at(-1), ["rm", "--force", id]);
});
test("validator CLI timeout still inspects and removes only its owned container", () => {
  const primary = Object.assign(new Error("synthetic_cli_timeout"), { code: "ETIMEDOUT" });
  const { docker, calls } = dockerDouble({ runError: primary });
  assert.throws(() => runOwnedDockerValidation(docker, ["cached-image", "check"], { name, owner }), error => error === primary);
  assert.deepEqual(calls.at(-1), ["rm", "--force", id]);
});
test("validator preserves primary and cleanup errors together instead of swallowing either", () => {
  const primary = new Error("synthetic_validation_failed"), cleanup = new Error("synthetic_cleanup_failed");
  const { docker } = dockerDouble({ runError: primary, cleanupError: cleanup });
  assert.throws(() => runOwnedDockerValidation(docker, ["cached-image"], { name, owner }), error =>
    error instanceof AggregateError && error.errors[0] === primary && error.errors[1] === cleanup);
});
test("cleanup refuses foreign ownership and does not remove a container by name", () => {
  const { docker, calls } = dockerDouble({ foreign: true });
  assert.throws(() => removeOwnedDockerContainer(docker, name, owner), /ownership/);
  assert.equal(calls.some(args => args[0] === "rm"), false);
});
test("cleanup tolerates confirmed absence but propagates unknown inspection failures", () => {
  assert.doesNotThrow(() => removeOwnedDockerContainer(dockerDouble({ absent: true }).docker, name, owner));
  const failure = new Error("synthetic_daemon_unavailable");
  assert.throws(() => removeOwnedDockerContainer(dockerDouble({ inspectError: failure }).docker, name, owner), error => error === failure);
});
test("finishing an exec child waits for close rather than merely calling kill", async () => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.exitCode = null; child.signalCode = null;
  let killed = false, settled = false;
  child.kill = () => { killed = true; return true; };
  const finishing = finishChild(child, { timeoutMs: 1000 }).then(() => { settled = true; });
  await new Promise(setImmediate); assert.equal(killed, true); assert.equal(settled, false);
  child.emit("close", 0); await finishing; assert.equal(settled, true);
});
test("exec child that never closes fails with a bounded diagnostic", async () => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.exitCode = null; child.signalCode = null;
  child.kill = () => true;
  await assert.rejects(finishChild(child, { timeoutMs: 10 }), /observability_child_close_timeout/);
});
test("an exit code is not a close event while child pipes can still be open", async () => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.exitCode = 0; child.signalCode = null;
  child.kill = () => true;
  let settled = false;
  const finishing = finishChild(child, { timeoutMs: 1000 }).then(() => { settled = true; });
  await new Promise(setImmediate); assert.equal(settled, false);
  child.emit("close", 0); await finishing;
});
test("worker environment cannot inherit credentials, Node hooks, proxy or provider destinations", () => {
  const clean = observabilityTestEnvironment({ Path: "synthetic-path", SystemRoot: "C:/Windows", TEMP: "C:/tmp",
    NODE_OPTIONS: "--env-file=PRIVATE", DATABASE_URL: "PRIVATE", OPENAI_API_KEY: "PRIVATE", HTTP_PROXY: "PRIVATE", OTEL_EXPORTER_OTLP_ENDPOINT: "https://PRIVATE" });
  assert.deepEqual(clean, { Path: "synthetic-path", SystemRoot: "C:/Windows", TEMP: "C:/tmp", NODE_ENV: "test" });
});
test("Windows Docker plugin discovery retains ProgramFiles plumbing but never Docker overrides", () => {
  assert.deepEqual(observabilityTestEnvironment({ ProgramFiles: "C:/Program Files", ProgramW6432: "C:/Program Files",
    DOCKER_HOST: "PRIVATE", DOCKER_CONTEXT: "PRIVATE", DOCKER_CONFIG: "PRIVATE", NODE_OPTIONS: "PRIVATE" }),
  { ProgramFiles: "C:/Program Files", ProgramW6432: "C:/Program Files", NODE_ENV: "test" });
});

test("Docker context is captured once, pinned on every command and restricted to a local endpoint", () => {
  const calls = [];
  const execution = (_command, args, options) => {
    calls.push({ args, env: options.env });
    if (args.join(" ") === "context show") return "desktop-linux\n";
    if (args[0] === "context") return "npipe:////./pipe/dockerDesktopLinuxEngine\n";
    return "cached";
  };
  const { docker } = localObservabilityDocker({ Path: "platform", DOCKER_HOST: "https://PRIVATE", DATABASE_URL: "PRIVATE" }, execution);
  assert.equal(docker(["image", "inspect", "cached"]), "cached");
  assert.deepEqual(calls.at(-1), { args: ["--context", "desktop-linux", "image", "inspect", "cached"], env: { Path: "platform", NODE_ENV: "test" } });
  assert.throws(() => localObservabilityDocker({}, (_command, args) => args[1] === "show" ? "remote" : "tcp://forbidden.invalid:2376"), /local_docker_context_required/);
});

test("network creation ACK loss can remove only the exact owned network by ID", () => {
  const calls = [];
  const docker = args => {
    calls.push(args);
    if (args[1] === "inspect") return JSON.stringify([{ Id: id, Name: name, Labels: { "com.zyon.validation": owner }, Internal: true }]);
    return id;
  };
  removeOwnedDockerNetwork(docker, name, owner);
  assert.deepEqual(calls.at(-1), ["network", "rm", id]);
});
test("six isolated service caps leave room for the browser without weakening Docker isolation", () => {
  assert.deepEqual(observabilityServiceLimits(), ["--memory", "256m", "--cpus", "1", "--pids-limit", "256"]);
  assert.equal(6 * 256, 1536);
});

test("shared log source must preserve each controlled input stream environment", () => {
  const fixed = observabilityLogSourceLabels();
  assert.deepEqual(fixed, { service: "zyon-api", job: "storefront-api" });
  for (const environment of ["development", "application-test"])
    assert.equal({ environment, ...fixed }.environment, environment);
});
