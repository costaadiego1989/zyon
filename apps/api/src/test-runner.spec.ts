import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root=fileURLToPath(new URL("../../../",import.meta.url));
function run(args:string[],env:NodeJS.ProcessEnv={}){
  const childEnv={...process.env,...env};
  delete childEnv.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,["--loader","./apps/api/tests/platform-support-loader.mjs","./apps/api/src/prospecting-test-runner.ts",...args],{
    cwd:root,env:childEnv,timeout:90000,encoding:"utf8",windowsHide:true,
  });
  assert.ifError(result.error);
  return {code:result.status,output:result.stdout+result.stderr};
}
test("PROS-32 AC2 o registro descobre suítes da plataforma, fronteiras HTTP e cliente Node e rejeita seleção vazia",()=>{
  const listed=run(["--list"]);assert.equal(listed.code,0,listed.output);
  assert.match(listed.output,/platform-prospecting\.module\.spec\.ts/);
  assert.match(listed.output,/whatsapp-webhook\.controller\.spec\.ts/);
  assert.match(listed.output,/prospecting-browser-runtime\.spec\.ts/);
  assert.match(listed.output,/apps\/control\/src\/lib\/prospecting-api\.spec\.ts/);
  const missing=run(["--file","apps/api/src/no-such.spec.ts"]);assert.notEqual(missing.code,0);assert.match(missing.output,/prospecting_no_tests_selected/);
});
test("PROS-32 AC2 filtro sem um teste executado falha mesmo que o Node aprove o arquivo vazio",()=>{
  const entry="apps/control/src/lib/prospecting-api.spec.ts";
  const empty=run(["--file",entry,"--match","no such matching assertion 90372"]);
  assert.notEqual(empty.code,0);assert.match(empty.output,/prospecting_no_tests_selected/);
  const valid=run(["--file",entry,"--match","PROS-31 AC1 "]);assert.equal(valid.code,0,valid.output);
});
test("PROS-32 AC2 dependência local obrigatória ausente encerra até a seleção de uma suíte puramente local",()=>{
  const missing=run(["--file","apps/control/src/lib/prospecting-api.spec.ts"],{PROSPECTING_TEST_REDIS_URL:"redis://127.0.0.1:1"});
  assert.notEqual(missing.code,0);assert.match(missing.output,/prospecting_fixture_dependency_unavailable/);
});
