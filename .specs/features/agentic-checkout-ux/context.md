# Context · agentic-checkout-ux

User decisions captured before design (gray areas closed):

| Gray area | Decision |
| --- | --- |
| **Customer data collection** | `chat_only` — the agent asks each missing field turn by turn (name → email → CPF → phone → CEP). No inline form. |
| **Stage indicator** | `implicit` — no visible stepper. The agent narrates transitions ("vamos para o frete", "agora pagamento"). |
| **Chat animation style** | `stream_chars` — char-by-char streaming for new agent bubbles, ChatGPT-like. Persisted history (reload) renders instantly. |
| **Post-offer flow** | `confirm_then_continue` — cart updates with new totals, a banner shows "−R$ X aplicado" with a "Continuar para pagamento" CTA. The CTA dispatches a chat message that drives the agent into the payment stage. |

Implications:

- The conversation engine prompt must explicitly forbid asking for several fields at once (chat_only + implicit stages).
- Streaming runs only on the latest agent bubble; everything older is rendered synchronously.
- Coupon vs. authorized-discount split keeps an old MerchantRules toggle (`couponBoxEnabled`) honoured by the widget, not by the engine — engine never auto-applies an unauthorized code.
