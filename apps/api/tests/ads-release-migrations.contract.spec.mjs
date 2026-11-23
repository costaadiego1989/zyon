import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('production migration history includes the additive ads attribution indexes', async () => {
  const config = await readFile(new URL('../prisma.config.ts', import.meta.url), 'utf8');
  assert.match(config, /path:\s*"prisma\/deploy-migrations"/);
  const name = '20261122120000_ads_attribution_touches/migration.sql';
  const shipped = await readFile(new URL('../prisma/deploy-migrations/' + name, import.meta.url), 'utf8');
  const verified = await readFile(new URL('../prisma/migrations/' + name, import.meta.url), 'utf8');
  assert.equal(shipped.replaceAll('\r\n', '\n'), verified.replaceAll('\r\n', '\n'));
  assert.match(shipped, /CREATE INDEX "meta_ads_attribution_touch_session_idx"/);
  assert.match(shipped, /CREATE INDEX "meta_ads_attribution_touch_id_idx"/);
  assert.doesNotMatch(shipped, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
});
