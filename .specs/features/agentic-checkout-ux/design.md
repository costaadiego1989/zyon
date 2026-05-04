# Design · agentic-checkout-ux

## High-level shape

```
┌─ Buyer ──────────────────────────────────────────────────────────┐
│                                                                  │
│   1. greets       2. types          3. taps "Aplicar oferta"     │
│       │              │                       │                   │
└───────┼──────────────┼───────────────────────┼───────────────────┘
        ▼              ▼                       ▼
┌──── Widget (apps/widget/src/main.tsx) ───────────────────────────┐
│   - reads StartCheckoutResponse.experience (theme + agent)       │
│   - streams new agent bubbles char-by-char                       │
│   - shows enterprise cart sidebar / mobile bottom-sheet          │
│   - renders coupon box per rules.couponBoxEnabled + discount==0  │
│   - banner + CTA after applyOffer                                │
└────┬─────────────────────────────────────────────────────────────┘
     │ POST /chat                       │ POST /offers/apply
     ▼                                  ▼
┌──── API (apps/api) ───────────────────────────────────────────────┐
│  SendChatMessageUseCase                                          │
│    1. extracts entities (email/CPF/phone/CEP/name) from message  │
│    2. patches session.customer + maybe session.shipping (CEP)    │
│    3. derives chatStage + missingFields                          │
│    4. calls ConversationPort with stage-aware ConversationInput  │
│    5. appends buyer + agent turns to chatHistory                 │
│  ApplyOfferUseCase                                               │
│    - applies authorized discount on session.cart.currentDiscount │
│    - rebuilds CheckoutExperienceSnapshot                         │
│    - appends agent turn "Aplicado · vamos para pagamento"        │
└────┬─────────────────────────────────────────────────────────────┘
     │
     ▼
┌──── @aacp/conversation-engine ───────────────────────────────────┐
│  generateSalesReply receives stage + missingFields              │
│  System prompt enforces "ask only the next missing field"       │
│  Falls back to deterministic stage-aware reply if no API key    │
└──────────────────────────────────────────────────────────────────┘
```

## Domain model changes

### `CheckoutSession` (shared-types)

```ts
interface CheckoutSession {
  // …existing
  paymentMethod?: "pix" | "credit_card";
  chatHistory: ChatTurn[];      // already exists
}
```

`chatStage` is **derived**, not stored, so we keep one source of truth:

```ts
function deriveChatStage(s: CheckoutSession, completed: boolean): ChatStage {
  if (completed) return "completed";
  const c = s.customer ?? {};
  if (!c.fullName || !c.email || !c.cpf || !c.phone) return "data_collection";
  if (!s.shipping || !c.address?.zip) return "shipping";
  if (!s.paymentMethod) return "payment";
  return "completed";
}
```

The "completed" flag comes from existing `CompleteOrderUseCase` recording `order.completed`; for now we treat any non-empty `paymentMethod` as ready to pay and the explicit complete event keeps its own log.

### `CustomerHints` (shared-types)

```ts
interface CustomerHints {
  email?: string;
  phone?: string;
  isReturning?: boolean;
  externalCustomerId?: string;
  fullName?: string;
  cpf?: string;            // 11 digits, no formatting
  address?: {
    zip?: string;          // 8 digits, no dash
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
  };
}
```

### `ChatStage` (shared-types)

```ts
export type ChatStage = "data_collection" | "shipping" | "payment" | "completed";
```

### `ConversationReplyInput` (api port)

```ts
interface ConversationReplyInput {
  // …existing fields
  stage?: ChatStage;
  missingFields?: string[];   // human-readable: ["nome", "email", "CPF", "telefone", "CEP"]
}
```

### `ChatMessageResponse` (shared-types)

