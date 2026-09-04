# WhatsApp Commerce Channel — Specification

**Created:** 2026-08-21
**Scope:** Complex (new bounded context, webhook integration, session management)
**Priority:** P1 — Next major feature after dashboard corrections sprint

---

## Overview

Permitir que clientes comprem produtos via WhatsApp usando o mesmo Conversation Engine do checkout widget. A API é headless — WhatsApp é mais um adapter de canal, assim como widget e M2M.

**Provider:** BubbleWhats (já integrado para envio — agora adicionamos recebimento via webhook)

---

## BubbleWhats Webhook Contract

### Receive Messages (POST para nosso endpoint)

```json
{
  "id": "02476EE0050F3AFF6BE4121E6482D3E1",
  "fromNumber": "5511999999999",
  "fromGroup": "120363194428321872@g.us",
  "fromAlias": "User display name",
  "toNumber": "5511999999999",
  "body": "Hello World. This is an example of message receipt",
  "caption": "This is a caption",
  "isGroup": false,
  "url": "https://7000.bubblewhats.com/medias/170987654321",
  "mimetype": "audio/mp3",
  "messageContext": {
    "key": {
      "remoteJid": "551199999999@s.whatsapp.net",
      "fromMe": true,
      "id": "3EB070F29262F96C2D852D"
    },
    "message": {
      "extendedTextMessage": { "text": "message test" }
    },
    "messageTimestamp": "1724963041",
    "status": "PENDING"
  },
  "key": "a2bA7j3ZOn5QKqFOPN0SnNsV1penxHt0jeMkDc2CIeU=",
  "degreesLatitude": -23.56135499361228,
  "degreesLongitude": -46.6558819,
  "messageType": "text",
  "deviceID": "7000",
  "timestamp": 1747937410
}
```

### Key Fields

| Campo | Tipo | Uso |
|-------|------|-----|
| `fromNumber` | string | Identificador do buyer (phone) |
| `toNumber` | string | Número do merchant (device) |
| `body` | string | Texto da mensagem (input para conversation engine) |
| `fromAlias` | string | Nome do buyer no WhatsApp |
| `messageType` | string | "text", "image", "audio", "video", "document", "location" |
| `url` | file | URL da mídia (24h expiry) |
| `mimetype` | string | Tipo da mídia |
| `deviceID` | string | ID do aparelho BubbleWhats |
| `isGroup` | boolean | Se veio de grupo (ignorar) |
| `messageContext` | object | Contexto para reply (responder à mensagem específica) |
| `timestamp` | unix | Momento do recebimento |

### Update Messages (POST para nosso endpoint)

```json
{
  "deviceID": "7500",
  "messages": [
    {
      "key": {
        "remoteJid": "5511999999999@s.whatsapp.net",
        "id": "5C3CE90BBCA955588F2AC6CC129E8C8A62",
        "fromMe": false
      },
      "update": {
        "status": 4
      }
    }
  ]
}
```

### Status Codes

| Code | Status | Descrição |
|------|--------|-----------|
| 0 | ERROR | Erro no processamento |
| 1 | PENDING | Criada, não enviada |
| 2 | SERVER-ACK | Enviada ao servidor WhatsApp |
| 3 | DELIVERY-ACK | Entregue ao destinatário |
| 4 | READ | Lida |
| 5 | PLAYED | Áudio/vídeo reproduzido |

---

## Requirements

### REQ-WA-001: Webhook Receiver

**Priority:** P0
**Description:** Endpoint para receber mensagens do BubbleWhats

#### Acceptance Criteria

- [ ] AC-001.1: `POST /webhooks/bubblewhats/messages` aceita payload de recebimento
- [ ] AC-001.2: Ignora mensagens de grupo (`isGroup: true`)
- [ ] AC-001.3: Ignora mensagens do próprio número (`fromMe: true` via messageContext)
- [ ] AC-001.4: Autentica via token no header (BUBBLEWHATS_WEBHOOK_SECRET)
- [ ] AC-001.5: Retorna 200 imediatamente (processamento async)
- [ ] AC-001.6: Log de recebimento para debugging

### REQ-WA-002: Session Router

**Priority:** P0
**Description:** Mapear phone → checkout session, mantendo contexto da conversa

#### Acceptance Criteria

- [ ] AC-002.1: Buscar session ativa por `fromNumber` + `deviceID` (merchant)
- [ ] AC-002.2: Se não existe → criar nova checkout session automaticamente
- [ ] AC-002.3: Session expira após 24h de inatividade (WhatsApp window)
- [ ] AC-002.4: Mesmo buyer, mesmo merchant = mesma session (stateful)
- [ ] AC-002.5: Mapear `deviceID` → `merchant_id` (config table)
- [ ] AC-002.6: Buyer identificado por phone number (global_user_id = phone hash)

