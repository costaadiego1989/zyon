import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {evaluateExactLintDebt} from './exact-lint-debt.mjs';

const api=fileURLToPath(new URL('../',import.meta.url));
assert.equal(resolve(process.cwd()),resolve(api),'normal_api_lint_cwd_required');
const raw=readFileSync(resolve(api,'eslint-historical-debt.json'));
const ledger=JSON.parse(raw),hash=createHash('sha256').update(raw).digest('hex');
assert.equal(createHash('sha256').update(readFileSync(resolve(api,'eslint.config.mjs'))).digest('hex'),
  ledger.eslintConfigSha256,'reviewed_eslint_rules_must_remain_byte_exact');
// This file can only be written from the actual approval after the concrete
// ledger has been reviewed. Missing authority is a failure, never an opt-in flag.
const authority=JSON.parse(readFileSync(resolve(api,'eslint-historical-debt.approval.json'),'utf8'));
assert.equal(authority.kind,'ACTUAL_USER_APPROVED_EXACT_HISTORICAL_LINT_DEBT');
assert.equal(authority.ledgerSha256,hash);assert.equal(authority.occurrences,ledger.occurrences);
assert.match(authority.rawApprovalSha256,/^[a-f0-9]{64}$/);
assert.ok(Array.isArray(authority.questionReference)&&authority.questionReference.length===3);
assert.ok(typeof authority.selectedAnswer==='string'&&authority.selectedAnswer.trim());
const {ESLint}=createRequire(resolve(api,'package.json'))('eslint');
const eslint=new ESLint({cwd:api}),results=await eslint.lintFiles(['src']);
const report=evaluateExactLintDebt(results,ledger,api);
const formatter=await eslint.loadFormatter('stylish');process.stdout.write(formatter.format(results));
console.log(JSON.stringify({kind:'ACTUAL_WHOLE_ESLINT_WITH_USER_APPROVED_EXACT_HISTORICAL_DEBT',ledgerSha256:hash,
  ...report,claim:'A debt-policy pass does not claim absolute full ESLint cleanliness.'}));
process.exitCode=report.policyAccepted?0:1;
