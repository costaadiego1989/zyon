import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Independent probes run the existing assertions against disposable source copies.
// No implementation, database or running API file is changed by this runner.
const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const evidenceArg = process.argv.slice(2).find(arg => arg.startsWith("--evidence="));
const evidence = path.resolve(evidenceArg?.slice("--evidence=".length)
  ?? path.join(root, ".specs/features/cashback-menu-ui/evidence/independent-mutations"));
fs.mkdirSync(evidence, { recursive: true });
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zyon-cashback-menu-ui-mutations-"));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const definitions = [
  { id: "program-status", component: "api", requirement: "MU-01", label: "Paused and ended published programs become enabled",
    file: "apps/api/src/modules/cashback/application/cashback.service.ts",
    old: 'program.merchantId === merchantId && program.status === "active" && program.published != null',
    new: 'program.merchantId === merchantId && program.published != null',
    tests: ["src/modules/storefront/application/use-cases/get-store-config.cashback-menu.spec.ts"] },
  { id: "merchant-scope", component: "storefront", requirement: "MU-01/MU-03", label: "Foreign merchant configuration enables this storefront",
    file: "apps/storefront/src/lib/cashback-navigation.ts",
    old: 'return snapshot.merchantId === merchantId && snapshot.cashbackEnabled === true;',
    new: 'return snapshot.cashbackEnabled === true;', tests: ["tests/storefront-cashback-navigation.test.cjs"] },
  { id: "inclusive-period", component: "dashboard", requirement: "MU-06", label: "A preset includes one additional business day",
    file: "apps/dashboard/src/pages/cashback/useCashbackPage.ts",
    old: 'firstDay.setUTCDate(firstDay.getUTCDate() - days + 1);',
    new: 'firstDay.setUTCDate(firstDay.getUTCDate() - days);', tests: ["src/pages/cashback/useCashbackPage.spec.ts"] },
];
const originalInputs = Object.fromEntries(definitions.flatMap(probe => [probe.file,
  ...probe.tests.map(test => `apps/${probe.component}/${test}`)])
  .map(relative => [relative, sha256(fs.readFileSync(path.join(root, relative)))]));
const report = { generatedAt: new Date().toISOString(), verifier: "cashback_menu_ui_verifier",
  sourceHead: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).stdout.trim(),
  temporaryCopiesOnly: true, sourceInputs: originalInputs, probes: [] };

function copy(relative) {
  const target = path.join(temporaryRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(path.join(root, relative), target, { recursive: true });
}
function junction(relative, source = relative) {
  const target = path.join(temporaryRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(path.join(root, source), target, process.platform === "win32" ? "junction" : "dir");
}
function run(probe, phase) {
  const app = path.join(temporaryRoot, "apps", probe.component);
  let args;
  if (probe.component === "api") args = ["--import", "./tests/test-network-guard.mjs", "--loader", "./tests/ready-prod-loader.mjs",
    "--test", "--test-concurrency=1", ...probe.tests];
  else if (probe.component === "storefront") args = ["--test", "--test-concurrency=1", ...probe.tests];
  else args = [path.join(root, "apps/dashboard/node_modules/vitest/vitest.mjs"), "run", ...probe.tests,
    "--pool=forks", "--maxWorkers=1", "--minWorkers=1"];
  const child = spawnSync(process.execPath, ["--max-old-space-size=160", ...args], {
    cwd: app, encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=160", NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  const output = (child.stdout ?? "") + (child.stderr ?? "");
  const log = `${probe.id}-${phase}.log`;
  fs.writeFileSync(path.join(evidence, log), output);
  const tapFailed = /# fail (\d+)/.exec(output), vitestFailed = /Tests\s+(\d+) failed/.exec(output);
  const failedTests = Number(tapFailed?.[1] ?? vitestFailed?.[1] ?? 0);
  const tapPassed = /# pass (\d+)/.exec(output), vitestPassed = /Tests\s+(\d+) passed/.exec(output);
  const passedTests = Number(tapPassed?.[1] ?? vitestPassed?.[1] ?? 0);
  return { exitCode: child.status, signal: child.signal, failedTests, passedTests, log,
    logSha256: sha256(output), runnerError: child.error?.code ?? null };
}

try {
  junction("packages");
  for (const component of ["api", "dashboard", "storefront"]) {
    junction(`apps/${component}/node_modules`);
    copy(`apps/${component}/package.json`);
  }
  copy("apps/api/src");
  copy("apps/api/tests/ready-prod-loader.mjs");
  copy("apps/api/tests/test-network-guard.mjs");
  copy("apps/dashboard/src");
  copy("apps/dashboard/vitest.config.ts");
  copy("apps/dashboard/tsconfig.json");
  copy("tsconfig.base.json");
  for (const relative of ["tests/storefront-cashback-navigation.test.cjs", "src/lib/cashback-navigation.ts",
    "src/lib/hooks/useStoreCashbackNavigation.ts", "src/components/CashbackNavigation.tsx"])
    copy(`apps/storefront/${relative}`);

  for (const probe of definitions) {
    const source = path.join(temporaryRoot, probe.file), original = fs.readFileSync(source, "utf8");
    if (original.split(probe.old).length !== 2) throw Error(`mutation_target_must_occur_once:${probe.id}`);
    const baseline = run(probe, "baseline");
    if (baseline.exitCode !== 0 || baseline.failedTests !== 0 || baseline.passedTests < 1)
      throw Error(`baseline_failed:${probe.id}:${JSON.stringify(baseline)}`);
    fs.writeFileSync(source, original.replace(probe.old, probe.new));
    let mutant;
    try { mutant = run(probe, "mutant"); }
    finally { fs.writeFileSync(source, original); }
    const killed = mutant.exitCode !== 0 && mutant.failedTests > 0 && !mutant.signal && !mutant.runnerError;
    report.probes.push({ ...probe, baseline, mutant, killed });
    process.stdout.write(JSON.stringify({ id: probe.id, baselineTests: baseline.passedTests,
      mutantFailedTests: mutant.failedTests, killed }) + "\n");
  }
  report.sourcesUnchanged = Object.entries(originalInputs).every(([relative, hash]) =>
    sha256(fs.readFileSync(path.join(root, relative))) === hash);
  report.success = report.probes.length === 3 && report.probes.every(probe => probe.killed) && report.sourcesUnchanged;
} catch (error) {
  report.success = false;
  report.error = error.message;
} finally {
  // Only the freshly allocated task directory is recursively removed, never a computed workspace path.
  const checked = path.resolve(temporaryRoot), expectedParent = path.resolve(os.tmpdir());
  if (path.dirname(checked) !== expectedParent || !path.basename(checked).startsWith("zyon-cashback-menu-ui-mutations-"))
    throw Error("unsafe_temporary_cleanup_path");
  fs.rmSync(checked, { recursive: true, force: true });
  fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify(report, null, 2) + "\n");
}
process.stdout.write(JSON.stringify({ success: report.success, sourcesUnchanged: report.sourcesUnchanged,
  killed: report.probes.filter(probe => probe.killed).length, report: path.join(evidence, "report.json"), error: report.error ?? null }) + "\n");
if (!report.success) process.exitCode = 1;
