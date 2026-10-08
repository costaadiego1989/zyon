import pg from 'pg';

// Release diagnostic: read only, no provider writes and no buyer credentials.
const prefix = process.argv[2];
const fixtures = prefix === '--fixtures';
if (fixtures && process.env.RAILWAY_ENVIRONMENT_ID !== 'a347216c-86e3-4a75-8d73-5ae6e122408c') throw new Error('fixture_audit_requires_sandbox');
if (!fixtures && (!prefix || !/^[a-zA-Z0-9_-]{5,80}$/.test(prefix))) throw new Error('payment_prefix_required');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query('BEGIN READ ONLY');
  if (fixtures) {
    const rows = (await db.query(`SELECT m.id, m.store_slug, u.id AS owner_user_id, u.email AS owner_email
      FROM merchants m JOIN merchant_users u ON u.merchant_id=m.id AND u.role='owner'
      WHERE m.name LIKE 'QA Pos-venda %' AND u.email LIKE 'returns-qa-%@example.test' LIMIT 5`)).rows;
    console.log(`return_sandbox_fixtures ${JSON.stringify(rows)}`);
    await db.query('ROLLBACK');
  } else {
  const rows = (await db.query(`SELECT p.id, p.provider_payment_id, p.status,
    p.amount_cents, p.approved_amount_cents, p.currency, p.method, p.created_at,
    m.store_slug AS store_slug, o.external_order_id, o.completed_at,
    (SELECT count(*)::int FROM buyer_purchase_records b WHERE b.merchant_id=p.merchant_id AND b.order_id=o.external_order_id) AS buyer_records,
    (SELECT count(*)::int FROM returns r WHERE r.merchant_id=p.merchant_id AND r.order_id=o.external_order_id) AS return_count
    FROM payment_intents p LEFT JOIN merchants m ON m.id=p.merchant_id
    LEFT JOIN completed_orders o ON o.merchant_id=p.merchant_id AND o.session_id=p.session_id
    WHERE p.provider_payment_id LIKE $1 ORDER BY p.created_at DESC LIMIT 5`, [`${prefix}%`])).rows;
  console.log(`return_purchase_readonly ${JSON.stringify(rows)}`);
  await db.query('ROLLBACK');
  }
} finally { await db.end(); }
