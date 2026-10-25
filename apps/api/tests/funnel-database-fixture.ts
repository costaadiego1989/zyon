import { PrismaClient } from "@prisma/client";

// Fixed local, disposable database. Never reads DATABASE_URL or application data.
export async function createFunnelDatabase() {
  const db = new PrismaClient({ datasources: { db: { url: "postgresql://funnel_audit:funnel-local-only@127.0.0.1:55441/funnel_audit" } } });
  for (const statement of [
    `CREATE TABLE IF NOT EXISTS checkout_sessions (
      id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, session_id TEXT NOT NULL,
      global_user_id TEXT NOT NULL, conversation_id TEXT NOT NULL, cart JSONB NOT NULL,
      customer JSONB, shipping JSONB, shipping_options JSONB, abandonment_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      trigger_agent BOOLEAN NOT NULL DEFAULT false, chat_history JSONB NOT NULL DEFAULT '[]',
      prompt_variant_id TEXT, cohort TEXT, features_applied JSONB, ai_cost_cents INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL,
      UNIQUE(merchant_id,session_id))`,
    `CREATE TABLE IF NOT EXISTS checkout_events (
      id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, session_id TEXT NOT NULL,
      event_name TEXT NOT NULL, occurred_at TIMESTAMP NOT NULL, metadata JSONB,
      FOREIGN KEY (merchant_id,session_id) REFERENCES checkout_sessions(merchant_id,session_id) ON DELETE CASCADE)`,
  ]) await db.$executeRawUnsafe(statement);
  const merchantId = "funnel-audit-" + Date.now();
  const otherMerchant = merchantId + "-other";
  const at = new Date(Date.now() - 15 * 60_000);
  for (const [merchant, sessionId, old] of [
    [merchantId, "chk_paid", true], [merchantId, "chk_open", false],
    [merchantId, "conv_signup", false], [merchantId, "conv_login", true],
    [otherMerchant, "chk_paid", false], [otherMerchant, "conv_signup", false],
  ] as const) {
    await db.checkoutSession.create({ data: {
      merchantId: merchant, sessionId, globalUserId: merchant + sessionId,
      conversationId: sessionId, cart: { items: [] },
      createdAt: old ? new Date(at.getTime() - 40 * 86400_000) : at, updatedAt: new Date(),
    } });
  }
  const event = (sessionId: string, eventName: string, minutes = 0, metadata?: any, merchant = merchantId) =>
    db.checkoutEvent.create({ data: { merchantId: merchant, sessionId, eventName,
      occurredAt: new Date(at.getTime() + minutes * 60_000), metadata } });
  await event("chk_paid", "checkout_started", 0, { device: "mobile" });
  await event("chk_paid", "coupon_field_clicked", 1);
  await event("chk_paid", "payment_failed", 2);
  await event("chk_paid", "payment_method_selected", 3, { payment_method: "pix" });
  await event("chk_paid", "payment_method_selected", 4, { payment_method: "card" });
  await event("chk_paid", "order_completed", 5);
  await event("chk_paid", "order_completed", 6);
  await event("chk_open", "checkout_started");
  await event("chk_open", "shipping_option_selected", 2);
  await event("conv_signup", "auth_registration_completed", 3, { device: "desktop" });
  await event("conv_login", "login_completed", 4);
  await event("chk_paid", "order_completed", 0, {}, otherMerchant);
  await event("conv_signup", "auth_registration_completed", 0, {}, otherMerchant);
  return { db, merchantId, otherMerchant, event, range: { from: at.toISOString().slice(0, 10), to: at.toISOString().slice(0, 10) } };
}