### REQ-WA-003: Message Processing Pipeline

**Priority:** P0
**Description:** Processar mensagem recebida via conversation engine

#### Acceptance Criteria

- [ ] AC-003.1: Texto → send-chat-message use case (mesmo do widget)
- [ ] AC-003.2: Resposta da conversation engine → enviar via BubbleWhats send API
- [ ] AC-003.3: Respeitar messageContext para reply (responder à mensagem do buyer)
- [ ] AC-003.4: Suporte a mensagens sequenciais (buyer envia 3 msgs rápidas → processa todas)
- [ ] AC-003.5: Rate limiting: max 1 resposta/segundo por session (batch msgs rápidas)
- [ ] AC-003.6: Timeout: se engine demora >15s → enviar "Estou processando..." e responder depois

### REQ-WA-004: Catalog Browsing via Chat

**Priority:** P1
**Description:** Buyer pode navegar catálogo por texto natural

#### Acceptance Criteria

- [ ] AC-004.1: "quero pizza" → agent mostra opções do catálogo
- [ ] AC-004.2: "o que vocês tem?" → lista categorias
- [ ] AC-004.3: "quanto custa X?" → preço + descrição
- [ ] AC-004.4: Agent já tem tool browse_catalog no LangGraph — funciona automaticamente
- [ ] AC-004.5: Imagens de produto enviadas como mídia (se disponíveis)

### REQ-WA-005: Cart Management via Chat

**Priority:** P1
**Description:** Buyer adiciona/remove itens do carrinho por conversa

#### Acceptance Criteria

- [ ] AC-005.1: "adiciona 2 pizzas margherita" → cart updated
- [ ] AC-005.2: "remove o último item" → item removido
- [ ] AC-005.3: "meu carrinho" → lista itens + total
- [ ] AC-005.4: Cart persiste na session (same as widget)
- [ ] AC-005.5: Cart recovery funciona igual (se buyer abandona, scanner detecta)

### REQ-WA-006: Payment via WhatsApp

**Priority:** P1
**Description:** Buyer finaliza compra e paga via link

#### Acceptance Criteria

- [ ] AC-006.1: "quero pagar" → gera link de pagamento (Pix ou cartão)
- [ ] AC-006.2: Link enviado como mensagem no WhatsApp
- [ ] AC-006.3: Após pagamento confirmado → mensagem de confirmação no WhatsApp
- [ ] AC-006.4: Suporta Pix (Asaas) e cartão (Stripe) — mesmas conexões do merchant
- [ ] AC-006.5: Link expira em 30min (configurable)

### REQ-WA-007: Status Updates Webhook

**Priority:** P2
**Description:** Receber confirmações de entrega/leitura

#### Acceptance Criteria

- [ ] AC-007.1: `POST /webhooks/bubblewhats/status` aceita payload de update
- [ ] AC-007.2: Status READ → mark message as read no histórico
- [ ] AC-007.3: Status ERROR → retry ou log
- [ ] AC-007.4: Usado para analytics (taxa de leitura, tempo de resposta)

### REQ-WA-008: Device-to-Merchant Mapping

**Priority:** P0
**Description:** Dashboard para merchant configurar seu WhatsApp Business

#### Acceptance Criteria

- [ ] AC-008.1: Merchant configura: device_id do BubbleWhats no dashboard
- [ ] AC-008.2: Merchant ativa/desativa canal WhatsApp
- [ ] AC-008.3: Webhook URL gerado automaticamente (unique per merchant)
- [ ] AC-008.4: Teste de conexão: "enviar mensagem de teste"
- [ ] AC-008.5: Métricas: conversas ativas, conversões, taxa de resposta

### REQ-WA-009: Handoff to Human

**Priority:** P2
**Description:** Quando AI não resolve, redireciona para humano

#### Acceptance Criteria

- [ ] AC-009.1: Buyer diz "falar com humano" → conversa pausada para AI
- [ ] AC-009.2: Merchant recebe notificação (dashboard) de handoff pendente
- [ ] AC-009.3: Merchant pode "devolver" para AI quando quiser
- [ ] AC-009.4: Histórico da conversa visível para merchant antes de assumir

---

## Architecture

### Module Structure

