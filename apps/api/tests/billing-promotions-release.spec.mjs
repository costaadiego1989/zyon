import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
test('automatic-campaign migration is included in the history actually used by deploy', () => {
  const config = readFileSync(new URL('prisma.config.ts', root), 'utf8');
  assert.match(config, /path:\s*"prisma\/deploy-migrations"/);
  const migration = '20261016010000_billing_promotion_auto_apply/migration.sql';
  const deployed = readFileSync(new URL('prisma/deploy-migrations/' + migration, root), 'utf8').replace(/\r\n/g, '\n');
  const history = readFileSync(new URL('prisma/migrations/' + migration, root), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(deployed, history);
  assert.match(deployed, /"auto_apply" BOOLEAN NOT NULL DEFAULT false/);
});
