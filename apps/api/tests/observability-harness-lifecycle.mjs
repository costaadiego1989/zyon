import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { assertLocalDockerEndpoint } from "./local-disposable-postgres.mjs";

const labelKey = "com.zyon.validation";
export const observabilityServiceLimits = () => ["--memory", "256m", "--cpus", "1", "--pids-limit", "256"];
// A shared local source must not overwrite the independently asserted stream environments.
export const observabilityLogSourceLabels = () => ({ service: "zyon-api", job: "storefront-api" });
export function observabilityTestEnvironment(source) {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "systemdrive", "temp", "tmp", "tmpdir", "tz",
    "userprofile", "appdata", "localappdata", "home", "programfiles", "programw6432"]);
  return { ...Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.has(key.toLowerCase()) && value !== undefined)), NODE_ENV: "test" };
}

export function localObservabilityDocker(source = process.env, execute = execFileSync) {
  const env = observabilityTestEnvironment(source);
  const raw = (args, options = {}) => execute("docker", args, { encoding: "utf8", timeout: 30000,
    maxBuffer: 4_000_000, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], ...options, env });
  const context = raw(["context", "show"]).trim();
  assert.match(context, /^[A-Za-z0-9_.-]+$/, "observability_docker_context_invalid");
  assertLocalDockerEndpoint(raw(["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]).trim());
  const docker = (args, options) => raw(["--context", context, ...args], options);
  return { docker, context, env };
}

/** Presence checks only. Never load .env contents or inherited Node hooks. */
export function assertObservabilityEnvironment(paths) {
  for (const file of paths) assert.equal(existsSync(file), false, "observability_env_file_present");
  for (const key of ["NODE_OPTIONS", "DOTENV_CONFIG_PATH", "DOTENV_CONFIG_OVERRIDE"])
    assert.equal(process.env[key], undefined, "observability_environment_not_clean");
}

export function removeOwnedDockerContainer(docker, name, owner) {
  let inspected;
  try { inspected = docker(["inspect", name]); }
  catch (error) {
    if (/No such (?:container|object)/i.test(String(error.stderr ?? ""))) return;
    throw error;
  }
  const [container] = JSON.parse(inspected);
  assert.equal(container?.Name, `/${name}`, "observability_container_name_ownership_mismatch");
  assert.equal(container.Config?.Labels?.[labelKey], owner, "observability_container_label_ownership_mismatch");
  assert.match(container.Id, /^[a-f0-9]{64}$/, "observability_container_identity_invalid");
  docker(["rm", "--force", container.Id]);
}

export function removeOwnedDockerNetwork(docker, name, owner) {
  let inspected;
  try { inspected = docker(["network", "inspect", name]); }
  catch (error) {
    if (/No such (?:network|object)|network .* not found/i.test(String(error.stderr ?? ""))) return;
    throw error;
  }
  const [network] = JSON.parse(inspected);
  assert.equal(network?.Name, name, "observability_network_name_ownership_mismatch");
  assert.equal(network.Labels?.[labelKey], owner, "observability_network_label_ownership_mismatch");
  assert.equal(network.Internal, true, "observability_internal_network_required");
  assert.match(network.Id, /^[a-f0-9]{64}$/, "observability_network_identity_invalid");
  docker(["network", "rm", network.Id]);
}

export function runOwnedDockerValidation(docker, args, { name, owner }) {
  let result, primary, cleanup;
  try {
    result = docker(["run", "--rm", "--pull=never", "--name", name, "--label", `${labelKey}=${owner}`, "--network", "none",
      "--read-only", "--memory", "256m", "--cpus", "1", "--pids-limit", "128", "--cap-drop=ALL",
      "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m", ...args]);
  } catch (error) { primary = error; }
  finally { try { removeOwnedDockerContainer(docker, name, owner); } catch (error) { cleanup = error; } }
  if (primary && cleanup) throw new AggregateError([primary, cleanup], "observability_validation_and_cleanup_failed");
  if (primary) throw primary;
  if (cleanup) throw cleanup;
  return result;
}

/** Must subscribe before termination: kill() itself is not evidence of exit. */
export async function finishChild(child, { timeoutMs = 3000 } = {}) {
  await new Promise((resolve, reject) => {
    let timer;
    const done = () => { clearTimeout(timer); child.off("close", done); resolve(); };
    child.once("close", done);
    timer = setTimeout(() => { child.off("close", done); reject(new Error("observability_child_close_timeout")); }, timeoutMs);
    try { child.stdin?.end(); child.kill(); }
    catch (error) { clearTimeout(timer); child.off("close", done); reject(error); }
  });
}
