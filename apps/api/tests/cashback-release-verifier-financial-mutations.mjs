import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

if (process.env.CASHBACK_FINANCIAL_VERIFIER_FROZEN !== 'true') throw new Error('coordinator_source_freeze_required');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = process.env.CASHBACK_FINANCIAL_VERIFIER_EVIDENCE ?? 'C:/Users/Admin/Desktop/AACP/.specs/features/cashback-release/evidence';
mkdirSync(evidence, { recursive: true });
const proofFile = './apps/api/tests/cashback-release-verifier-financial.spec.ts';
const cases = [
  { file: 'apps/api/src/modules/cashback/domain/cashback-combination.ts', old: 'combinedCapCents - commercialCents', new: 'combinedCapCents', pattern: 'FIN-03',
    label: 'Financial combined cap deducts the embedded promotion and actual commercial discounts before cashback' },
  { file: 'apps/api/src/modules/coupons/infrastructure/repositories/prisma-bound-coupon-redemption.ts', old: 'a.discountCents / 100', new: 'checkoutCouponCombinedDiscountCents(a) / 100', pattern: 'FIN-02',
    label: 'V2 coupon receipt redeems C777, not combined D1110' },
  { file: 'apps/api/src/modules/payment/application/resume-payment-creation.service.ts',
    old: '(before.amountBreakdown?.cashbackCents ?? 0) > 0 || before.amountBreakdown?.cashbackEarningQuoteId',
    new: 'false && ((before.amountBreakdown?.cashbackCents ?? 0) > 0 || before.amountBreakdown?.cashbackEarningQuoteId)', pattern: 'FIN-08',
    label: 'A missing earning quote refuses worker dispatch before its PSP stub is reached' },
].map(item => ({ ...item, proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern=${item.pattern} ${proofFile}` }));
const sha = file => createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
const results = [];
for (const [index, item] of cases.entries()) {
  const args = ['--import', './apps/api/tests/test-network-guard.mjs', '--loader', './apps/api/tests/ready-prod-loader.mjs',
    '--test', `--test-name-pattern=${item.pattern}`, proofFile];
  const beforeSha256 = sha(item.file);
  const baseline = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 180000 });
  const baselineOutput = `${baseline.stdout ?? ''}${baseline.stderr ?? ''}`;
  writeFileSync(resolve(evidence, `verifier-financial-mutation-${index + 1}-baseline.log`), baselineOutput);
  const baselinePassed = baseline.status === 0 && /# pass [1-9]/.test(baselineOutput) && /# fail 0/.test(baselineOutput);
  const mutated = spawnSync(process.execPath, ['--import', './apps/api/tests/test-network-guard.mjs',
    '--loader', './apps/api/tests/ready-prod-loader.mjs', '--loader', './apps/api/tests/cashback-release-verifier-financial-mutator.mjs', ...args.slice(4)],
    { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, CASHBACK_FINANCIAL_VERIFIER_MUTATION: String(index) } });
  const output = `${mutated.stdout ?? ''}${mutated.stderr ?? ''}`;
  writeFileSync(resolve(evidence, `verifier-financial-mutation-${index + 1}.log`), output);
  const afterSha256 = sha(item.file), applied = output.includes(`[CASHBACK_FINANCIAL_VERIFIER_MUTATION:${index}]`);
  const assertionFailed = /not ok \d/.test(output) && /ERR_ASSERTION/.test(output);
  const killed = baselinePassed && applied && mutated.status !== 0 && assertionFailed && beforeSha256 === afterSha256;
  results.push({ ...item, method: 'isolated ESM loader; child-process memory only, not mutate.py',
    baselinePassed, applied, exitCode: mutated.status, assertionFailed, beforeSha256, afterSha256, killed });
  process.stdout.write(JSON.stringify({ index: index + 1, baselinePassed, applied, killed }) + '\n');
}
writeFileSync(resolve(evidence, 'verifier-financial-mutations-results.json'), JSON.stringify(results, null, 2) + '\n');
writeFileSync(resolve(evidence, 'verifier-financial-mutation-plan.json'), JSON.stringify(cases, null, 2) + '\n');
process.exitCode = results.every(row => row.killed) ? 0 : 1;
