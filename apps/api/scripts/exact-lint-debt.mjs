import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {relative,resolve,isAbsolute} from 'node:path';

const rules=new Set(['no-restricted-imports','boundaries/element-types']);
export const debtKey=(file,ruleId,statement)=>JSON.stringify([file,ruleId,statement]);
export function evaluateExactLintDebt(results,ledger,apiRoot){
  assert.equal(ledger.version,1);assert.equal(ledger.scope,'EXACT_PINNED_HISTORICAL_ARCHITECTURE_IMPORTS_ONLY');
  const ts=createRequire(resolve(apiRoot,'package.json'))('typescript'),allowed=new Map(),used=new Map();
  for(const entry of ledger.entries){
    assert.ok(entry.file.startsWith('src/')&&!entry.file.includes('..')&&!isAbsolute(entry.file));
    assert.ok(rules.has(entry.ruleId));assert.ok(Number.isSafeInteger(entry.count)&&entry.count>0);
    assert.equal(createHash('sha256').update(entry.statement).digest('hex'),entry.statementSha256);
    const key=debtKey(entry.file,entry.ruleId,entry.statement);assert.equal(allowed.has(key),false);allowed.set(key,entry.count);
  }
  assert.equal([...allowed.values()].reduce((n,count)=>n+count,0),ledger.occurrences);
  const accepted=[],blocking=[],warnings=[];
  for(const result of results){
    const file=relative(apiRoot,result.filePath).replaceAll('\\','/');
    const errors=result.messages.filter(message=>message.severity===2);
    warnings.push(...result.messages.filter(message=>message.severity===1).map(message=>({file,...message})));
    if(!errors.length)continue;
    const source=result.source??readFileSync(result.filePath,'utf8'),parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),imports=[];
    const visit=node=>{
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)imports.push({
        start:parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line+1,
        end:parsed.getLineAndCharacterOfPosition(node.end).line+1,statement:source.slice(node.getStart(parsed),node.end)});
      ts.forEachChild(node,visit);
    };visit(parsed);
    for(const message of errors){
      const statement=imports.find(entry=>entry.start<=message.line&&message.line<=entry.end)?.statement;
      const key=statement&&debtKey(file,message.ruleId,statement),count=key?(used.get(key)??0):0,budget=key?allowed.get(key):undefined;
      if(rules.has(message.ruleId)&&budget!==undefined&&count<budget){used.set(key,count+1);accepted.push({file,ruleId:message.ruleId,line:message.line,key});}
      else blocking.push({file,...message,reason:!rules.has(message.ruleId)?'OTHER_RULE_OR_FATAL':budget===undefined?'NEW_FILE_OR_CHANGED_IMPORT':'DEBT_OCCURRENCE_BUDGET_EXCEEDED'});
    }
  }
  return {actualEslintErrors:accepted.length+blocking.length,acceptedHistoricalOccurrences:accepted.length,blocking,warnings,
    unusedHistoricalBudget:ledger.occurrences-accepted.length,fullEslintClean:accepted.length===0&&blocking.length===0,
    policyAccepted:blocking.length===0};
}
