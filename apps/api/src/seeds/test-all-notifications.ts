/**
 * Test ALL notification templates by sending them directly via BubbleWhats and Resend.
 * Sends: order confirmation, order shipped, order delivered — both email and WhatsApp.
 *
 * Usage:
 *   cd apps/api && npx tsx src/seeds/test-all-notifications.ts
 */
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: resolve(import.meta.dirname ?? ".", "../../.env") });

const BUYER_EMAIL = "costaadiego1989@gmail.com";
const BUYER_PHONE = "21993001883";
const BUYER_NAME = "Diego";

const BUBBLEWHATS_URL = process.env.BUBBLEWHATS_API_URL || "https://7071.bubblewhats.com";
const BUBBLEWHATS_TOKEN = process.env.BUBBLEWHATS_TOKEN || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || "noreply@zyon.com.br";

// ── WhatsApp sender ─────────────────────────────────────────────────────────

async function sendWhatsApp(phone: string, message: string): Promise<boolean> {
  const cleanDigits = phone.replace(/\D/g, "");
  const number = cleanDigits.startsWith("55") ? cleanDigits : `55${cleanDigits}`;
  const jid = `${number}@s.whatsapp.net`;

  const resp = await fetch(`${BUBBLEWHATS_URL}/send-message`, {
    method: "POST",
    headers: { Authorization: BUBBLEWHATS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ jid, message }),
  });

  if (resp.ok) {
    console.log(`  ✅ WhatsApp sent to ${number}`);
    return true;
  }
  console.log(`  ❌ WhatsApp failed: ${resp.status} ${await resp.text()}`);
  return false;
}

// ── Email sender ────────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log(`  ⚠️  Email skipped (RESEND_API_KEY not set). Subject: "${subject}"`);
    return false;
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  });

  if (resp.ok) {
    console.log(`  ✅ Email sent to ${to}`);
    return true;
  }
  console.log(`  ❌ Email failed: ${resp.status} ${await resp.text()}`);
  return false;
}

// ── Import templates ────────────────────────────────────────────────────────

const { renderOrderConfirmationTemplate, renderOrderConfirmationWhatsApp } =
  await import("../modules/notifications/infrastructure/templates/order-confirmation.template.js");

const { renderOrderShippedTemplate, renderOrderShippedWhatsApp } =
  await import("../modules/notifications/infrastructure/templates/order-shipped.template.js");

const { renderOrderDeliveredTemplate, renderOrderDeliveredWhatsApp } =
  await import("../modules/notifications/infrastructure/templates/order-delivered.template.js");

// ── Send all notifications ──────────────────────────────────────────────────

async function main() {
  console.log("🔔 Sending all notification templates...\n");
  console.log(`📧 Email: ${BUYER_EMAIL}`);
  console.log(`📱 WhatsApp: +55${BUYER_PHONE}`);
  console.log(`🔑 Resend: ${RESEND_API_KEY ? "configured" : "NOT SET (emails will be skipped)"}`);
  console.log(`🔑 BubbleWhats: ${BUBBLEWHATS_TOKEN ? "configured" : "NOT SET"}\n`);

  // ── 1. Order Confirmation ───────────────────────────────────────────────
  console.log("━━━ 1/3 PEDIDO CONFIRMADO ━━━");

  const confirmationEvent = {
    type: "ORDER_CONFIRMATION" as const,
    merchantId: "test_001",
    merchantName: "Zyon Store",
    orderId: "ord_test_001",
    buyerEmail: BUYER_EMAIL,
    buyerName: BUYER_NAME,
    buyerPhone: BUYER_PHONE,
    orderNumber: "ORD-2026-001",
    items: [
      { name: "Camiseta Premium Preta", quantity: 2, price: "R$ 49,90" },
      { name: "Calça Jogger Cinza", quantity: 1, price: "R$ 60,10" },
      { name: "Tênis Runner X", quantity: 1, price: "R$ 459,90" },
    ],
    total: "R$ 619,80",
    currency: "BRL",
  };

  await sendEmail(BUYER_EMAIL, `Pedido #ORD-2026-001 Confirmado`, renderOrderConfirmationTemplate(confirmationEvent));
  await sendWhatsApp(BUYER_PHONE, renderOrderConfirmationWhatsApp(confirmationEvent));

  // Wait between messages to not flood
  await new Promise((r) => setTimeout(r, 2000));

  // ── 2. Order Shipped ────────────────────────────────────────────────────
  console.log("\n━━━ 2/3 PEDIDO ENVIADO ━━━");

  const shippedEvent = {
    type: "ORDER_SHIPPED" as const,
    merchantId: "test_001",
    merchantName: "Zyon Store",
    orderId: "ord_test_001",
    buyerEmail: BUYER_EMAIL,
    buyerName: BUYER_NAME,
    buyerPhone: BUYER_PHONE,
    trackingNumber: "BR123456789ME",
    carrier: "Correios - SEDEX",
    estimatedDelivery: "20/08/2026",
  };

  await sendEmail(BUYER_EMAIL, `Seu Pedido Foi Enviado - Rastreie Aqui`, renderOrderShippedTemplate(shippedEvent));
  await sendWhatsApp(BUYER_PHONE, renderOrderShippedWhatsApp(shippedEvent));

  // Wait between messages
  await new Promise((r) => setTimeout(r, 2000));

  // ── 3. Order Delivered ──────────────────────────────────────────────────
  console.log("\n━━━ 3/3 PEDIDO ENTREGUE ━━━");

  const deliveredEvent = {
    type: "ORDER_DELIVERED" as const,
    merchantId: "test_001",
    merchantName: "Zyon Store",
    orderId: "ord_test_001",
    buyerEmail: BUYER_EMAIL,
    buyerName: BUYER_NAME,
    buyerPhone: BUYER_PHONE,
  };

  await sendEmail(BUYER_EMAIL, `Seu Pedido Foi Entregue!`, renderOrderDeliveredTemplate(deliveredEvent));
  await sendWhatsApp(BUYER_PHONE, renderOrderDeliveredWhatsApp(deliveredEvent));

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ Todas as notificações enviadas!");
  console.log("Confira seu WhatsApp e email.");
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
