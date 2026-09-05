import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const api = path.join(root, "apps/api");
const output = path.join(root, ".audit/verification");
const generated = path.join(output, "generated-client");
const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
const push = process.argv.includes("--push");
if (push) {
  if (!databaseUrl) throw new Error("--push requires READY_PROD_TEST_DATABASE_URL");
  const target = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.pathname !== "/ready_prod_test") {
    throw new Error("Schema push is restricted to a local disposable database named ready_prod_test");
  }
}
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(api, ".audit"), { recursive: true });
const source = fs.readFileSync(path.join(api, "prisma/schema.prisma"), "utf8");
const schema = source.replace('provider = "prisma-client-js"',
  `provider = "prisma-client-js"\n  output = ${JSON.stringify(generated.replaceAll("\\", "/"))}`);
if (schema === source) throw new Error("Expected Prisma client generator was not found");
fs.writeFileSync(path.join(api, ".audit/test-schema.prisma"), schema);
const env = {
  ...process.env,
  PRISMA_GENERATE_SKIP_AUTOINSTALL: "1",
  DATABASE_URL: databaseUrl ?? "postgresql://127.0.0.1/ready_prod_test",
};
function prisma(args) {
  const result = spawnSync(process.execPath, [path.join(api, "node_modules/prisma/build/index.js"), ...args],
    { cwd: api, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// Output is inside this checkout; shared node_modules is never regenerated.
prisma(["generate", "--schema", ".audit/test-schema.prisma"]);
if (push) prisma(["db", "push", "--schema", ".audit/test-schema.prisma", "--skip-generate"]);

const paths = { "@prisma/client": [".audit/verification/generated-client/index.d.ts"] };
for (const folder of fs.readdirSync(path.join(root, "packages"))) {
  const manifest = path.join(root, "packages", folder, "package.json");
  if (fs.existsSync(manifest) && fs.existsSync(path.join(root, "packages", folder, "src/index.ts"))) {
    paths[JSON.parse(fs.readFileSync(manifest, "utf8")).name] = [`packages/${folder}/src/index.ts`];
  }
}
fs.writeFileSync(path.join(output, "api-isolated-tsconfig.json"), JSON.stringify({
  extends: "../../apps/api/tsconfig.json",
  compilerOptions: { baseUrl: "../..", rootDir: "../..", types: ["node"], paths },
  include: ["../../apps/api/src"],
}, null, 2));
console.log(`READY_PROD_TEST_PRISMA_CLIENT=${path.join(generated, "index.js")}`);
