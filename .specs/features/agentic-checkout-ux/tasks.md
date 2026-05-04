# Tasks · agentic-checkout-ux

> TDD-first. Each task has a RED test commit and a GREEN implementation commit (or single commit when test+impl are atomic). Conventional commits, English subject, Portuguese body if needed.

## T1 · Shared types: stage, paymentMethod, customer fields, MerchantRules.couponBoxEnabled

- **What**: Extend `packages/shared-types/src/index.ts` with `ChatStage`, `paymentMethod` on `CheckoutSession`, full `CustomerHints` (fullName/cpf/address), `couponBoxEnabled` on `MerchantRules` (default true), and add `experience` to `ChatMessageResponse` and `ApplyOfferResponse`.
- **Done when**: `pnpm --filter @aacp/shared-types build` passes and the API typecheck still compiles after the use cases below are updated to return `experience`.
- **Tests**: type-only.

## T2 · Customer extraction service (TDD)

- **What**: New `apps/api/src/modules/checkout/domain/services/customer-extraction.service.ts` with `extractEmail`, `extractCpf`, `extractCep`, `extractPhone`, `extractName`, and `deriveChatStage`. Spec file alongside.
- **Tests**: `customer-extraction.service.spec.ts` covers happy paths, junk text, and BR formatting.
- **Done when**: spec passes and the use case in T3 imports the service.

## T3 · SendChatMessageUseCase: extract + patch + return experience (TDD)

- **What**: Inject the extractor; before calling the conversation port, extract entities from `user_message`, patch `session.customer` and `session.shipping.region/zip`, derive `chatStage` and `missingFields`, pass them to the engine, then return `experience` rebuilt from the patched session.
- **Tests**: extend `send-chat-message.use-case.spec.ts` with: (a) email-only message patches `customer.email`; (b) name heuristic when last agent turn asked for name; (c) returned response carries `experience.totals` and `experience.brand.theme`.
- **Done when**: green tests + `apps/api/src/test-runner.ts` includes the new spec import.

## T4 · ConversationPort + engine: stage and missingFields (TDD)

- **What**: Extend `ConversationReplyInput` with `stage?: ChatStage` and `missingFields?: string[]`. Update the system prompt and the deterministic fallback in `packages/conversation-engine/src/index.ts` to honour the next missing field (greeting/name/email/cpf/phone/cep/payment).
- **Tests**: extend `packages/conversation-engine/src/index.spec.ts` with two cases — (a) the LLM call carries stage + nextField in the system message; (b) the no-API-key fallback returns the right canned line for each `(stage, nextField)` pair.
- **Done when**: green tests; safe fallback never asks for two fields in one turn.

## T5 · ApplyOfferUseCase: refresh experience + append agent turn (TDD)

- **What**: After a successful apply, set `session.cart.currentDiscount` to the resolved discount amount, persist it, append an agent turn ("Aplicado o desconto …. Vamos para o pagamento — PIX ou cartão?"), and return `experience` rebuilt from the updated session inside `ApplyOfferResponse`.
- **Tests**: extend `apply-offer.use-case.spec.ts` with: (a) discount value reflected in `experience.totals.discount` and `total`; (b) chat history grows by one agent turn; (c) repeated apply does not double-append.
- **Done when**: green tests; controller and embed controller forward the extra `experience` field unchanged.

## T6 · Widget streaming hook + bubble (TDD)

- **What**: Add `apps/widget/src/use-streamed-text.ts` returning `[displayed, isStreaming]` with `prefers-reduced-motion` and `AACP_DISABLE_STREAMING` env-flag opt-out. Wire it into the new bubble component used only for the latest agent turn since open.
- **Tests**: `main.test.tsx` adds: (a) streaming starts at length < text.length and finishes at full length; (b) when `matchMedia('(prefers-reduced-motion: reduce)')` matches, full text appears immediately; (c) bubbles loaded as initial history render full instantly.
- **Done when**: green tests; vitest run is green.

## T7 · Widget cart card + coupon box + banner (TDD)

- **What**: Replace `.aacp-summary-sheet` content with a richer card list (thumbnails, qty pill, line total) + footer (subtotal/shipping/discount/total). Add coupon input gated by `rules.couponBoxEnabled && discount === 0`. Add a `.aacp-offer-banner` between thread and form when `discount > 0` with a "Continuar para pagamento" button that submits a chat message.
- **Tests**: `main.test.tsx` adds: (a) coupon box rendered when discount==0 and `rules.couponBoxEnabled !== false`; (b) coupon box hidden when discount>0; (c) banner CTA dispatches a chat message containing "pagamento".
- **Done when**: green tests; UI matches mobile-first then ≥768px sidebar.

## T8 · Widget refresh experience after chat & apply-offer (TDD)

- **What**: When `ChatMessageResponse.experience` is present, replace local `experience` state with it. Same for `ApplyOfferResponse.experience`. The widget therefore always shows live cart numbers and the banner.
- **Tests**: extend `main.test.tsx` to mock a chat reply with updated totals and assert the cart re-renders to the new total without a page reload.
- **Done when**: green tests.

## T9 · CSS enterprise polish + mobile bottom-sheet

- **What**: Refine `apps/widget/src/styles.css`: brand bar with avatar, refined chat thread (smoother bubble shadow, timestamp under each bubble), polished input capsule, mobile bottom-sheet drawer for cart triggered by a "Ver pedido" pill in the header.
- **Tests**: visual; covered in `main.test.tsx` only by structure assertions (presence of `.aacp-cart-toggle`).
- **Done when**: layout works at 360px, 768px, 1280px breakpoints in the demo page.

## T10 · Welcome + initial fallback turn

- **What**: When `chatHistory` is empty after `start_checkout`, ensure the widget shows the agent greeting from `experience.agent.greeting` immediately as a streaming bubble. The conversation engine fallback returns "Olá! Sou o {agentName} da {merchantName}. Antes de continuar, posso saber seu nome completo?" when called with empty history at `data_collection` stage.
- **Tests**: covered by T4 fallback tests + a widget assertion that on mount the greeting appears.

## T11 · End-to-end: live AI multi-turn purchase with extraction

- **What**: Extend `checkout.ai-live-e2e-spec.ts` with a scenario where the buyer answers `joao silva`, `joao@example.com`, `12345678901`, `11988887777`, `01001000`, then negotiates, applies offer, and the order completes. Assert customer.fullName/email/cpf/phone/zip are patched and the offer banner data is reflected in the response chain.
- **Done when**: skipped without `RUN_REAL_AI_E2E=true`, runs successfully when enabled.

## T12 · Docs

- **What**: Update `docs/integrations/checkout-widget-and-api.md` and `README.md` to describe the new stage flow, customer extraction guarantees, the coupon-vs-discount split, and the streaming UX (and how to opt out via `AACP_DISABLE_STREAMING=1`).
- **Done when**: doc passes a quick read-through and references the right endpoints/types.
