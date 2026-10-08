/**
 * Post-generate fix: adds missing type stubs that Orval references
 * but NestJS/Swagger didn't generate schemas for.
 *
 * Run automatically after `orval` via the generate script.
 */
const fs = require('fs');
const path = require('path');

const SCHEMAS_FILE = path.join(__dirname, '..', 'src', 'generated', 'aACPIntegrationAPI.schemas.ts');

if (!fs.existsSync(SCHEMAS_FILE)) {
  console.log('⚠️  No schemas file found — skipping post-generate fix');
  process.exit(0);
}

const MISSING_TYPES = `
// ─── Auto-generated stubs for referenced but undefined schemas ───
export type Order = Record<string, unknown>;
export type OrderDetail = Record<string, unknown>;
export type CustomerDetail = Record<string, unknown>;
export type PaymentSummary = Record<string, unknown>;
export type WebhookEndpoint = Record<string, unknown>;
export type CommerceConnection = Record<string, unknown>;
`;

let content = fs.readFileSync(SCHEMAS_FILE, 'utf8');

// Only add if not already present
if (!content.includes('// ─── Auto-generated stubs')) {
  content += MISSING_TYPES;
  fs.writeFileSync(SCHEMAS_FILE, content);
  console.log('✅ Added missing type stubs to schemas');
} else {
  console.log('✅ Type stubs already present');
}
