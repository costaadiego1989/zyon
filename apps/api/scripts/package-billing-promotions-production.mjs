import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const audit = path.join(root, ".audit/billing-promotions-production-20261015");
const baseline = JSON.parse(readFileSync(path.join(audit, "baseline.json"), "utf8"));
const release = path.resolve(root, "../AACP-subscription-promotions-prod-20261015");
if (existsSync(release)) throw new Error("production_release_already_exists");
const runGit = args => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 15 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git_release_failed:${args[0]}`);
  return result.stdout.trim();
};
const changes = new Set(runGit(["diff", "--name-only", "b0fef37", "HEAD"]).split(/\r?\n/));
const normalized = bytes => bytes.toString("utf8").replace(/\r\n/g, "\n");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const dashboardReport = JSON.parse(readFileSync(path.resolve(root, "../AACP/scripts/erp-merchant-auth-dashboard-release.json"), "utf8"));
const deployedDashboard = await (await fetch("https://app.zyon-payments.com.br")).text();
const baselineDashboardIndex = readFileSync(path.join(dashboardReport.folder, "apps/dashboard/dist/index.html"), "utf8");
if (deployedDashboard !== baselineDashboardIndex) throw new Error("dashboard_running_artifact_changed");
for (const file of dashboardReport.expectedSourceHashes) {
  if (changes.has(file.path)) throw new Error(`dashboard_preservation_overlap:${file.path}`);
  const bytes = readFileSync(path.join(dashboardReport.folder, file.path));
  if (sha(bytes) !== file.sha256) throw new Error(`dashboard_baseline_hash_mismatch:${file.path}`);
}
runGit(["worktree", "add", "-b", "release/subscription-promotions-prod-20261015", release, "HEAD"]);
const preservedChanges = [];
for (const file of baseline.hashes) {
  if (changes.has(file.path)) continue;
  const bytes = readFileSync(path.join(baseline.target, file.path));
  if (sha(bytes) !== file.sha256) throw new Error("api_baseline_hash_mismatch");
  const destination = path.join(release, file.path);
  if (!existsSync(destination) || normalized(readFileSync(destination)) !== normalized(bytes)) preservedChanges.push(file.path);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(path.join(baseline.target, file.path), destination);
}
for (const file of dashboardReport.expectedSourceHashes) {
  const destination = path.join(release, file.path);
  mkdirSync(path.dirname(destination), { recursive: true }); cpSync(path.join(dashboardReport.folder, file.path), destination);
  preservedChanges.push(file.path);
}
const protectedFiles = baseline.hashes.filter(file => !changes.has(file.path));
for (const file of protectedFiles) if (sha(readFileSync(path.join(release, file.path))) !== file.sha256) throw new Error("production_preservation_failed");
const report = { release, baselineApiDeployment: baseline.baselineDeploymentId,
  baselineDashboardDeployment: "dpl_G1hWexKdw3AoAGeVERnn9y9Dq4T7", baselineDashboardIndexMatched: true,
  protectedApiSourceFiles: protectedFiles.length, preservedChanges, onlyDeliveryOverlaysRuntime: true };
writeFileSync(path.join(audit, "package.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
