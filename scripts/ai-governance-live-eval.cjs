const {spawnSync}=require("node:child_process"),{railway,project,service,environments}=require("./ai-governance-runtime.cjs");
const environment=process.argv[2]||"sandbox";
if(!environments[environment])throw Error("explicit_environment_required");
const result=spawnSync(railway,["variables","--json","--project",project,"--environment",environments[environment],"--service",service],
 {encoding:"utf8",timeout:20000,windowsHide:true,maxBuffer:2e6});
if(result.status!==0)throw Error("provider_configuration_unavailable");
const variables=JSON.parse(result.stdout);
const env={...process.env,NODE_ENV:"test",AI_EVAL_REPORT_PATH:"../../.audit/ai-governance-20261027/live-agent-evaluation.json",AI_EVAL_REQUIRED_PROVIDERS:"deepseek"};
for(const key of ["OPENAI_API_KEY","OPENAI_MODEL","OPENAI_BASE_URL","DEEPSEEK_API_KEY","DEEPSEEK_MODEL","DEEPSEEK_BASE_URL"])env[key]=variables[key]??"";
const run=spawnSync(process.execPath,["tests/run-ai-governance-evals.mjs","--live"],{cwd:require("node:path").resolve(__dirname,"../apps/api"),env,stdio:"inherit",windowsHide:true,timeout:900000});
process.exit(run.status??1);
