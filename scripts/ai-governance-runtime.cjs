const fs=require("node:fs"),path=require("node:path"),{spawnSync}=require("node:child_process");
const project="b8421237-6557-4677-a08c-c93453b08568",service="2fcb2906-32f3-45df-a3ce-767064b49b98";
const environments={sandbox:"a347216c-86e3-4a75-8d73-5ae6e122408c",production:"604c900d-afcd-4e98-b5b5-d3a1a428997c"};
const railway=process.env.RAILWAY_CLI||path.join(process.env.APPDATA,"npm/node_modules/@railway/cli/bin/railway.exe");
const root=path.resolve(__dirname,".."),evidence=path.join(root,".audit/ai-governance-20261027");
function remote(environment,code){
  if(!environments[environment])throw Error("explicit_environment_required");
  const guard=`if(process.env.RAILWAY_PROJECT_ID!==${JSON.stringify(project)}||process.env.RAILWAY_ENVIRONMENT_ID!==${JSON.stringify(environments[environment])}||process.env.RAILWAY_SERVICE_ID!==${JSON.stringify(service)})throw Error("runtime_identity_mismatch");\n`;
  const command=`node -e 'eval(Buffer.from("${Buffer.from(guard+code).toString("base64")}","base64").toString())'`;
  const result=spawnSync(railway,["ssh","--project",project,"--environment",environments[environment],"--service",service,"--",command],
    {windowsHide:true,encoding:"utf8",timeout:55000,maxBuffer:40*1024*1024});
  if(result.status!==0)throw Error("railway_remote_failed:"+(result.error?.code||result.status));
  return result.stdout.trim();
}
function inventory(environment){
 const code=`const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
 const {PrismaClient}=require("/repo/apps/api/node_modules/@prisma/client");const db=new PrismaClient();
 (async()=>{
 const files=[];function visit(rel){const target=path.join("/repo",rel);if(!fs.existsSync(target))return;const s=fs.lstatSync(target);if(s.isSymbolicLink())return;
 if(s.isDirectory()){for(const n of fs.readdirSync(target)){if(["node_modules","dist",".git","coverage",".turbo"].includes(n)||n.startsWith(".env"))continue;visit(path.posix.join(rel,n));}}
 else files.push({path:rel,sha256:crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex")});}
 for(const rel of ["apps/api/src","apps/api/prisma","apps/api/scripts","apps/api/package.json","packages","pnpm-lock.yaml","package.json"])visit(rel);
 const modelConfiguration=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(OPENAI|OPENROUTER|DEEPSEEK|LOCAL_LLM|REVENUE_DEEPSEEK|EMBEDDING).*MODEL$/.test(k)));
 const migrations=await db.$queryRawUnsafe("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 6");
 const timezone=await db.$queryRawUnsafe("SHOW TIME ZONE");
 console.log(JSON.stringify({at:new Date().toISOString(),deploymentId:process.env.RAILWAY_DEPLOYMENT_ID,modelConfiguration,migrations,timezone,files}));
 await db.$disconnect();})().catch(()=>{console.error("runtime_inventory_failed");process.exitCode=1;});`;
 const result=JSON.parse(remote(environment,code));fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,environment+"-inventory.json"),JSON.stringify(result,null,2));
 console.log(JSON.stringify({environment,deploymentId:result.deploymentId,files:result.files.length,modelConfiguration:result.modelConfiguration,migrations:result.migrations,timezone:result.timezone}));
}
module.exports={remote,project,service,environments,railway,root,evidence};
if(require.main===module)inventory(process.argv[2]);
