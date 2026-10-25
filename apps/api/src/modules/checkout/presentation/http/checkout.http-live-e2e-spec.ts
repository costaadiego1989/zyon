import test from "node:test";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../../../app.module.js";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { merchantRules } from "../../__tests__/checkout-test-fixtures.js";

const runHttpLive =
  process.env.RUN_REAL_AI_E2E === "true" &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY);

const HTTP_E2E_ENV = {} as const;

test(
  "real HTTP checkout e2e covers welcome, cadastro, OTP, freight, payment, and final confirmation",
  {
    skip: runHttpLive ? false : "Set RUN_REAL_AI_E2E=true, DATABASE_URL, and a chat API key to run the real HTTP checkout e2e."
  },
  async () => {
    const previousEnv = captureEnv(HTTP_E2E_ENV);
    Object.assign(process.env, HTTP_E2E_ENV);

    const prisma = createPrismaClient();
    const app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    const baseUrl = await app.getUrl();
    const merchantId = `mrc_http_${crypto.randomUUID()}`;
    const email = `${merchantId}@example.com`;
    const password = "secret123";

    try {
      const auth = await httpJson(`${baseUrl}/auth/register`, {
        method: "POST",
        body: {
          merchant_id: merchantId,
          merchant_name: "HTTP Matrix Store",
          email,
          password
        }
      });

      assert.equal(auth.merchant_id, merchantId);

      const rulesPatch = merchantRules({
        couponBoxEnabled: false,
        maxDiscountPercent: 10,
        allowStackDiscountAndFreeShipping: false,
        quickReplies: {
          data_collection: {
            nome: ["Posso informar meu nome"],
            email: ["Pode usar este e-mail", "Tenho outro e-mail"],
            telefone: ["Pode usar meu telefone", "Prefiro WhatsApp"]
          },
          payment: ["Tenho um cupom", "Prefiro PIX", "Prefiro cartão"]
        }
      });

      const updatedRules = await httpJson(`${baseUrl}/merchants/me/rules`, {
        method: "PUT",
        token: auth.access_token,
        body: rulesPatch
      });
      assert.equal(updatedRules.couponBoxEnabled, false);

      const settingsPatch = {
        mode: "proactive",
        widgetBehavior: { openWidgetOnTrigger: true },
        interventionPolicy: { cooldownSeconds: 60, maxInterventionsPerSession: 3, minimumAbandonmentScore: 0.4 },
        triggerRules: [
          { trigger: "coupon_field_clicked", enabled: true, priority: 100 },
          { trigger: "shipping_objection_detected", enabled: true, priority: 90 },
          { trigger: "payment_failed", enabled: true, priority: 80 }
        ],
        suppressionRules: {
          suppressedSteps: [],
          blockedRegions: [],
          suppressAfterOfferAccepted: true,
          respectBuyerOptOut: true
        },
        handoff: {
          enabled: true,
          message: "Se precisar, eu posso chamar um humano.",
          channels: ["chat"]
        }
      };

      const updatedSettings = await httpJson(`${baseUrl}/checkout-settings`, {
        method: "PUT",
        token: auth.access_token,
        body: settingsPatch
      });
      assert.equal(updatedSettings.mode, "proactive");

      const start = await httpJson(`${baseUrl}/start-checkout`, {
        method: "POST",
        body: {
          merchant_id: merchantId,
          session_id: `chk_http_${crypto.randomUUID()}`,
          customer: undefined,
          cart: {
            currency: "BRL",
            total: 300,
            items: [{ sku: "kit-http", name: "Kit HTTP", price: 300, cost: 120, quantity: 1 }]
          },
          shipping: undefined
        }
      });

      assert.equal(start.experience.stage, "data_collection");
      assert.equal(start.experience.copy.quick_replies.includes("Posso informar meu nome"), true);
      assert.equal(start.experience.rules.couponBoxEnabled, false);

      const chat1 = await httpJson(`${baseUrl}/chat/message`, {
        method: "POST",
        body: {
          merchant_id: merchantId,
          session_id: start.session_id,
          conversation_id: start.conversation_id,
          user_message: "Maria Silva Santos"
        }
      });
      assert.equal(chat1.stage, "data_collection");

      const chat2 = await httpJson(`${baseUrl}/chat/message`, {
        method: "POST",
        body: {
          merchant_id: merchantId,
          session_id: start.session_id,
          conversation_id: start.conversation_id,
          user_message: "maria.http@test.com"
        }
      });
      assert.equal(chat2.stage, "data_collection");

      const sessionAfterEmail = await httpJson(`${baseUrl}/checkout/${merchantId}/${start.session_id}`);
      const otpCode = sessionAfterEmail.customer?.otp_code;
      assert.ok(otpCode, "gerou codigo de verificacao por email");

      await httpJson(`${baseUrl}/chat/message`, {
        method: "POST",
        body: {
          merchant_id: merchantId,
          session_id: start.session_id,
          conversation_id: start.conversation_id,
          user_message: otpCode
        }
      });

      const chatCpf = await httpJson(`${baseUrl}/chat/message`, {
        method: "POST",
        body: {
          merchant_id: merchantId,
          session_id: start.session_id,
          conversation_id: start.conversation_id,
          user_message: "529.982.247-25"
        }
      });
      assert.equal(chatCpf.stage, "data_collection");

      const chatPhone = await httpJson(`${baseUrl}/chat/message`, {
        method: "POST",
        body: {
          merchant_id: merchantId,
          session_id: start.session_id,
          conversation_id: start.conversation_id,
          user_message: "(21) 99300-1883"
        }
      });
      assert.equal(chatPhone.stage, "shipping");

      await httpJson(`${baseUrl}/chat/message`, {
        method: "POST",
        body: {
          merchant_id: merchantId,
          session_id: start.session_id,
          conversation_id: start.conversation_id,
          user_message: "CEP 01310-100"
        }
      });

      const shippingAddr = await httpJson(`${baseUrl}/chat/message`, {
        method: "POST",
        body: {
          merchant_id: merchantId,
          session_id: start.session_id,
          conversation_id: start.conversation_id,
          user_message: "1500, apartamento 42"
        }
      });
      assert.equal(shippingAddr.stage, "payment");
      assert.equal(shippingAddr.experience.copy.quick_replies.includes("Tenho um cupom"), false);

      const shippingEval = await httpJson(`${baseUrl}/shipping/evaluate`, {
        method: "POST",
        body: {
          merchant_id: merchantId,
          session_id: start.session_id,
          cart_value: 300,
          shipping_price: 39,
          shipping_real_cost: 37,
          abandonment_score: 0.9
        }
      });
      assert.equal(shippingEval.approved, true);

      const offerApply = await httpJson(`${baseUrl}/offers/apply`, {
        method: "POST",
        body: {
          merchant_id: merchantId,
          session_id: start.session_id,
          offer_id: shippingEval.offer.id
        }
      });
      assert.equal(offerApply.success, true);

      const finalChat = await httpJson(`${baseUrl}/chat/message`, {
        method: "POST",
        body: {
          merchant_id: merchantId,
          session_id: start.session_id,
          conversation_id: start.conversation_id,
          user_message: "Prefiro PIX para finalizar"
        }
      });
      assert.equal(finalChat.stage, "payment");
      assert.equal(Array.isArray(finalChat.actions), true);

      const complete = await httpJson(`${baseUrl}/orders/complete`, {
        method: "POST",
        body: {
          merchant_id: merchantId,
          session_id: start.session_id,
          external_order_id: `ord_http_${crypto.randomUUID()}`,
          order_total: 300,
          currency: "BRL",
          accepted_offer_id: shippingEval.offer.id
        }
      });
      assert.equal(complete.recorded, true);

      const finalSession = await httpJson(`${baseUrl}/checkout/${merchantId}/${start.session_id}`);
      assert.equal(finalSession.chatHistory.length >= 6, true);
      assert.equal(finalSession.customer.email_verified, true);
    } finally {
      await app.close();
      await cleanupMerchant(prisma, merchantId);
      await prisma.$disconnect();
      restoreEnv(previousEnv);
    }
  }
);

async function httpJson(url: string, options: { method?: string; body?: unknown; token?: string } = {}) {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text}`);
  }
  return text ? (JSON.parse(text) as any) : undefined;
}

function captureEnv(keys: Record<string, string>) {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of Object.keys(keys)) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function cleanupMerchant(prisma: ReturnType<typeof createPrismaClient>, merchantId: string): Promise<void> {
  await prisma.outboxMessage.deleteMany({ where: { merchantId } });
  await prisma.acceptedOffer.deleteMany({ where: { merchantId } });
  await prisma.completedOrder.deleteMany({ where: { merchantId } });
  await prisma.authorizedOffer.deleteMany({ where: { merchantId } });
  await prisma.checkoutEvent.deleteMany({ where: { merchantId } });
  await prisma.checkoutSession.deleteMany({ where: { merchantId } });
  await prisma.buyerIdentity.deleteMany({ where: { merchantId } });
  await prisma.merchantRule.deleteMany({ where: { merchantId } });
  await prisma.merchantUser.deleteMany({ where: { merchantId } });
  await prisma.merchant.deleteMany({ where: { id: merchantId } });
  await prisma.checkoutSetting.deleteMany({ where: { merchantId } });
}
