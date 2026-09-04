# WhatsApp Commerce — Migration to Twilio Multi-Tenant

**Created:** 2026-08-21
**Decision:** Replace BubbleWhats (single-device) with Twilio (per-merchant numbers)
**Reason:** BubbleWhats não escala — 1 device = 1 merchant. Twilio Embedded Signup permite cada merchant conectar seu próprio número em 5 minutos.

---

## Architecture Change

### Before (BubbleWhats)
```
BubbleWhats Device 7071 → webhook → API → resolve by deviceID → 1 merchant
```

### After (Twilio Multi-Tenant)
```
Twilio Account (platform) → per-merchant phone numbers
  → Merchant A: whatsapp:+5521993001883
  → Merchant B: whatsapp:+5511999998888
  → Merchant C: whatsapp:+5531988887777

Each merchant webhook → API → resolve by "To" number → correct merchant
```

---

## What Changes

| Layer | Before | After |
|-------|--------|-------|
| **Provider** | BubbleWhats (unofficial API) | Twilio WhatsApp Business API |
| **Auth** | Single token for all | Per-merchant `accountSid + authToken + senderId` |
| **Onboarding** | Manual (merchant adds deviceID) | Embedded Signup (OAuth flow in dashboard) |
| **Webhook routing** | `deviceID` → merchant | `To` phone number → merchant |
| **Send message** | `POST /send-message { jid, message }` | `POST /Accounts/{sid}/Messages.json { To, From, Body }` |
| **Webhook format** | BubbleWhats JSON | Twilio form-encoded (`WaId`, `Body`, `MessageSid`) |
| **Signature validation** | Custom secret header | HMAC-SHA1 (Twilio standard) |
| **Cost** | ~R$97/device/month | ~$0.005/msg + free tier |
| **Reliability** | Unofficial (can break) | Official Meta partner |

---

## Implementation Plan

### Phase 1: Twilio Adapter (replace BubbleWhats sender)

**Files to change:**
- `whatsapp-channel/infrastructure/adapters/bubblewhats-sender.adapter.ts` → rename to `twilio-sender.adapter.ts`
- `whatsapp-channel/presentation/http/whatsapp-webhook.controller.ts` → accept Twilio format
- `whatsapp-channel/domain/ports/whatsapp-config-repository.port.ts` → add Twilio credentials fields

**New Prisma schema:**
```prisma
model WhatsAppChannelConfig {
  id              String   @id @default(uuid())
  merchantId      String   @unique
  enabled         Boolean  @default(false)
  provider        String   @default("twilio") // "twilio" | "meta_cloud"
  
  // Twilio credentials (per-merchant)
  twilioAccountSid  String?  @map("twilio_account_sid")
  twilioAuthToken   String?  @map("twilio_auth_token")  // encrypted
  twilioSenderId    String?  @map("twilio_sender_id")   // "whatsapp:+5521..."
  twilioPhoneNumber String?  @map("twilio_phone_number")
  
  // Connection status
  connectionStatus  String   @default("disconnected") // disconnected | pending | active | error
  connectedAt       DateTime? @map("connected_at")
  
  // Webhook
  webhookSecret     String   @map("webhook_secret")
  
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  merchant          Merchant @relation(fields: [merchantId], references: [id])

  @@map("whatsapp_channel_configs")
}
```

### Phase 2: Twilio Embedded Signup (Dashboard)

**Flow:**
1. Merchant goes to Dashboard → Integrações → WhatsApp
2. Clicks "Conectar WhatsApp Business"
3. Opens Twilio Embedded Signup popup (OAuth)
4. Merchant authorizes, enters phone, verifies OTP
5. Backend receives callback with `accountSid + authToken + senderId`
6. Stores per-merchant, sets `connectionStatus: "active"`
7. Webhook URL auto-registered on Twilio side

**Dashboard page:**
```
┌────────────────────────────────────────────┐
│ 📱 WhatsApp Commerce                       │
│                                            │
│ Status: 🟢 Conectado                       │
│ Número: +55 21 99300-1883                  │
│ Provider: Twilio WhatsApp Business         │
│                                            │
│ [Desconectar]  [Testar mensagem]           │
│                                            │
│ Métricas:                                  │
│ • Conversas hoje: 47                       │
│ • Taxa de conversão: 12%                   │
│ • Tempo médio resposta: 3s                 │
└────────────────────────────────────────────┘
```

### Phase 3: Webhook Processing (Twilio format)

**Twilio webhook payload (form-encoded):**
```
MessageSid=SM123...
From=whatsapp:+5521993001883
To=whatsapp:+5521989825798
Body=oi
WaId=5521993001883
ProfileName=Diego Costa
NumMedia=0
```

