# AACP Checkout Integration: Embed UI and API-only

Lojas contratantes podem integrar a AACP de duas formas oficiais:

1. **Embed UI**: a loja instala nosso script, monta nosso Web Component no checkout e recebe a interface enterprise pronta.
2. **API-only**: a loja mantém a própria UI e usa nossas APIs para sessão, conversa IA, ofertas, aplicação de cupom e intenção de pagamento.

Nos dois modelos, o browser nunca deve autenticar o merchant apenas por `merchant_id`. O backend da loja precisa usar credenciais server-side para emitir ou solicitar um token curto de embed, ou chamar nossas APIs server-to-server no modelo API-only.

## Modelo 1: Embed UI

Use quando a loja quiser instalar a experiência AACP completa, com chat, resumo do pedido, mensagens rápidas, estado de erro e layout enterprise mantidos pela AACP.

### Frontend da loja

```html
<div
  id="aacp-merchant-mount"
  data-api-base-url="https://api.aacp.ai"
  data-embed-session-token="EMBED_SESSION_TOKEN_ASSINADO"
  data-brand-title="Northstar Atelier"
  data-brand-subtitle="Checkout premium assistido por IA"
  data-cart-json='{"currency":"BRL","source":"storefront","total":899.8,"items":[{"sku":"bag-001","name":"Bolsa Executiva Couro Safiano","price":449.9,"cost":210,"quantity":2,"imageUrl":"https://cdn.loja.com/bag.png","productUrl":"https://loja.com/bag-001","category":"Bolsas","variant":"Preta"}]}'
  data-customer-json='{"email":"cliente@loja.com","externalCustomerId":"cus_123","isReturning":true}'
  data-shipping-json='{"customerPrice":29.9,"realCost":31,"carrier":"Loggi","method":"Express","deliveryDays":2,"region":"SP"}'
></div>

<script type="module" src="https://cdn.aacp.ai/widget/checkout-agent.js"></script>
```

### Eventos enviados pela loja

```js
window.AACP.track("coupon_field_clicked");
window.AACP.track("shipping_objection_detected");
window.AACP.track("payment_failed");
window.AACP.track("exit_intent_detected");
```

### O que o embed faz

- Lê os atributos `data-cart-json`, `data-customer-json` e `data-shipping-json`.
- Envia `POST /embed/start` com `x-aacp-embed-token`.
- Renderiza a UI usando `StartCheckoutResponse.experience`.
- Envia mensagens do comprador para `POST /embed/chat`.
- Aplica ofertas autorizadas em `POST /embed/offers/apply`.
- Opcionalmente cria intenção de pagamento em `POST /embed/payment/intents`.

## Modelo 2: API-only

Use quando a loja quiser manter a própria interface visual e consumir apenas a inteligência da AACP.

### Start checkout

```http
POST /checkout/start
Authorization: Bearer SERVER_TO_SERVER_TOKEN
Content-Type: application/json
```

```json
{
  "merchant_id": "mrc_123",
  "session_id": "checkout_abc",
  "customer": {
    "email": "cliente@loja.com",
    "externalCustomerId": "cus_123",
    "isReturning": true
  },
  "cart": {
    "currency": "BRL",
    "source": "platform_api",
    "total": 899.8,
    "items": [
      {
        "sku": "bag-001",
        "name": "Bolsa Executiva Couro Safiano",
        "price": 449.9,
        "cost": 210,
        "quantity": 2,
        "imageUrl": "https://cdn.loja.com/bag.png",
        "productUrl": "https://loja.com/bag-001",
        "category": "Bolsas",
        "variant": "Preta"
      }
    ]
  },
  "shipping": {
    "customerPrice": 29.9,
    "realCost": 31,
    "carrier": "Loggi",
    "method": "Express",
    "deliveryDays": 2,
    "region": "SP"
  }
}
```

Response:

```json
{
  "conversation_id": "conv_123",
  "session_id": "checkout_abc",
  "global_user_id": "usr_123",
  "agent_enabled": true,
  "initial_mode": "open",
  "tracking_token": "trk_123",
  "experience": {
    "brand": {
      "merchant_id": "mrc_123",
      "name": "Northstar Atelier",
      "subtitle": "Checkout assistido por IA",
      "support_label": "Compra guiada"
    },
    "items": [
      {
        "sku": "bag-001",
        "name": "Bolsa Executiva Couro Safiano",
        "quantity": 2,
        "unit_price": 449.9,
        "line_total": 899.8,
        "image_url": "https://cdn.loja.com/bag.png",
        "product_url": "https://loja.com/bag-001",
        "category": "Bolsas",
        "variant": "Preta"
      }
    ],
    "totals": {
      "currency": "BRL",
      "subtotal": 899.8,
      "shipping": 29.9,
      "discount": 0,
      "total": 929.7
    },
    "agent": {
      "name": "Clara",
      "greeting": "Sou a Clara, posso ajudar a fechar sua compra com segurança.",
      "tone": "premium",
      "language": "pt-BR"
    },
    "copy": {
      "headline": "Northstar Atelier: finalize sua compra com ajuda da IA",
      "subheadline": "1 item no pedido, total R$ 929,70 com contexto real do carrinho.",
      "trust_badges": [
        "IA respeita políticas comerciais da loja",
        "Frete, cupom e pagamento validados pela API",
        "Resumo do pedido sincronizado com a sessão"
      ],
      "quick_replies": [
        "Tenho dúvida sobre o frete",
        "Existe algum cupom disponível?",
        "Quero finalizar agora"
      ]
    }
  }
}
```

