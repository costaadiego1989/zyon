# AACP Storefront V1 - Mapeamento Arquitetural Completo

**Data**: 2026-08-19  
**Status**: Versão atual da storefront (apps/storefront/) mapeada para V2 segura  
**Propósito**: Base técnica para migração sem quebrar fluxos críticos

---

## 1. ESTRUTURA FÍSICA

### 1.1 Diretórios e Organização

```
apps/storefront/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout (providers, metadata)
│   │   ├── page.tsx                # Home page
│   │   ├── globals.css             # Global styles
│   │   ├── robots.ts               # SEO robots.txt
│   │   ├── sitemap.ts              # Dynamic sitemap
│   │   ├── api/
│   │   │   └── checkout-token/
│   │   │       └── route.ts        # POST /api/checkout-token (gera embed token)
│   │   └── store/
│   │       └── [slug]/
│   │           ├── page.tsx        # Storefront dinâmica (main shell)
│   │           └── opengraph-image.tsx  # OG image dinâmica
│   ├── components/
│   │   ├── blocks/                 # 16 tipos de blocos UI
│   │   │   ├── BlockRenderer.tsx
│   │   │   ├── ProductCardBlock.tsx
│   │   │   ├── ProductCarouselBlock.tsx
│   │   │   ├── CartSummaryBlock.tsx
│   │   │   ├── CheckoutRedirectBlock.tsx
│   │   │   ├── ShippingOptionsBlock.tsx
│   │   │   ├── VariantSelectorBlock.tsx
│   │   │   ├── QuickRepliesBlock.tsx
│   │   │   ├── OrderConfirmationBlock.tsx
│   │   │   ├── ReviewsBlock.tsx
│   │   │   ├── AddReviewBlock.tsx
│   │   │   ├── CrossSellBlock.tsx
│   │   │   ├── CategoryCarouselBlock.tsx
│   │   │   ├── ComparisonTableBlock.tsx
│   │   │   ├── ProductComparisonBlock.tsx
│   │   │   └── MarketplaceProductsBlock.tsx
│   │   ├── ConversationShell.tsx    # Main chat UI + socket.io
│   │   ├── WidgetConfigProvider.tsx # Context provider (widget behavior)
│   │   ├── CartFAB.tsx              # Floating action button
│   │   ├── SupportPanel.tsx         # Support chat + handoff via socket.io
│   │   ├── BuyerHub.tsx             # Profile/orders/tracking hub
│   │   ├── BuyerAuthGate.tsx        # Auth wrapper
│   │   ├── BuyerLoginForm.tsx       # Phone OTP login
│   │   ├── BuyerRegistrationForm.tsx # Full registration flow
│   │   ├── CheckoutWidgetPanel.tsx  # Checkout mini-panel
│   │   ├── StoriesRow.tsx           # Stories carousel
│   │   ├── StoryViewer.tsx          # Story viewer modal
│   │   ├── StructuredData.tsx       # JSON-LD schema
│   │   ├── GoogleTagManager.tsx     # GTM container
│   │   ├── PixelTrackers.tsx        # FB + TikTok pixels
│   │   ├── SupportFAB.tsx           # Support floating button
│   │   └── ImageSlideshow.tsx
│   └── lib/
│       ├── types.ts                 # All TypeScript interfaces
│       ├── storefront-api.ts        # API client (budget requests only)
│       ├── cart-store.tsx           # React Context (cart state)
│       ├── widget-config.ts         # React Context (widget behavior)
│       ├── analytics.ts             # Google Analytics 4 helpers
│       ├── triggers.ts              # Exit intent + idle detection
│       ├── trigger-messages.ts      # Proactive nudge messages
│       ├── intervention-tracker.ts  # sessionStorage intervention counter
│       ├── demo-merchant.ts         # Fixture merchant data
│       ├── useCheckoutExperiment.ts # A/B test variant tracking
│       ├── hooks/
│       │   └── useMarketplaceSearch.ts
│       └── middleware.ts            # Custom domain rewrite
├── e2e/                            # Playwright tests
└── package.json
```

### 1.2 Tamanho e Quantidade

