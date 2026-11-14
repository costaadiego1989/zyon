const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
for (const app of ['storefront', 'widget_v2']) {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../', app, 'vercel.json'), 'utf8'));
  test(`${app} Vercel installs the reviewed lockfile without dependency resolution drift`, () => {
    assert.equal(config.installCommand, 'pnpm install --frozen-lockfile');
  });
  test(`${app} builds contracts before consumers`, () => {
    const contracts = config.buildCommand.indexOf('--filter @zyon/contracts build');
    const consumer = config.buildCommand.indexOf('--filter @zyon/widget-v2 build');
    assert.ok(contracts >= 0 && consumer > contracts);
  });
}