### Send chat message

```http
POST /checkout/chat
Authorization: Bearer SERVER_TO_SERVER_TOKEN
Content-Type: application/json
```

```json
{
  "merchant_id": "mrc_123",
  "session_id": "checkout_abc",
  "conversation_id": "conv_123",
  "user_message": "Tenho dúvida sobre o frete"
}
```

### Track behavioral event

```http
POST /checkout/track
Authorization: Bearer SERVER_TO_SERVER_TOKEN
Content-Type: application/json
```

```json
{
  "merchant_id": "mrc_123",
  "session_id": "checkout_abc",
  "event": "coupon_field_clicked",
  "metadata": {
    "step": "payment"
  }
}
```

### Apply authorized offer

```http
POST /checkout/offers/apply
Authorization: Bearer SERVER_TO_SERVER_TOKEN
Content-Type: application/json
```

```json
{
  "merchant_id": "mrc_123",
  "session_id": "checkout_abc",
  "offer_id": "off_123"
}
```

## Security requirements

- Embed UI must use short-lived `embed_session_token` scoped to merchant, session and allowed origin.
- API-only must use server-to-server credentials; never expose the merchant secret in the browser.
- Browser requests in Embed UI must use `/embed/*`; server requests in API-only may use `/checkout/*`.
- The API is the source of truth for discounts, free shipping, payment status and policy constraints.
- The UI can display `experience.copy.quick_replies`, but cannot invent offer labels that were not returned by API actions.

## Choosing the integration model

| Need | Recommended model |
| --- | --- |
| Fastest install with AACP-owned enterprise UI | Embed UI |
| Marketplace checkout with strict design system | API-only |
| Merchant has no engineering team | Embed UI |
| Merchant wants native mobile/web checkout UI | API-only |
| Merchant wants A/B testing of AACP visual experience | Embed UI |
| Merchant wants only negotiation/agent intelligence | API-only |

## Merchant theme (B2B customization)

Cada loja contratante pode personalizar a experiência conversacional do widget — cor de destaque, cor de texto, fundo, fonte, logo e avatar do agente. O tema é servido pela API e aplicado no widget como CSS custom properties (`--aacp-accent`, `--aacp-fg`, `--aacp-bg`, `--aacp-font`).

### Buscar tema atual

```http
GET /merchants/me/theme
Authorization: Bearer MERCHANT_DASHBOARD_JWT
```

Resposta (caso o merchant não tenha customizado, retorna `DEFAULT_MERCHANT_THEME`):

```json
{
  "accentColor": "#0F766E",
  "textColor": "#0F172A",
  "backgroundColor": "#FFFFFF",
  "fontFamily": "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
}
```

### Atualizar tema

```http
PUT /merchants/me/theme
Authorization: Bearer MERCHANT_DASHBOARD_JWT
Content-Type: application/json
```

```json
{
  "accentColor": "#FF0066",
  "textColor": "#0F172A",
  "backgroundColor": "#F9FAFB",
  "fontFamily": "Manrope, system-ui, sans-serif",
  "logoUrl": "https://cdn.loja.com/logo.png",
  "agentAvatarUrl": "https://cdn.loja.com/agent.png"
}
```

Validações:
- `accentColor`, `textColor`, `backgroundColor`: hex de 6 dígitos (`#RRGGBB`).
- `fontFamily`: 2–200 caracteres.
- `logoUrl`, `agentAvatarUrl`: HTTPS obrigatório (recusados se HTTP ou outro esquema).

### Como o widget usa o tema

O `StartCheckoutResponse.experience.brand.theme` carrega o tema do merchant. O widget injeta essas variáveis no wrapper `.aacp-widget--conversational`, e todo o CSS deriva delas via `color-mix()` para manter contraste. Para B2B, basta o painel administrativo da loja chamar `PUT /merchants/me/theme` — a próxima sessão de checkout já renderiza com a nova identidade.

## AI provider configuration

A conversa com o comprador é gerada pelo `@aacp/conversation-engine`. Em produção a API precisa de uma chave de provedor LLM:

| Variável | Uso |
| --- | --- |
| `DEEPSEEK_API_KEY` | Preferida. Quando presente, o engine usa `deepseek-chat` em `https://api.deepseek.com/v1`. |
| `DEEPSEEK_MODEL` | Override do modelo DeepSeek (default `deepseek-chat`). |
| `DEEPSEEK_BASE_URL` | Override do base URL DeepSeek. |
| `OPENAI_API_KEY` | Fallback. Usa a Responses API da OpenAI quando DeepSeek não está configurado. |
| `OPENAI_MODEL` | Override do modelo OpenAI. |
| `RUN_REAL_AI_E2E` | Setar como `true` (junto com uma das chaves acima) para rodar os testes `checkout.ai-live-e2e-spec.ts` que simulam uma jornada real de compra com LLM. |

Se nenhuma chave estiver setada, o `SendChatMessageUseCase` ainda responde de forma segura usando um fallback determinístico — útil para smoke tests, mas insuficiente para produção. O endpoint `apps/api/src/main.ts` loga no boot quais chaves foram detectadas para evitar surpresas em deploy.