```
apps/api/src/modules/whatsapp-channel/
  domain/
    entities/whatsapp-session.entity.ts
    ports/
      whatsapp-receiver.port.ts      (webhook handling)
      session-router.port.ts         (phone → session mapping)
    events/
      whatsapp-message-received.event.ts
      whatsapp-session-started.event.ts
  application/
    use-cases/
      handle-incoming-message.use-case.ts   (main pipeline)
      handle-status-update.use-case.ts
      route-to-session.use-case.ts
      send-whatsapp-response.use-case.ts
  infrastructure/
    adapters/
      bubblewhats-receiver.adapter.ts
    repositories/
      prisma-whatsapp-session.repository.ts
  presentation/
    http/
      whatsapp-webhook.controller.ts
  whatsapp-channel.module.ts
```

### Flow

```
BubbleWhats → POST /webhooks/bubblewhats/messages
  → WhatsAppWebhookController (validates, returns 200 immediately)
  → HandleIncomingMessageUseCase
    → RouteToSessionUseCase (phone → session, create if needed)
    → send-chat-message.use-case.ts (existing! channel-agnostic)
    → Conversation Engine responds
    → SendWhatsAppResponseUseCase
      → BubbleWhatsAdapter.send() (existing!)
```

### What's Reused (zero changes)

- `send-chat-message.use-case.ts` — already accepts (sessionId, message, buyer)
- `Conversation Engine` — LangGraph agent with tools
- `Rules Engine` — discount evaluation
- `Shipping Engine` — frete calculation
- `BubbleWhatsAdapter.send()` — already sends messages
- `WhatsAppSenderPort` — port already defined
- Cart management, offers, payments — all session-based, channel-agnostic

### What's New

- Webhook receiver endpoint
- Session router (phone → checkout_session_id table)
- Device-to-merchant mapping table
- Response formatter (ChatTurn → WhatsApp text + optional buttons)
- Dashboard: WhatsApp channel config page

---

## Data Model

```prisma
model WhatsAppChannelConfig {
  id          String  @id @default(uuid())
  merchantId  String  @unique
  enabled     Boolean @default(false)
  deviceId    String  // BubbleWhats device ID
  phoneNumber String  // Merchant's WhatsApp number
  webhookUrl  String  // Auto-generated unique URL
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  merchant    Merchant @relation(fields: [merchantId], references: [id])
}

model WhatsAppSession {
  id              String   @id @default(uuid())
  merchantId      String
  buyerPhone      String   // fromNumber (cleaned)
  buyerAlias      String?  // fromAlias
  checkoutSessionId String // links to existing CheckoutSession
  deviceId        String
  lastActivityAt  DateTime @default(now())
  status          String   @default("active") // active | expired | handoff
  createdAt       DateTime @default(now())

  @@unique([merchantId, buyerPhone])
  @@index([merchantId, status])
}
```

---

## Configuration

### Environment Variables (already have most)

```env
# Already configured:
BUBBLEWHATS_API_URL=...
BUBBLEWHATS_TOKEN=...

# New:
BUBBLEWHATS_WEBHOOK_SECRET=<shared secret for webhook auth>
```

### Merchant Dashboard Config

```
Integrações > WhatsApp Commerce
  - [Toggle] Ativar canal WhatsApp
  - Device ID: [input] (from BubbleWhats)
  - Webhook URL: [readonly, auto-generated]
  - [Button] Testar conexão
  - Métricas: conversas hoje, conversões, tempo médio de resposta
```

---

## Tradeoffs Accepted

1. **BubbleWhats (not Cloud API directly)** — simplicidade > controle. Já temos integração, evitamos Meta review process
2. **Session per phone** — buyer com 2 números = 2 sessions. Acceptable para PME
3. **Text-first (no interactive messages)** — Phase 1 sem buttons/lists. Natural language handles it
4. **24h window** — session expira se buyer não responde em 24h. WhatsApp constraint
5. **No voice messages Phase 1** — audio transcription pode vir depois (Whisper)
6. **Single device per merchant** — Multi-device = complexity. PME tem 1 número

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| BubbleWhats downtime | Alto | Retry queue + fallback message |
| Rate limit WhatsApp | Médio | Batch messages, respect 24h window |
| Buyer sends spam/flood | Baixo | Rate limit per phone (1 msg/s) |
| Session explosion (muitas abertas) | Médio | Auto-expire after 24h inactivity |
| Media storage (24h expiry) | Baixo | Download + store on S3 on receive |

---

## Phases

### Phase 1: MVP (Text Commerce)
- Webhook receiver
- Session router
- Message → Conversation Engine → Response
- Payment link generation
- Dashboard config toggle

### Phase 2: Rich Media
- Send product images
- Receive payment receipts (image)
- Audio transcription (Whisper)

### Phase 3: Interactive UX
- Button messages ("Ver catálogo", "Pagar agora")
- List messages (product selection)
- Template messages (proactive cart recovery)

### Phase 4: Human Handoff
- Handoff detection
- Dashboard live chat for merchant
- AI resume after human resolves
