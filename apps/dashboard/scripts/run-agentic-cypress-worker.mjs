import {readFile,writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {assertSuccessfulRun} from './run-agentic-cypress.mjs';
let completed=false;
const resultPath=process.argv[3];
process.once('exit',code=>{if(!completed){writeFileSync(resultPath+'.exit',JSON.stringify({code,completed:false}));process.exitCode=code||1;}});
try{
  const options=JSON.parse(await readFile(process.argv[2],'utf8'));
  const {run}=await import('cypress');
  const result=await run(options);
  const summary={totalTests:result.totalTests,totalPassed:result.totalPassed,totalFailed:result.totalFailed,totalSkipped:result.totalSkipped,totalPending:result.totalPending,failures:result.failures,message:result.message,runs:result.runs?.map(run=>({spec:run.spec?.relative,error:run.error,tests:run.tests?.map(test=>({title:test.title,state:test.state,displayError:test.displayError})),screenshots:run.screenshots?.map(item=>({name:item.name,path:item.path}))}))};
  await writeFile(resultPath,JSON.stringify(summary,null,2));completed=true;assertSuccessfulRun(summary);
}catch(error){completed=true;process.stderr.write(String(error.message)+'\n');process.exitCode=1;}
finally{
  await Promise.all([process.stdout,process.stderr].map(stream=>new Promise(resolve=>stream.write('',resolve))));
  process.exit(process.exitCode??0);
}