- **Arquivos TypeScript/TSX**: ~90 arquivos
- **Linhas de código**: ~12,000 LOC
- **Dependências**: 5 (react, react-dom, next, socket.io-client, @zyon/checkout-ui)
- **Next.js Framework**: App Router (SSR/SSG)

---

## 2. ENTRY POINTS E FLUXO DE INICIALIZAÇÃO

### 2.1 Layout Raiz (`apps/storefront/src/app/layout.tsx`)

```tsx
// Inicializa:
// - Providers globais (providers não explícitos, deve ser next/config)
// - Metadata global
// - CSS global (globals.css)
```

### 2.2 Página Principal (`apps/storefront/src/app/page.tsx`)

```tsx
// Renderiza:
// - Redireciona para /store/[slug] ou fallback
// - Home estática ou lista de lojas
```

### 2.3 Storefront Dinâmica (`apps/storefront/src/app/store/[slug]/page.tsx`) ⭐ CRÍTICO

**Fluxo:**
1. Recebe `[slug]` como parâmetro da URL
2. Busca `GET /storefront/{slug}/config` (inclui merchantId, branding, settings)
3. Busca `GET /storefront/{slug}/stories` (conteúdo stories)
4. Se não encontrar config, usa demo merchant fixture
5. Renderiza hierarquia de providers:

```tsx
<WidgetConfigProvider merchantId={config.merchantId}>
  <CartProvider merchantId={config.merchantId}>
    <ConversationShell
      merchantId={config.merchantId}
      merchantSlug={slug}
      // ... props
    />
  </CartProvider>
</WidgetConfigProvider>
```

**O que QUEBRA se mudado:**
- URL slug routing
- merchantId propagação
- config fetch pattern
- WidgetConfigProvider initialization order

---

## 3. FLUXO DE DADOS CRÍTICO

### 3.1 Merchant ID Propagation

```
URL [slug] → /store/[slug]/page.tsx (Server Component)
  ↓
fetchStoreConfig(slug) → API GET /storefront/{slug}/config
  ↓
config.merchantId (extraído do response)
  ↓
Passa para WidgetConfigProvider(merchantId)
  ↓
Passa para CartProvider(merchantId)
  ↓
Passa para ConversationShell(merchantId, merchantSlug)
  ↓
useCart() / useWidgetConfig() acessa via React Context
  ↓
Sub-componentes usam merchantId para scoping de queries
```

**Invariante crítica:** `merchant_id` NUNCA pode ser `undefined` em fetch calls. Se vier undefined, cai no demo merchant fallback.

### 3.2 Cart State Flow

```
1. CartProvider (lib/cart-store.tsx) initializes EMPTY_CART = {
     cartId: null,
     items: [],
     itemCount: 0,
     discount: 0,
     total: 0
   }

2. On mount, se merchantId existe:
   - sessionStorage.getItem(`zyon-cart-id:{merchantId}`)
   - Fetch GET /storefront/cart/{cartId}?merchantId={merchantId}
   - setState com items carregados

3. BlockRenderer renderiza CartSummaryBlock
   - updateFromBlocks() extrai items do block
   - setState updatedCart

4. useCart() retorna {cart, updateFromBlocks, updateItemQuantity, clearCart}
```

**Storage key pattern:** `zyon-cart-id:{merchantId}`

### 3.3 Widget Config Flow

```
1. WidgetConfigProvider (WidgetConfigProvider.tsx) on mount:
   - Fetch GET /checkout-settings/widget-config?merchantId={merchantId}
   - Response: WidgetConfig interface (16 fields)
   - setState { config, loading: false, error: null }

2. Context usada por:
   - SupportFAB: mode=silent_until_trigger, position
   - CartFAB: position, fabColor, showCartBadge
   - ConversationShell: handoffEnabled, handoffChannels
   - BuyerHub: suppressed triggers

3. Critical fields:
   - mode: "silent_until_trigger" | "proactive" | "manual_only"
   - enabledTriggers: ["exit_intent_detected", "idle_30_seconds", ...]
   - suppressedSteps: ["buy_more", "upgrade_plan"]
   - handoffEnabled: boolean
   - handoffChannels: ["whatsapp", "email"]
```

### 3.4 Embed Token Generation

**Entry point:** `POST /api/checkout-token` (Next.js API route)