Add `experience: CheckoutExperienceSnapshot` so the widget can re-render cart/totals immediately after every chat round (the user's customer data updates the snapshot).

### `ApplyOfferResponse` (shared-types)

Add `experience: CheckoutExperienceSnapshot` so the widget can refresh cart/totals on success.

### `MerchantRules` (shared-types)

```ts
interface MerchantRules {
  // …existing
  couponBoxEnabled: boolean;   // default true
}
```

## Entity extraction (deterministic)

Plain regex helpers in a new domain service `apps/api/src/modules/checkout/domain/services/customer-extraction.service.ts`:

```ts
extractEmail(text)   // \S+@\S+\.\S+
extractCpf(text)     // 11 digits, strip punctuation
extractCep(text)     // 8 digits, strip punctuation
extractPhone(text)   // 10–11 digits, strip punctuation
extractName(text, lastAgentTurn) // heuristic: short text, no digits, after a name-asking turn
```

The heuristic for name uses keywords in `lastAgentTurn?.text.toLowerCase()`: `nome|chamar|chamo|seu nome|como te|posso te chamar`.

## Conversation engine prompt

System prompt gains a stage block:

```
ETAPA ATUAL: data_collection
CAMPOS FALTANDO: nome, email, CPF, telefone, CEP

REGRA: Pergunte apenas pelo PRÓXIMO campo da lista de "campos faltando".
Se o comprador levantar uma objeção (preço, frete, dúvida) durante data_collection,
responda à objeção em uma frase e retome a coleta na frase seguinte.
Nunca peça vários campos na mesma mensagem.
```

The deterministic fallback (no LLM key) maps each `(stage, missingFields[0])` tuple to a canonical line:

```
data_collection / nome     → "Antes de continuar, posso saber seu nome completo?"
data_collection / email    → "Perfeito, {nome}. Qual seu melhor email para o pedido?"
…
shipping        / cep      → "Para calcular o frete preciso do seu CEP, pode informar?"
payment         / *        → "Vamos finalizar — prefere PIX ou cartão de crédito?"
completed       / *        → "Tudo pronto. Acompanhe a entrega no email enviado."
```

## Frontend architecture

### Widget panel layout (mobile-first, then desktop)

- Mobile: thread fills the screen, header sticky on top with collapsed cart pill, form fixed at bottom. Cart opens as a bottom-sheet drawer on tap.
- Desktop: thread + form left column (1.5fr), enterprise cart card right column (1fr).

### Streaming hook

`useStreamedText(text, options)` returns `[displayed, isStreaming]`. Algorithm:

1. If `text` is unchanged, no effect.
2. If `prefers-reduced-motion: reduce`, return text instantly.
3. Otherwise schedule `setInterval` at ~22ms appending one char until length matches.
4. Stop and clear interval.

A new agent bubble passes `streaming` only when its `occurredAt` is the most recent and matches `streamingTurnId`. We track `streamingTurnId` whenever new turns arrive from the chat response.

### Cart card

Replace the flat summary list with cards. Each item:

- 56×56 thumbnail (image_url) with rounded corners and 1px border.
- Name + variant + unit price.
- Quantity stepper (read-only for now: just shows "× N").
- Line total right-aligned.

Footer:

- Subtotal, shipping, discount (if > 0), total.
- Trust badges row.
- Coupon input (conditional on rules.couponBoxEnabled && discount === 0).
- "Aplicar oferta autorizada" CTA when an authorized offer is present and not yet applied.
- "Continuar para pagamento" CTA when discount > 0 OR session.shipping is set.

### Banner

Inserted between thread and form area when `experience.totals.discount > 0`:

```
┌──────────────────────────────────────────────────────┐
│  ✨ Oferta de R$ 89,98 aplicada · novo total R$ 839,72│
│                                  [Continuar →]       │
└──────────────────────────────────────────────────────┘
```

Tap on `Continuar` dispatches a chat message: `Quero seguir para o pagamento`, which the AI then handles.

## Tests

- **Domain**: `customer-extraction.service.spec.ts` covers email/CPF/CEP/phone/name regex and name heuristic.
- **Use case**:
  - `send-chat-message.use-case.spec.ts` extends to assert customer fields are patched and `experience` is returned.
  - `apply-offer.use-case.spec.ts` asserts the response carries refreshed `experience` with `totals.discount > 0` and a follow-up agent turn appended.
- **Engine**: `conversation-engine/src/index.spec.ts` extends to assert system prompt contains stage and the next missing field, and the deterministic fallback honours stage transitions.
- **Widget**: `main.test.tsx` extends to:
  - assert streaming on first new agent bubble and not on persisted history.
  - assert cart re-renders after a chat round that returns updated `experience`.
  - assert the banner appears when `discount > 0` and the CTA dispatches the right chat message.
  - assert coupon box visibility based on `rules.couponBoxEnabled` + `discount > 0`.

## Risks

- Streaming animation can confuse the e2e test runner. Mitigate by skipping streaming when `prefers-reduced-motion: reduce` or when an env flag (`AACP_DISABLE_STREAMING`) is set; tests opt-in to the static render.
- Regex extraction is brittle for international users; we restrict to BR formats for now and document this in the spec.
- Adding `experience` to chat/apply-offer responses bloats payload; acceptable given the cart is small (≤10 items typically).
