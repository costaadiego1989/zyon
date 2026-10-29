import pg from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Release evidence only: private-network SELECTs and provider GETs. No mutation.
const [orderId, returnId] = process.argv.slice(2);
if (!/^pi_[A-Za-z0-9]+$/.test(orderId ?? "") || !/^[A-Za-z0-9_-]{8,100}$/.test(returnId ?? "")) throw new Error("refund_audit_identity_required");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  const sourceFiles = ["src/modules/payment/domain/payment-provider-route.ts", "src/modules/payment/infrastructure/stripe-payment.adapter.ts",
    "src/modules/returns/application/use-cases/process-refund.use-case.ts", "src/modules/returns/presentation/http/support-case.controller.ts"];
  console.log("refund_release_source " + JSON.stringify(Object.fromEntries(sourceFiles.map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")]))));
  await db.connect(); await db.query("BEGIN READ ONLY"); await db.query("SET LOCAL statement_timeout = '5s'");
  const rows = (await db.query(`SELECT r.id, r.merchant_id, r.order_id, r.status, rr.status AS refund_status,
    rr.amount_in_cents, rr.provider_refund_id, rr.created_at AS attempt_created_at,
    p.id AS payment_id, p.provider_payment_id, p.currency, p.approved_amount_cents,
    p.creation->'input'->>'stripeConnectAccountId' AS original_account,
    p.creation->'input'->>'stripeChargeMode' AS original_charge_mode,
    p.creation->'input'->>'provider' AS original_provider,
    p.creation->'input'->>'providerAccountFingerprint' AS original_fingerprint
    FROM returns r JOIN return_refunds rr ON rr.return_id=r.id
    JOIN payment_intents p ON p.id=rr.payment_intent_id AND p.merchant_id=r.merchant_id
    WHERE r.id=$1 AND r.order_id=$2 AND p.provider_payment_id=$2`, [returnId, orderId])).rows;
  await db.query("ROLLBACK");
  const row = rows.length === 1 ? rows[0] : null;
  if (!row) throw new Error("refund_audit_original_payment_unproven");
  const fingerprintMatches = row.original_fingerprint === createHash("sha256").update(process.env.STRIPE_SECRET_KEY ?? "").digest("hex");
  const { original_fingerprint: _fingerprint, ...safe } = row;
  console.log("refund_incident_readonly " + JSON.stringify({ ...safe, fingerprintMatches, financialPosts: 0 }));
  if (!fingerprintMatches || row.original_provider !== "stripe" || row.original_charge_mode !== "direct_v2" || !/^acct_[A-Za-z0-9]+$/.test(row.original_account ?? "")) throw new Error("refund_audit_original_route_unproven");
  const headers = { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Stripe-Account": row.original_account };
  const get = async route => {
    const response = await fetch("https://api.stripe.com/v1/" + route, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("refund_audit_provider_read_failed_" + response.status);
    return response.json();
  };
  const payment = await get("payment_intents/" + orderId + "?expand[]=latest_charge");
  const refunds = await get("refunds?payment_intent=" + orderId + "&limit=100");
  console.log("refund_provider_readonly " + JSON.stringify({ orderId, returnId, financialPosts: 0, originalIdentityMatches:
    payment.id === orderId && payment.metadata?.merchant_id === row.merchant_id && payment.metadata?.intent_id === row.payment_id,
    status: payment.status, amountReceived: payment.amount_received, amountRefunded: payment.latest_charge?.amount_refunded,
    refunds: refunds.data.map(refund => ({ id: refund.id, status: refund.status, amount: refund.amount })), complete: refunds.has_more === false }));
} catch (error) {
  console.log("refund_audit_unavailable " + (error instanceof Error && /^refund_audit_[a-z0-9_]+$/.test(error.message) ? error.message : "read_unavailable"));
} finally { await db.end().catch(() => undefined); }