```tsx
// Recebe body: { merchant_id, cart_ref?, allowed_origin? }

// Chama API interna:
POST http://127.0.0.1:3009/embed-sessions
Headers:
  X-Internal-Service-Token: ${INTERNAL_SERVICE_TOKEN}
  X-Merchant-Id: ${merchant_id}
  Idempotency-Key: ck_${randomUUID()}
Body:
  {
    ttl_seconds: 3600,
    cart_ref,
    allowed_origin,
    scopes: [
      "checkout:start",
      "checkout:track",
      "checkout:chat",
      "payment:intents:create",
      "payment:intents:confirm",
      "payment:intents:read",
      "offers:apply"
    ]
  }

// Response: { embed_session_token, expires_at_unix }
```

**Usado por:**
- SupportPanel (auth para /support/chat)
- CheckoutWidgetPanel (embedToken header)

---

## 4. API ENDPOINTS CONSUMIDOS (LISTA EXATA)

### 4.1 Storefront Config & Setup

| Endpoint | Método | Requisitor | Quando | Response |
|----------|--------|-----------|--------|----------|
| `/storefront/{slug}/config` | GET | StorePage | SSR/static | StoreConfig (merchantId, theme, branding) |
| `/storefront/{slug}/stories` | GET | StorePage | SSR | { categories: [] } |
| `/storefront/index` | GET | sitemap.ts | Build-time | Lista slugs para sitemap |

### 4.2 Conversação (Chat Principal)

| Endpoint | Método | Requisitor | Quando | Body | Response |
|----------|--------|-----------|--------|------|----------|
| `/storefront/conversations` | POST | ConversationShell | chat init | `{ merchant_id, channel?, mode? }` | `{ conversation_id, ...}` |
| `/storefront/conversations/{id}/messages` | POST | ConversationShell | user mensagem | `{ message, merchant_id, user_id?, blocks?, context? }` | `{ blocks: [], messages: [] }` |
| `socket.io:/storefront/conversations` | WS | ConversationShell | Real-time | events | streaming messages |

### 4.3 Suporte (Handoff)

| Endpoint | Método | Requisitor | Quando | Body | Response |
|----------|--------|-----------|--------|------|----------|
| `/support/chat` | POST | SupportPanel | Support msg | `{ message, session_id, merchant_id? }` | `{ reply, handoff?: {ticketId} }` |
| `socket.io:/support` | WS | SupportPanel | Handoff accept | emit `join_ticket` | `new_message`, `agent_joined` |

### 4.4 Cart Management

| Endpoint | Método | Requisitor | Quando | Params | Response |
|----------|--------|-----------|--------|--------|----------|
| `/storefront/cart/{cartId}` | GET | CartProvider | mount hydrate | `merchantId` query | `{ cartId, items, itemCount, total }` |
| `/storefront/cart/{cartId}/items/{variantId}` | PUT/DELETE | ConversationShell | item quantity | qty in body | `{ items, total }` |

### 4.5 Buyer Auth (OTP)

| Endpoint | Método | Requisitor | Quando | Body | Response |
|----------|--------|-----------|--------|------|----------|
| `/storefront/buyer/send-otp` | POST | BuyerLoginForm | step 1 | `{ phone, channel: "sms" }` | `{ success }` |
| `/storefront/buyer/verify-otp` | POST | BuyerLoginForm | step 2 | `{ phone, code }` | `{ token, global_user_id }` |
| `/buyer/phone/send` | POST | BuyerRegistrationForm | reg step 1 | `{ phone, channel: "whatsapp" }` | `{ success }` |
| `/buyer/phone/verify` | POST | BuyerRegistrationForm | reg step 2 | `{ phone, code }` | `{ success }` |
| `/buyer/email/send` | POST | BuyerRegistrationForm | reg step 3 | `{ email }` | `{ success }` |
| `/buyer/email/verify` | POST | BuyerRegistrationForm | reg step 4 | `{ email, code }` | `{ success }` |
| `/buyer/register` | POST | BuyerRegistrationForm | reg step 5 | `{ phone, email, name, cpf, address, ... }` | `{ global_user_id, token }` |

### 4.6 Buyer Profile & History

