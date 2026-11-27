import { readdirSync, statSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const workspace = fileURLToPath(new URL("../../../", import.meta.url));
const loader = "./apps/api/tests/platform-support-loader.mjs";
const moduleDir = "apps/api/src/modules/platform-prospecting";
const boundaryFiles = [
  "apps/api/src/modules/platform-control/presentation/platform-permission.guard.spec.ts",
  "apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-webhook.controller.spec.ts",
  "apps/api/tests/prospecting-fixture.spec.ts",
  "apps/api/tests/prospecting-schema.spec.ts",
  "apps/api/tests/prospecting-browser-runtime.spec.ts",
  "apps/control/src/lib/prospecting-api.spec.ts",
  "apps/api/src/test-runner.spec.ts",
];

function inventory() {
  const files: string[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(directory, {withFileTypes:true})) {
      const path=resolve(directory,entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.spec\.ts$/.test(entry.name))
        files.push(relative(workspace,path).split(sep).join("/"));
    }
  }
  visit(resolve(workspace,moduleDir));
  if (!files.length) throw Error("prospecting_no_tests_selected");
  for (const boundary of boundaryFiles) {
    if (!statSync(resolve(workspace,boundary)).isFile()) throw Error("prospecting_registration_missing");
    files.push(boundary);
  }
  return files.sort();
}

// The legacy registry uses this same entry point. Keep Node's parent test protocol out of the child.
export function runProspectingRegression(args: string[] = []) {
  const env = {...process.env, NODE_ENV:"test"} as NodeJS.ProcessEnv;
  delete env.NODE_TEST_CONTEXT;
  return new Promise<number>((resolveExit,reject)=>{
    const child=spawn(process.execPath,["--loader",loader,"./apps/api/src/prospecting-test-runner.ts",...args],
      {cwd:workspace,env,stdio:"inherit",windowsHide:true});
    child.once("error",reject);child.once("exit",code=>resolveExit(code??1));
  });
}

async function main(args: string[]) {
  const files=inventory();
  if(args.length===1 && args[0]==="--list"){process.stdout.write(files.join("\n")+"\n");return 0;}
  let selected=files,pattern:string|undefined;
  const options=new Set<string>();
  for(let i=0;i<args.length;i+=2){
    const [key,value]=args.slice(i,i+2);
    if(!value?.trim() || options.has(key))throw Error("prospecting_invalid_selection");
    options.add(key);
    if(key==="--file")selected=files.filter(f=>f===value);
    else if(key==="--match"){new RegExp(value);pattern=value;}
    else throw Error("prospecting_invalid_selection");
  }
  if(!selected.length)throw Error("prospecting_no_tests_selected");
  // The actual fixture validates loopback and exercises PostgreSQL, Neo4j and Redis even for a narrow source selection.
  const {createProspectingFixture}=await import(new URL("../tests/prospecting-fixture.ts",import.meta.url).href);
  const fixture=await createProspectingFixture();
  await fixture.close();
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const child=spawn(process.execPath,["--import","./apps/api/tests/test-network-guard.mjs","--loader",loader,
    "--test","--test-concurrency=1","--test-reporter=tap",...(pattern?["--test-name-pattern",pattern]:[]),...selected],
    {cwd:workspace,env,stdio:["ignore","pipe","inherit"],windowsHide:true});
  const closed=new Promise<number>((resolveExit,reject)=>{child.once("error",reject);child.once("close",code=>resolveExit(code??1));});
  let passed=0;
  for await (const line of createInterface({input:child.stdout,crlfDelay:Infinity})){
    process.stdout.write(line+"\n");
    const name=/^\s*ok \d+ - (.+)$/.exec(line)?.[1];
    if(name && !/ # (?:SKIP|TODO)\b/i.test(name) && !/\.spec\.[cm]?[jt]sx?$/.test(name))passed++;
  }
  const code=await closed;
  if(code)return code;
  if(!passed)throw Error("prospecting_no_tests_selected");
  return 0;
}
if(resolve(process.argv[1]??"")===fileURLToPath(import.meta.url)){
  main(process.argv.slice(2)).then(code=>{process.exitCode=code;},error=>{
    console.error(error instanceof Error?error.message:"prospecting_regression_failed");process.exitCode=1;
  });
}
