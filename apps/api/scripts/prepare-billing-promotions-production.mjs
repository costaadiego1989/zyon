import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Read-only in Railway. Export the actual running source rather than replacing
// production-only fixes with a Git branch which may not contain those fixes.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const identity = { project: "b8421237-6557-4677-a08c-c93453b08568", environment: "604c900d-afcd-4e98-b5b5-d3a1a428997c", service: "2fcb2906-32f3-45df-a3ce-767064b49b98" };
const expected = "da20e9d9-02f6-4f1f-94f4-eb285540d965";
const output = path.join(root, ".audit/billing-promotions-production-20261015");
const target = path.join(output, "baseline-api");
if (existsSync(path.join(output, "baseline.json"))) throw new Error("production_baseline_already_exported");
const railway = path.join(process.env.APPDATA, "npm/node_modules/@railway/cli/bin/railway.exe");
const remoteSource = `
const fs=require('node:fs'),path=require('node:path');
if(process.env.RAILWAY_PROJECT_ID!==${JSON.stringify(identity.project)}||process.env.RAILWAY_ENVIRONMENT_ID!==${JSON.stringify(identity.environment)}||process.env.RAILWAY_SERVICE_ID!==${JSON.stringify(identity.service)}||process.env.RAILWAY_DEPLOYMENT_ID!==${JSON.stringify(expected)})throw Error('production_identity_changed');
const files=[];
function walk(relative){const full=path.join('/repo',relative),stat=fs.lstatSync(full);if(stat.isSymbolicLink())return;
if(stat.isDirectory()){for(const child of fs.readdirSync(full).sort()){if(['node_modules','dist','.git','coverage','.cache','logs','uploads'].includes(child))continue;walk(relative+'/'+child);}}
else if(stat.isFile()&&!/(?:^|\\/)\\.env(?:\\.|$)/.test(relative)&&/(?:\\.(?:ts|tsx|js|mjs|cjs|json|yaml|yml|prisma|sql|toml|sh)|Dockerfile|\\.dockerignore)$/.test(relative)){if(stat.size>8*1024*1024)throw Error('source_file_too_large');files.push({path:relative,data:fs.readFileSync(full).toString('base64')});}}
for(const item of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json','.dockerignore','packages','apps/api'])if(fs.existsSync(path.join('/repo',item)))walk(item);
console.log('PRODUCTION_SOURCE_BEGIN');console.log(JSON.stringify({deploymentId:process.env.RAILWAY_DEPLOYMENT_ID,files}));console.log('PRODUCTION_SOURCE_END');`;
const encoded = Buffer.from(remoteSource).toString("base64");
const exported = spawnSync(railway, ["ssh", "--project", identity.project, "--environment", identity.environment, "--service", identity.service,
  `node -e 'eval(Buffer.from(process.argv[1],process.argv[2]).toString())' ${encoded} base64`],
  { windowsHide: true, encoding: "utf8", timeout: 55000, maxBuffer: 150 * 1024 * 1024 });
if (exported.status !== 0) throw new Error(`production_source_read_failed:${exported.status}`);
const match = exported.stdout.match(/PRODUCTION_SOURCE_BEGIN\r?\n([\s\S]*?)\r?\nPRODUCTION_SOURCE_END/);
if (!match) throw new Error("production_source_export_missing");
const snapshot = JSON.parse(match[1]);
if (snapshot.deploymentId !== expected || !snapshot.files?.length) throw new Error("production_source_export_invalid");
const normalize = bytes => bytes.toString("utf8").replace(/\r\n/g, "\n");
const hashes = [];
for (const file of snapshot.files) {
  if (!/^(?:apps\/api\/|packages\/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|tsconfig\.base\.json$|\.dockerignore$)/.test(file.path) || file.path.includes("..") || path.isAbsolute(file.path)) throw new Error("production_source_path_invalid");
  const destination = path.resolve(target, file.path);
  if (!destination.startsWith(path.resolve(target) + path.sep)) throw new Error("production_source_path_outside_export");
  const bytes = Buffer.from(file.data, "base64");
  mkdirSync(path.dirname(destination), { recursive: true }); writeFileSync(destination, bytes);
  hashes.push({ path: file.path, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const changes = spawnSync("git", ["diff", "--name-status", "b0fef37", "HEAD", "--", "apps/api", "packages"], { cwd: root, encoding: "utf8" });
if (changes.status !== 0) throw new Error("release_diff_unavailable");
const comparison = changes.stdout.trim().split(/\r?\n/).map(line => {
  const [status, relative] = line.split("\t");
  if (!relative || relative.endsWith(".env.example") || relative.startsWith("apps/api/scripts/") || /\.(spec|test)\.[cm]?[jt]sx?$/.test(relative)) return null;
  const prodPath = path.join(target, relative), ours = normalize(readFileSync(path.join(root, relative)));
  if (!existsSync(prodPath)) return { path: relative, status, comparison: status === "A" ? "new" : "missing_in_production" };
  const prod = normalize(readFileSync(prodPath));
  if (prod === ours) return { path: relative, status, comparison: "already_identical" };
  const old = spawnSync("git", ["show", `b0fef37:${relative}`], { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return { path: relative, status, comparison: old.status === 0 && prod === normalize(Buffer.from(old.stdout)) ? "safe_patch" : "needs_three_way_review" };
}).filter(Boolean);
const report = { preparedAt: new Date().toISOString(), ...identity, baselineDeploymentId: expected, baselineSource: "running_production_container", target, hashes, comparison };
writeFileSync(path.join(output, "baseline.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ baselineDeploymentId: expected, sourceFiles: hashes.length, output, comparison }, null, 2));
