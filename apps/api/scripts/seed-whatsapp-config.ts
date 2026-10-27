/**
 * Quick seed: create WhatsAppChannelConfig for local testing.
 * Run: cd apps/api && npx tsx scripts/seed-whatsapp-config.ts
 */
import pg from "pg";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Find first merchant
  const { rows: merchants } = await pool.query("SELECT id, name FROM merchants ORDER BY created_at ASC LIMIT 1");
  if (!merchants.length) {
    console.error("No merchant found. Start the API with E2E seed first.");
    process.exit(1);
  }

  const merchant = merchants[0];
  console.log(`Found merchant: ${merchant.id} (${merchant.name})`);

  // Upsert WhatsApp config
  await pool.query(`
    INSERT INTO whatsapp_channel_configs ("id", "merchant_id", "enabled", "device_id", "phone_number", "webhook_secret", "created_at", "updated_at")
    VALUES (gen_random_uuid(), $1, true, '7071', '5511999999999', 'test-secret-local', now(), now())
    ON CONFLICT ("merchant_id") DO UPDATE SET "enabled" = true, "device_id" = '7071', "updated_at" = now()
  `, [merchant.id]);

  console.log("✅ WhatsAppChannelConfig created for deviceID=7071");
  console.log("Webhook will now process messages from BubbleWhats device 7071");

  // Verify
  const { rows } = await pool.query("SELECT * FROM whatsapp_channel_configs WHERE merchant_id = $1", [merchant.id]);
  console.log(JSON.stringify(rows[0], null, 2));
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => pool.end());