| Endpoint | Método | Requisitor | Quando | Headers | Response |
|----------|--------|-----------|--------|---------|----------|
| `/buyer/me/profile` | GET | BuyerHub | auth tab | Authorization: Bearer token | `{ name, email, phone, ... }` |
| `/buyer/me/purchases?limit=10` | GET | BuyerHub | orders tab | Authorization: Bearer token | `{ orders: [] }` |

### 4.7 Budget Requests & Offers

| Endpoint | Método | Requisitor | Quando | Body | Response |
|----------|--------|-----------|--------|------|----------|
| `/storefront/budget-requests` | POST | CheckoutWidgetPanel | Budget submit | `{ merchant_id, customer_*, items, total, note? }` | `{ budget_id, status }` |

### 4.8 Products & Search

| Endpoint | Método | Requisitor | Quando | Params | Response |
|----------|--------|-----------|--------|--------|----------|
| `/merchants/{merchantId}/products` | GET | ProductCarouselBlock | product fetch | `filter, sort, limit` query | `{ products: [] }` |

### 4.9 Embed Session Token (Next.js route)

| Endpoint | Método | Requisitor | Quando | Body | Response |
|----------|--------|-----------|--------|------|----------|
| `/api/checkout-token` | POST | SupportPanel, CheckoutWidgetPanel | token gen | `{ merchant_id, cart_ref?, allowed_origin? }` | `{ embed_session_token, expires_at_unix }` |

### 4.10 External (Non-AACP)

| Endpoint | Método | Requisitor |
|----------|--------|-----------|
| `https://viacep.com.br/ws/{cep}/json` | GET | BuyerRegistrationForm (CEP lookup) |

---

## 5. ESTADO CRÍTICO - REACT CONTEXTS

### 5.1 CartContext (lib/cart-store.tsx)

```tsx
interface CartState {
  cartId: string | null;
  items: CartItem[];  // { variantId, productName, quantity, price, subtotal }
  itemCount: number;
  discount: number;
  total: number;
}

interface CartContextValue {
  cart: CartState;
  updateFromBlocks: (blocks: ConversationBlock[]) => void;
  updateItemQuantity: (variantId: string, quantity: number) => void;
  clearCart: () => void;
}

useCart(): CartContextValue
```

**Storage:**
- sessionStorage key: `zyon-cart-id:{merchantId}`
- Persists cartId only (not full state)

### 5.2 WidgetConfigContext (lib/widget-config.ts)

```tsx
interface WidgetConfig {
  mode: "silent_until_trigger" | "proactive" | "manual_only";
  position?: "bottom_right" | "bottom_left" | "top_right" | "top_left";
  fabColor?: string;
  inviteText?: string;
  presentationMode?: "fab" | "banner" | "inline";
  cartPresentationMode?: "floating" | "page" | "redirect";
  budgetModeEnabled?: boolean;
  startMinimized?: boolean;
  initialDelaySeconds?: number;
  showCartBadge?: boolean;
  fabClickAction?: string;
  fabRedirectUrl?: string;
  openWidgetOnTrigger: boolean;
  enabledTriggers: string[];
  suppressedSteps: string[];
  blockedRegions: string[];
  minimumCartValue?: number;
  handoffEnabled: boolean;
  handoffMessage: string;
  handoffChannels: string[];
  cooldownSeconds?: number;
  maxInterventionsPerSession?: number;
}

interface WidgetConfigState {
  config: WidgetConfig | null;
  loading: boolean;
  error: string | null;
}

useWidgetConfig(): WidgetConfigState
```

### 5.3 ConversationShell Local State (não Context)

```tsx
// Dentro ConversationShell component:
const [messages, setMessages] = useState<Message[]>([]);      // Chat history
const [conversationId, setConversationId] = useState<string | null>(null);
const [channel, setChannel] = useState<Channel | null>(null); // "chat" | "voice"
const [mode, setMode] = useState("intro" | "chat");           // UI state
const [isLoading, setIsLoading] = useState(boolean);
const [input, setInput] = useState(string);                    // User input
```

**Invariante:** Mensagens no state, não em localStorage/sessionStorage.

### 5.4 BuyerHub Local State