**Controller change:**
```typescript
@Post("twilio")
@HttpCode(200)
async receiveTwilioMessage(
  @Headers("x-twilio-signature") signature: string,
  @Body() body: Record<string, string>,
  @Req() req: any,
) {
  // 1. Find merchant by "To" number
  const toNumber = body.To?.replace("whatsapp:+", "");
  const config = await this.configRepo.findByPhoneNumber(toNumber);
  
  // 2. Validate Twilio signature (HMAC-SHA1)
  const isValid = this.twilioAdapter.validateSignature(
    signature, body, config, { requestUrl: fullUrl(req) }
  );
  
  // 3. Parse and process
  const fromNumber = body.WaId || body.From?.replace("whatsapp:+", "");
  await this.handleMessage.execute({
    merchantId: config.merchantId,
    fromNumber,
    fromAlias: body.ProfileName,
    body: body.Body,
    messageType: Number(body.NumMedia) > 0 ? "media" : "text",
    ...
  });
  
  return ""; // Twilio expects empty 200
}
```

### Phase 4: Send via Twilio

```typescript
async sendText(msg: WhatsAppOutboundMessage): Promise<WhatsAppSendResult> {
  const config = await this.configRepo.findByMerchantId(msg.merchantId);
  
  const params = new URLSearchParams();
  params.set("To", `whatsapp:+${msg.toNumber}`);
  params.set("From", config.twilioSenderId); // "whatsapp:+5521989825798"
  params.set("Body", msg.text);
  
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + btoa(`${config.twilioAccountSid}:${config.twilioAuthToken}`),
      },
      body: params.toString(),
    }
  );
  
  const data = await response.json();
  return { messageId: data.sid, status: response.ok ? "sent" : "failed" };
}
```

---

## Migration Steps

1. ✅ Keep current BubbleWhats code as-is (working for testing)
2. Add `provider` field to `WhatsAppChannelConfig` (default "twilio")
3. Create `TwilioSenderAdapter` implementing same `WhatsAppSenderPort`
4. Create `TwilioWebhookParser` for form-encoded → normalized message
5. Add Twilio signature validation
6. Dashboard: Embedded Signup page (OAuth popup)
7. Switch provider per-merchant based on `config.provider`
8. Deprecate BubbleWhats adapter (keep for local testing only)

---

## Twilio Embedded Signup — How It Works

```
Merchant clicks "Conectar" in Dashboard
  → Frontend opens Twilio popup: https://www.twilio.com/console/phone-numbers/embedded
  → Merchant enters phone number
  → Twilio sends OTP to that phone
  → Merchant enters OTP
  → Twilio callback to our API: { accountSid, authToken, phoneNumber }
  → API stores credentials encrypted per-merchant
  → Sets connectionStatus = "active"
  → Registers webhook URL on Twilio: POST https://our-api/v1/webhooks/twilio/whatsapp
  → Done! Messages now flow through Twilio
```

**From AtendeAi codebase:**
- `TwilioAdapter.validateSignature()` — HMAC-SHA1 validation
- `TwilioAdapter.parseInboundMessage()` — form-encoded → typed data
- `TwilioAdapter.sendMessage()` — Basic Auth + URLSearchParams
- Per-tenant credentials via `MessagingProviderConfig.credentials`

---

## Environment Variables (Platform-Level)

```env
# Twilio Platform Account (for Embedded Signup)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_STATUS_CALLBACK_URL=https://api.aacp.com/v1/webhooks/twilio/status

# Per-merchant credentials stored in DB (encrypted)
# NOT in .env — each merchant has their own after Embedded Signup
```

---

## Cost Comparison

| Volume | BubbleWhats | Twilio |
|--------|-------------|--------|
| 1 merchant, 100 msgs/day | R$97/mês | ~$15/mês |
| 10 merchants, 100 msgs/day each | R$970/mês (10 devices!) | ~$50/mês |
| 100 merchants | R$9,700/mês | ~$200/mês |
| 1000 merchants | Impossível | ~$1,500/mês |

**Twilio escala. BubbleWhats não.**

---

## Tasks

| # | Task | Scope | Depends |
|---|------|-------|---------|
| T-WA-M01 | Add `provider` + Twilio fields to schema | Schema | — |
| T-WA-M02 | Create `TwilioSenderAdapter` | Infrastructure | M01 |
| T-WA-M03 | Create Twilio webhook parser | Presentation | M01 |
| T-WA-M04 | Twilio signature validation | Domain | M02 |
| T-WA-M05 | Dashboard: Embedded Signup page | Dashboard | M01 |
| T-WA-M06 | Wire provider selection (twilio vs bubblewhats) | Module | M02, M03 |
| T-WA-M07 | Encrypt stored credentials | Infrastructure | M01 |
| T-WA-M08 | Register webhook on Twilio after signup | Application | M05 |

---

## Security

- `twilioAuthToken` stored **encrypted** in DB (AES-256-GCM with platform key)
- Webhook validated via HMAC-SHA1 on every request
- Credentials never exposed to frontend (dashboard shows only status + masked number)
- Token rotation: merchant can "Reconectar" to refresh credentials
