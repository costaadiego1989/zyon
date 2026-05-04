# Feature: agentic-checkout-ux

## Goal

Transform the conversational checkout from "answers questions" to "drives the buyer through registration → shipping → payment → completion" with an enterprise-grade UI on both desktop and mobile, char-by-char AI streaming, live cart updates after offers, and a rule-driven coupon vs. authorized-discount split.

## Why

Current state (observed by user): the agent does not initialize the conversation properly, the buyer can negotiate before any data is collected, the cart never refreshes after an authorized offer is applied, the conversation dies after `applyOffer`, the cart panel is duplicated and visually amateur, and there is no perceived "agent personality" — replies pop in fully formed with no streaming.

## Scope

In scope:

- Backend stage state machine (`data_collection → shipping → payment → completed`) derived from `CheckoutSession` content.
- Capture buyer customer fields (name, email, CPF, phone, CEP) from chat messages via deterministic regex extraction in `SendChatMessageUseCase`.
- Conversation engine prompt extended with `stage`, `missing_fields`, and explicit instruction to ask only for the next missing field per turn.
- `ApplyOfferUseCase` returns the refreshed experience snapshot with updated totals and discount applied.
- Frontend conversational widget:
  - Char-by-char streaming animation for new agent bubbles.
  - Live cart refresh after offer applied; "−R$ X aplicado · Continuar para pagamento" banner.
  - Enterprise visual upgrade (cart cards with images, polished header with agent avatar, refined chat thread, polished form, micro-interactions).
  - Both desktop sidebar and mobile bottom-sheet variants for the cart.
  - Welcome message guaranteed on first render.
- Coupon UX: when `MerchantRules.couponBoxEnabled === true` AND no authorized discount has been applied, the cart shows a coupon input that submits `cart_coupon_input` chat events. When the AI gives an authorized offer, the coupon input hides.

Out of scope (deferred):

- Inline mini-form for batch customer data (`hybrid` option not selected).
- Visible 4-step stepper (`stages_indicator: implicit` chosen).
- Address autocomplete via external API.
- LLM function calling / tool use.
- Card payment data entry; PIX-first per existing payment adapter.

## Requirements

### REQ-1: Backend stage awareness

- REQ-1.1: `CheckoutSession` exposes `chatStage: "data_collection" | "shipping" | "payment" | "completed"` derived from `customer`, `shipping`, `paymentMethod`, and order completion state.
- REQ-1.2: `CustomerHints` is extended with optional `fullName`, `cpf`, `address` (zip, street, number, city, state).
- REQ-1.3: `CheckoutSession` gains optional `paymentMethod: "pix" | "credit_card"`.

### REQ-2: Customer extraction from chat

- REQ-2.1: `SendChatMessageUseCase` runs deterministic regex extractors on the incoming `user_message` and patches `session.customer` (email, CPF as 11 digits, CEP as 8 digits, phone as 10–11 digits) before calling the conversation engine.
- REQ-2.2: When the previous agent message ended with a "name request" pattern and the buyer's next message is short text without digits/symbols, the use case treats it as `fullName`.
- REQ-2.3: The chat response includes the updated `customer` and the recomputed `experience` snapshot.

### REQ-3: Stage-aware agent prompt

- REQ-3.1: `ConversationReplyInput` carries `stage` and `missingFields: string[]`.
- REQ-3.2: The system prompt includes the current stage, missing fields, and an explicit rule: "Ask only the single next missing field per turn. Do not negotiate before data_collection is complete unless the buyer raises an objection."
- REQ-3.3: The deterministic safe fallback used when no LLM key is configured respects the stage and asks only for the next missing field.

### REQ-4: Apply offer refreshes the experience

- REQ-4.1: `ApplyOfferResponse` is extended with `experience: CheckoutExperienceSnapshot` reflecting the discount applied to `totals.discount` and `totals.total`.
- REQ-4.2: After a successful apply, the session's `cart.currentDiscount` updates so subsequent `experience` snapshots stay consistent.
- REQ-4.3: A new agent turn is appended to `chatHistory` with text in the form "Aplicado o desconto X. Vamos para o pagamento — PIX ou cartão?".

### REQ-5: Coupon vs authorized discount rule

- REQ-5.1: `MerchantRules` exposes `couponBoxEnabled: boolean` (default `true`).
- REQ-5.2: The widget renders a coupon input only when `rules.couponBoxEnabled === true` AND `experience.totals.discount === 0`. After any approved offer, the coupon input hides.
- REQ-5.3: Submitting the coupon input dispatches a chat message of the form `Tenho o cupom: <CODE>` so the agent and rule engine can decide whether to honour it; the engine never auto-applies an unauthorized code.

### REQ-6: Char-by-char streaming on new agent bubbles

- REQ-6.1: The widget tracks a `streamingTurnId` (the latest agent turn since open). The corresponding bubble renders character by character at ~22ms per char with a blinking caret.
- REQ-6.2: Bubbles loaded as part of `experience` history (page reload, prior session) render instantly without streaming.
- REQ-6.3: The streaming respects `prefers-reduced-motion: reduce` and degrades to instant render.

### REQ-7: Welcome message guaranteed

- REQ-7.1: On first successful `start_checkout`, the widget renders the agent greeting from `experience.agent.greeting` immediately as a streaming agent bubble.
- REQ-7.2: When `chatHistory` is empty and the conversation engine is reached without a buyer message, the engine still produces a welcome turn that asks for the first missing field (name).

### REQ-8: Enterprise UI upgrade

- REQ-8.1: Header shows agent avatar, agent name, online dot, and merchant name; merchant logo lives in the cart card.
- REQ-8.2: Cart card lists each item with thumbnail, qty, unit price, and line total; footer shows subtotal, shipping, discount, total. Discount row only renders when `> 0`.
- REQ-8.3: An "Oferta aplicada" banner appears between the thread and the form when `experience.totals.discount > 0` and offers a "Continuar para pagamento" CTA.
- REQ-8.4: All interactive elements have hover/active/focus states and ≥44px tap targets on mobile.
- REQ-8.5: On mobile the cart collapses behind a "Ver pedido (R$ X)" pill in the header; tapping opens a bottom-sheet drawer; on desktop the cart is the right sidebar.

## Out of Scope

- Multi-merchant marketplace UX.
- Address autocomplete services.
- LLM tool/function calling.
- Real card-data PCI capture.
- Persistent UAT recording.

## Acceptance Criteria

- AC-1: A buyer with no prior data sees a welcome message asking for their name within 2 seconds of mounting the widget. (REQ-3, REQ-7)
- AC-2: Replying with `joao@empresa.com` advances the session: a follow-up agent turn asks for the missing CPF (or the next field) and `session.customer.email` is set. (REQ-2)
- AC-3: When the agent authorizes a 10% offer and the buyer applies it, the cart's total decreases by 10% and a follow-up agent turn invites payment selection without the conversation stalling. (REQ-4)
- AC-4: With `couponBoxEnabled: false`, the coupon input is absent. With `true` and `discount === 0`, it is present; after applying any offer, it disappears. (REQ-5)
- AC-5: New agent bubbles type out char by char; reloading the page renders persisted history instantly. (REQ-6)
- AC-6: On a 360px viewport the cart is collapsed and accessible via a bottom-sheet; on a 1280px viewport it is the right sidebar. The form is always visible above the keyboard. (REQ-8)