```tsx
// Buyer auth session
interface BuyerSession {
  globalUserId: string;
  token: string;
  profile?: BuyerProfile;
  purchases?: Order[];
}

// localStorage key: `zyon_buyer_auth_session`
localStorage.getItem(AUTH_STORAGE_KEY)
```

**localStorage keys:**
- `zyon_buyer_token` (usado por BuyerLoginForm)
- `pulse-theme-pref` ("dark" | "light")

### 5.5 Intervention Tracking (lib/intervention-tracker.ts)

```tsx
// sessionStorage keys:
"aacp_intervention_count_{merchantId}"  // Counter
"aacp_trigger_last_{merchantId}_{trigger}"  // Cooldown timestamp

Functions:
- getInterventionCount(merchantId): number
- incrementIntervention(merchantId): void
- canFireTrigger(merchantId, trigger, cooldownMs): boolean
- recordTriggerFired(merchantId, trigger): void
```

---

## 6. TIPOS DE BLOCOS (ConversationBlock)

### 6.1 Bloco Renderizer

```tsx
// BlockRenderer.tsx mapeia tipo → componente
// Recebe array de blocos do API response
// Renderiza cada bloco com dados específicos
```

### 6.2 16 Tipos de Blocos

| Tipo | Componente | Função | Dados Críticos |
|------|-----------|--------|-----------------|
| `product_card` | ProductCardBlock | Exibe 1 produto | `{ id, name, price, image, rating }` |
| `product_carousel` | ProductCarouselBlock | Carrossel de produtos | `{ products: [] }` |
| `variant_selector` | VariantSelectorBlock | Selector de variantes | `{ variantId, options }` |
| `cart_summary` | CartSummaryBlock | Resumo do carrinho | `{ items, itemCount, total, discount }` |
| `shipping_options` | ShippingOptionsBlock | Opções de envio | `{ options: [] }` |
| `shipping_quote_input` | ShippingQuoteInputBlock | Form CEP | `{ productName, productId }` |
| `quick_replies` | QuickRepliesBlock | Botões resposta rápida | `{ options: [] }` |
| `checkout_redirect` | CheckoutRedirectBlock | Link checkout | `{ url, sessionId }` |
| `order_confirmation` | OrderConfirmationBlock | Confirmação pedido | `{ orderId, items, total }` |
| `comparison_table` | ComparisonTableBlock | Comparação produtos | `{ products, attributes }` |
| `product_comparison` | ProductComparisonBlock | Dois produtos lado-a-lado | - |
| `reviews` | ReviewsBlock | Reviews produto | `{ productId, reviews: [] }` |
| `add_review` | AddReviewBlock | Form review | `{ productId }` |
| `cross_sell` | CrossSellBlock | Venda cruzada | `{ trigger, products }` |
| `category_carousel` | CategoryCarouselBlock | Categorias | `{ categories: [] }` |
| `marketplace_products` | MarketplaceProductsBlock | Marketplace | `{ products: [] }` |

**Invariante:** Blocos vêm do API, não são renderizados no client sem validação.

---

## 7. SOCKET.IO REAL-TIME

### 7.1 Conversação Principal

```tsx
// ConversationShell.tsx
const socket = io(`${API_BASE}/storefront/conversations`, {
  transports: ["websocket", "polling"]
});

// Eventos emitidos:
socket.emit("send_message", {
  conversation_id,
  message: string,
  merchant_id,
  ...
});

// Eventos escutados:
socket.on("message_received", (msg) => {});
socket.on("agent_typing", () => {});
socket.on("blocks_ready", (blocks) => {});
```

### 7.2 Suporte (Handoff)

```tsx
// SupportPanel.tsx
const socket = io(`${API_BASE}/support`, {
  transports: ["websocket", "polling"]
});

// Handoff criado:
socket.emit("join_ticket", { ticketId });

// Merchant/agent conecta:
socket.on("new_message", (msg) => {});
socket.on("agent_joined", (data) => {});
```

---

## 8. TRIGGER DETECTION (Proactive Engagement)

### 8.1 Tipos de Trigger

**Arquivo:** `lib/triggers.ts`

