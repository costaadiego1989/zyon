import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const result=spawnSync(process.execPath,["--loader","./tests/ready-prod-loader.mjs","./tests/ai-governance-evaluation.ts",...process.argv.slice(2)],
  {cwd:fileURLToPath(new URL("../",import.meta.url)),env:{...process.env,NODE_ENV:"test"},stdio:"inherit",timeout:900000});
if(result.error)console.error(result.error.message);
process.exit(result.status??1);
