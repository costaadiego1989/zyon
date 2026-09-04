import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env") });

import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";

const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";
const NGROK_URL = process.env.NGROK_URL || "";
const DEVICE_ID = process.env.BUBBLEWHATS_ID?.trim() || "";
const API_URL = process.env.BUBBLEWHATS_API_URL?.trim() || "";
const TOKEN = process.env.BUBBLEWHATS_TOKEN?.trim() || "";

async function main() {
  if (!NGROK_URL) { console.log("✗ NGROK_URL env not set"); return; }
  if (!DEVICE_ID) { console.log("✗ BUBBLEWHATS_ID not set"); return; }

  const prisma = createPrismaClient();
  const webhookSecret = "qa-webhook-secret-" + DEVICE_ID;

  // 1. Enable + configure the merchant's WhatsApp channel config
  console.log("═══ STEP 1: Configure DB whatsapp_channel_config ═══");
  const existing = await (prisma as any).whatsAppChannelConfig?.findFirst({ where: { merchantId: MERCHANT_ID } });

  if (existing) {
    await (prisma as any).whatsAppChannelConfig.update({
      where: { id: existing.id },
      data: { enabled: true, deviceId: DEVICE_ID, webhookSecret, provider: "BUBBLEWHATS", status: "connected" },
    });
    console.log(`✓ Updated config: deviceId=${DEVICE_ID}, enabled=true, provider=BUBBLEWHATS`);
  } else {
    await (prisma as any).whatsAppChannelConfig.create({
      data: { merchantId: MERCHANT_ID, enabled: true, deviceId: DEVICE_ID, webhookSecret, provider: "BUBBLEWHATS", status: "connected" },
    });
    console.log(`✓ Created config: deviceId=${DEVICE_ID}`);
  }

  // 2. Register webhook URL with BubbleWhats API
  console.log("\n═══ STEP 2: Register webhook with BubbleWhats ═══");
  const webhookUrl = `${NGROK_URL}/webhooks/whatsapp/bubblewhats/messages`;
  console.log(`  Webhook URL: ${webhookUrl}`);
  console.log(`  Webhook secret: ${webhookSecret}`);

  // Try common BubbleWhats webhook-set endpoints
  const endpoints = ["/set-webhook", "/webhook", "/config/webhook"];
  let registered = false;
  for (const ep of endpoints) {
    try {
      const res = await fetch(`${API_URL}${ep}`, {
        method: "POST",
        headers: { Authorization: TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ webhook: webhookUrl, url: webhookUrl, secret: webhookSecret, events: ["message"] }),
      });
      console.log(`  ${ep} → ${res.status}`);
      if (res.ok) { registered = true; console.log(`  ✓ Registered via ${ep}`); break; }
    } catch (e) {
      console.log(`  ${ep} → error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!registered) {
    console.log("\n  ⚠ Could not auto-register webhook via API.");
    console.log("  → Configure MANUALLY in the BubbleWhats panel:");
    console.log(`    URL: ${webhookUrl}`);
    console.log(`    Header x-webhook-secret: ${webhookSecret}`);
  }

  await prisma.$disconnect();
  console.log("\n═══ DONE ═══");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
