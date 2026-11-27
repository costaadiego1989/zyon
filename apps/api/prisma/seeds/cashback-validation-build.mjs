import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require=createRequire(import.meta.url);
const ts=require("typescript");
const apiRoot=fileURLToPath(new URL("../../",import.meta.url));

/** Build-stage helper: final image needs only the two JS files and the API dist. */
export async function buildCashbackValidationSeed(outDirectory=path.join(apiRoot,"dist","seeds")){
  const output=path.resolve(outDirectory);
  if(!output.startsWith(path.resolve(apiRoot)+path.sep)||path.basename(output)!=="seeds")throw new Error("cashback_seed_build_output_must_be_api_seeds_directory");
  const config=ts.readConfigFile(path.join(apiRoot,"tsconfig.json"),ts.sys.readFile);
  if(config.error)throw new Error("cashback_seed_build_config_invalid");
  const parsed=ts.parseJsonConfigFileContent({...config.config,include:[],exclude:[],files:["prisma/seeds/cashback-validation-seed.ts","prisma/seeds/cashback-validation-guard.ts"]},ts.sys,apiRoot);
  const program=ts.createProgram(parsed.fileNames,{...parsed.options,rootDir:apiRoot,noEmit:true});
  const errors=ts.getPreEmitDiagnostics(program);
  if(errors.length){process.stderr.write(ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:file=>file,getCurrentDirectory:()=>apiRoot,getNewLine:()=>"\n"}));throw new Error("cashback_seed_typecheck_failed");}
  await fs.mkdir(output,{recursive:true});
  for(const stem of ["cashback-validation-guard","cashback-validation-seed"]){
    const source=await fs.readFile(new URL(`${stem}.ts`,import.meta.url),"utf8");
    const compiled=ts.transpileModule(source,{fileName:`${stem}.ts`,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
    // Source lives in prisma/seeds; compiled entry lives in dist/seeds and uses
    // exactly the financial modules built for that API artifact.
    const code=compiled.outputText.replace(/(["'])\.\.\/\.\.\/src\//g,"$1../");
    await fs.writeFile(path.join(output,`${stem}.js`),code,"utf8");
  }
  return {entry:path.join(output,"cashback-validation-seed.js"),files:2};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)buildCashbackValidationSeed(process.argv[2]).then(result=>process.stdout.write(JSON.stringify({files:result.files,entry:path.relative(apiRoot,result.entry)})+"\n")).catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
