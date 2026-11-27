// Dedicated local fixtures only. Prevent generated clients from filling missing
// configuration from a developer .env, and forbid external sockets/fetch.
import { readFileSync } from 'node:fs';
const keep = new Set(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC']);
for (const name of Object.keys(process.env)) if (!keep.has(name)) delete process.env[name];
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback_seed_qa_candidate',
  LOG_LEVEL: 'silent', REDIS_URL: '', REDIS_ENABLED: 'false', STRIPE_ENABLED: 'false', ASAAS_ENABLED: 'false', METRICS_ENABLED: 'false',
  JWT_SECRET: 'cashback-local-qa-merchant-secret-20261114',
  BUYER_JWT_SECRET: 'cashback-local-qa-buyer-secret-20261114',
  EMBED_TOKEN_SECRET: readFileSync('C:/tmp/cashback-candidate-embed-secret.private.txt', 'utf8').trim(),
  INTERNAL_SERVICE_TOKEN: 'qa-cashback-candidate-internal-20261114',
  OPENROUTER_API_KEY: 'qa-cashback-local-dummy-never-send',
  AACP_PAYMENT_ENC_KEY: '11'.repeat(32), AACP_PII_ENC_KEY: '22'.repeat(32),
});
await import('./cashback-release-candidate-network-guard.mjs');
