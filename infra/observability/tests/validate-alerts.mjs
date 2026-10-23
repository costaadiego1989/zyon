import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { buildAlertTests } from "./alert-fixtures.mjs";

const require = createRequire(new URL("../../../apps/api/package.json", import.meta.url));
const { stringify } = createRequire(require.resolve("eslint"))("yaml");
const run = (args, input) => {
  const result = spawnSync("docker", args, { encoding: "utf8", windowsHide: true, timeout: 60000,
    maxBuffer: 1024 * 1024, input });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Docker validation failed: ${args.at(-1)}`);
  return result.stdout;
};
// Read-only inspection; no pull, daemon config, Compose or external service.
const image = run(["image", "inspect", "prom/prometheus:v3.4.0", "--format", "{{.Id}}"]); // real version is logged
const imageId = image.trim();
assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
const root = fileURLToPath(new URL("../prometheus/", import.meta.url));
const base = ["run", "--rm", "--pull=never", "--network", "none", "--read-only", "--memory", "256m", "--cpus", "1",
  "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
  "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "64", "--label", "zyon.local.validator=storefront-alerts",
  "--mount", `type=bind,source=${root},target=/etc/prometheus,readonly`,
  "--workdir", "/etc/prometheus", "--entrypoint", "/bin/promtool"];
function validate(command, input) {
  const name = `zyon-alerts-${randomUUID()}`;
  try {
    run([...base, "--name", name, ...(input ? ["-i"] : []), imageId, ...command], input);
  } finally {
    // --rm handles normal exit. If the CLI times out, do not leave a TSDB worker
    // alive; remove only this exact generated name after checking its ownership.
    const inspect = spawnSync("docker", ["container", "inspect", name], {
      encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024,
    });
    if (inspect.status === 0) {
      const [container] = JSON.parse(inspect.stdout);
      assert.equal(container.Name, `/${name}`);
      assert.equal(container.Config.Labels["zyon.local.validator"], "storefront-alerts");
      assert.match(container.Id, /^[a-f0-9]{64}$/);
      run(["container", "rm", "--force", container.Id]);
    } else if (inspect.error || !/No such (?:container|object)/i.test(inspect.stderr ?? "")) {
      throw new Error("Cannot confirm ownership-scoped validator cleanup");
    }
  }
}
// Sequential ephemeral containers, not a stack; test rules also checks syntax.
validate(["test", "rules", "/dev/stdin"], stringify(buildAlertTests()));
validate(["check", "config", "/etc/prometheus/prometheus.yml"]);
console.log(JSON.stringify({ validator: "promtool", imageId, groups: buildAlertTests().tests.length,
  expectations: buildAlertTests().tests.flatMap(group => group.alert_rule_test).length, network: "none", ephemeral: true }));