```tsx
type TriggerEvent = "exit_intent_detected" | "idle_30_seconds"

interface TriggerConfig {
  enableExitIntent?: boolean;           // Mouse leave top of viewport
  enableIdleTimer?: boolean;            // No interaction for N seconds
  idleThresholdMs?: number;             // Default: 30_000
  cooldownMs?: number;                  // Default: 3_600_000 (1h)
  apiBaseUrl?: string;
  merchantId?: string;
  sessionId?: string;
}
```

### 8.2 Fluxo

```
1. initTriggerDetection(config, onTrigger)
   - Listener mouseleave top of page
   - Listener keydown/click (reset idle timer)
   - Listener idle timer

2. Trigger fires → onTrigger("exit_intent_detected")
   - incrementIntervention(merchantId)  // sessionStorage counter
   - recordTriggerFired(merchantId, trigger)  // cooldown timestamp
   - Check canFireTrigger() → cooldown prevents repeat

3. ConversationShell recebe onTrigger
   - Push message: TRIGGER_MESSAGES[triggerEvent]
   - reportTriggerEvent(triggerName, config) → POST /track-event

4. Max 3 interventions per session (hardcoded)
```

---

## 9. ANALYTICS & TRACKING

### 9.1 Google Tag Manager & GA4

**Arquivo:** `lib/analytics.ts`

```tsx
// Assumes window.gtag() injected by GTM
// All functions gracefully no-op if gtag unavailable

export function trackProductView(productId, name, price)
export function trackAddToCart(productId, quantity, value)
export function trackBeginCheckout(cartValue, itemCount)
export function trackPurchase(orderId, value)
export function trackConversationStart(storeId, variantId?)
```

**Events:**
- `product_view` → ProductCardBlock, ProductCarouselBlock
- `add_to_cart` → CartSummaryBlock updated
- `begin_checkout` → CheckoutRedirectBlock clicked
- `purchase` → OrderConfirmationBlock rendered
- `conversation_start` → ConversationShell initialized

### 9.2 Facebook Pixel & TikTok Pixel

**Arquivo:** `components/PixelTrackers.tsx`

```tsx
// Injeta scripts de rastreamento para FB e TikTok
// Config vem de /storefront/{slug}/config → storeSettings.gtm.pixelIds
```

---

## 10. AUTHENTICATION FLOW

### 10.1 Buyer Login (BuyerLoginForm)

```
Step 1: User entra phone
  → POST /storefront/buyer/send-otp
  → Receive SMS code

Step 2: User entra code
  → POST /storefront/buyer/verify-otp
  → Response: { token, global_user_id }
  → localStorage.setItem("zyon_buyer_token", token)
  → onComplete(global_user_id)
```

### 10.2 Buyer Registration (BuyerRegistrationForm)

```
Step 1: Phone OTP (whatsapp channel)
Step 2: Verify phone OTP
Step 3: Email OTP (Resend)
Step 4: Verify email OTP
Step 5: Name, CPF, address (CEP lookup from viacep.com.br)
Step 6: POST /buyer/register
  → Response: { global_user_id, token }
  → localStorage.setItem("zyon_buyer_token", token)
```

### 10.3 Session Persistence

```tsx
const session = {
  globalUserId: string,
  token: string,
  profile?: BuyerProfile,
  purchases?: Order[]
};

// localStorage key: `zyon_buyer_auth_session`
// Restored on BuyerHub mount if exists
```

---

## 11. CASOS DE USO CRÍTICOS (MUST WORK)

### UC-1: Storefront Load → Produto → Carrinho → Checkout

```
1. User visits https://stores.zyon.com/store/demo
2. /store/[slug]/page.tsx SSR fetches config
3. ConversationShell renders chat + FABs
4. User selects product → ProductCardBlock
5. User adds to cart → CartSummaryBlock updated
6. Cart badge shows item count
7. User clicks "Ir para checkout"
8. POST /api/checkout-token → embed_session_token
9. Redirect com token para widget/checkout
```

**Critical path invariant:** merchantId NEVER undefined in any step.

### UC-2: Buyer OTP Login → Profile → Orders

```
1. BuyerAuthGate shows login form (no token in localStorage)
2. User enters phone → send OTP
3. User verifies → receive token, save to localStorage
4. BuyerHub appears → fetch /buyer/me/profile
5. Orders tab → fetch /buyer/me/purchases
6. User can see past orders
```

**Critical:** Token header = `Authorization: Bearer ${token}`

### UC-3: Support Chat → Handoff → Human Agent

```
1. User clicks support FAB
2. SupportPanel opens → tries FAQ first
3. User says "falar com atendente" (regex match)
4. POST /support/chat with embed token
5. Response includes handoff.ticketId
6. Connect socket.io to /support namespace
7. socket.emit("join_ticket", {ticketId})
8. Wait for agent_joined event
9. Real-time messages via socket
```

**Critical:** embedToken must be obtained first via /api/checkout-token

### UC-4: Trigger Detection → Nudge Message

```
1. User scrolls page, no interaction for 30s
2. idle_30_seconds trigger fires
3. incrementIntervention() checks max 3
4. canFireTrigger() checks 1h cooldown
5. ConversationShell gets onTrigger callback
6. Agent message: "Está com alguma dúvida?"
7. User can respond or close
```

**Critical:** Triggers NEVER break the page, always graceful.

### UC-5: Budget Request Form → API Submit

```
1. CheckoutWidgetPanel shows form
2. User fills: name, email, phone, items, total
3. User submits
4. POST /storefront/budget-requests with merchant_id
5. Success → modal "Orçamento enviado"
```

---

## 12. PONTOS DE FALHA & BREAKING CHANGES

### ❌ Se mudar `/storefront/conversations`:

- ConversationShell quebra (hardcoded endpoint)
- Socket.io namespace muda
- Chat não inicializa

**Safe migration:** Versionar endpoint: `/v1/storefront/checkouts/{id}/messages`

### ❌ Se remover `/buyer/me/profile`:

- BuyerHub profile tab quebra
- User não consegue ver dados

**Safe migration:** Integrar dados em `/buyer/{globalUserId}`

### ❌ Se limpar sessionStorage:

- cartId perdido
- intervention counter reseta
- trigger cooldown reseta

**Invariante:** Usar cookie com secure flag se persistir entre abas.

### ❌ Se alterar WidgetConfig shape:

- WidgetConfigProvider.tsx quebra (type checking)
- Components dependem de fields específicos

**Safe migration:** Adicionar novos fields com defaults, nunca remover.

### ❌ Se remover `/api/checkout-token`:

- SupportPanel não consegue auth
- CheckoutWidgetPanel não tem token para header

**Safe migration:** Manter rota, versionar se necessário.

### ❌ Se alterar Block types:

- BlockRenderer.tsx quebra em render
- Components registrados perdem mapping

**Safe migration:** Adicionar novo tipo, deprecate antigo gradualmente.

---

## 13. COMPORTAMENTO EM PRODUÇÃO

### 13.1 Inicialização Widget

```
1. Middleware rewrite custom domain:
   hostname "acme.com" → /store/acme.com

2. StorePage SSR:
   - Cache strategy: no-store (config muda frequently)
   - Fallback: demo merchant se config not found

3. Providers inicializam:
   - WidgetConfigProvider fetches config
   - CartProvider restores cartId from sessionStorage

4. ConversationShell:
   - socket.io connects (fallback polling if WebSocket fails)
   - Trigger detection starts
   - GA4 tags fire

5. Visibility:
   - SupportFAB hidden se handoffEnabled=false
   - CartFAB position baseado em config.position
   - Chat minimized se config.startMinimized=true
```

### 13.2 Merchant Config Caching

```
// Strategy:
- GET /storefront/{slug}/config with cache: "no-store"
- WidgetConfigProvider refetch on merchantId change
- No client-side caching of config (always fresh)

// Why:
- Merchant pode mudar settings em tempo real
- Triggers, suppressed steps, handoff config
```

### 13.3 Performance Optimizations

```
1. Code splitting:
   - socket.io imported dynamically (await import)
   - ConversationShell lazy-loaded

2. Lazy loading:
   - StoryViewer modal
   - BuyerHub tabs

3. Memoization:
   - BlockRenderer memoizes block components
   - ProductCarouselBlock memoizes product list

4. sessionStorage for cart persistence:
   - Only cartId (not full state)
   - Hydrate on mount
```

---

## 14. TIPOS CRÍTICOS (shared-types)

### 14.1 ConversationBlock Union

```tsx
type ConversationBlock =
  | ProductCardBlock
  | ProductCarouselBlock
  | ComparisonTableBlock
  | CartSummaryBlock
  | ShippingOptionsBlock
  | QuickRepliesBlock
  | CheckoutRedirectBlock
  | OrderConfirmationBlock
  | ShippingQuoteInputBlock
  | VariantSelectorBlock
  | ProductComparisonBlock
  | ReviewsBlock
  | AddReviewBlock
  | CrossSellBlock
  | CategoryCarouselBlock
  | MarketplaceProductsBlock
```

### 14.2 Message Structure

```tsx
interface Message {
  id: string;
  role: "user" | "agent";
  text?: string;
  blocks?: ConversationBlock[];
}
```

### 14.3 StoreConfig

```tsx
interface StoreConfig {
  merchantId: string;
  name: string;
  logo?: string;
  description?: string;
  theme: {
    accentColor: string;
    secondaryColor?: string;
    textColor: string;
    backgroundColor: string;
    fontFamily: string;
  };
  storeSettings?: {
    seo?: { title?, description?, keywords? };
    gtm?: { gtmId?, pixelIds?: { facebook?, tiktok? } };
  };
  agentName?: string;
  agentGreeting?: string;
  quickReplies?: string[];
}
```

---

## 15. RESUMO DE DEPENDÊNCIAS INTERNAS

```
ConversationShell
├── useCart() ← CartProvider
├── useWidgetConfig() ← WidgetConfigProvider
├── BlockRenderer (renders 16 block types)
├── SupportPanel (socket.io /support)
├── BuyerHub (orders + profile)
├── BuyerAuthGate (auth wrapper)
├── CartFAB (cart badge)
├── SupportFAB (support trigger)
└── BuyerHubTrigger (mobile menu)

BuyerHub
├── BuyerLoginForm (OTP via POST /storefront/buyer/send-otp)
├── BuyerRegistrationForm (full reg flow)
└── LocalStorage: zyon_buyer_token, zyon_buyer_auth_session

CheckoutWidgetPanel
├── POST /storefront/budget-requests
└── /api/checkout-token (embed token)

WidgetConfigProvider
└── GET /checkout-settings/widget-config

CartProvider
├── sessionStorage: zyon-cart-id:{merchantId}
└── GET /storefront/cart/{cartId}

initTriggerDetection
└── sessionStorage: aacp_intervention_count_*, aacp_trigger_last_*
```

---

## 16. ROADMAP PARA V2 SEM QUEBRAR

### Fase 1: Versioning (0% risk)
- ✅ Criar `/v2/storefront/*` endpoints
- ✅ Duplicar logic, adicionar new features
- ✅ Manter `/v1/storefront/*` para compatibilidade

### Fase 2: Dual-write (opt-in)
- Storefront recebe `?apiVersion=v2` query param
- Tenta v2 endpoints, fallback para v1 se falhar
- Logs e monitoring

### Fase 3: Migration (gradual)
- Set config flag `apiVersion: "v2"` por merchant
- Monitor error rates
- Rollback per merchant se necessário

### Fase 4: Cleanup
- Remove v1 endpoints after 6 months
- Archive logs

---

## 17. CHECKLIST ANTES DE V2

- [ ] Todos endpoints v1 mapeados?
- [ ] Todos block types têm v2 equivalent?
- [ ] Contexts (Cart, WidgetConfig) migraram?
- [ ] Socket.io namespaces renomeados?
- [ ] Authz headers/tokens compatíveis?
- [ ] Demo merchant setup no v2?
- [ ] E2E tests passam em v2?
- [ ] Performance não degradou?
- [ ] Merchant ID scoping mantido?
- [ ] sessionStorage keys não conflitam?

---

## Arquivo de referência

**Localização:** `c:/Users/Admin/Desktop/AACP/apps/storefront/`

**Próximos passos:**
1. Criar ADR-XXX para v2 architecture
2. Validar com time de backend
3. Iniciar Phase 1: versioning endpoints
4. Configurar feature flags por merchant
