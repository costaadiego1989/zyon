# Tenant Integrations MVP

## Summary

Close the pilot-ready merchant integration layer for AACP: server-to-server API keys, outbound tenant webhooks, inbound tracking updates, operational tenant dashboard surfaces, professional embed issuance, and a final enterprise-grade checkout theme polish controlled by merchant configuration.

## Requirements

- **TIM-R001 API keys:** A logged-in merchant can create, list, and revoke server-to-server API keys. Raw keys are displayed once, only hashes are stored, and every key has scopes.
- **TIM-R002 API key auth:** Server-to-server routes accept `Authorization: Bearer <key>` or `X-AACP-API-Key`, resolve the merchant from the key, reject revoked keys, and update last-used metadata.
- **TIM-R003 Webhook configuration:** A logged-in merchant can configure webhook endpoints with URL, enabled events, active flag, signing secret, delivery status, test send, and replay.
- **TIM-R004 Webhook signing:** Every outbound webhook uses a stable envelope with `event_id`, `event_type`, `merchant_id`, `occurred_at`, `api_version`, and `data`; headers include `X-AACP-Event-Id`, `X-AACP-Event-Type`, `X-AACP-Timestamp`, and `X-AACP-Signature`.
- **TIM-R005 Webhook delivery:** Outbound tenant webhooks are at-least-once and asynchronous. Failed tenant receivers never undo checkout completion.
- **TIM-R006 Order approved event:** `order.approved` includes order number, session id, items, totals, selected freight, customer data, payment summary when available, and pending tracking.
- **TIM-R007 Customer upsert event:** `customer.upserted` is emitted only when there is merchant context, such as checkout capture, session login, or completed checkout. Global buyer registration alone is not tenant-scoped.
- **TIM-R008 Tracking inbound:** Tenant backends can call `PUT /integrations/orders/:external_order_id/tracking` with API key auth to register tracking code, carrier, URL, status, and optional timeline events.
- **TIM-R009 Fulfillment persistence:** Shipments and tracking events persist in Prisma and in-memory adapters so hub/dashboard state is not process-local only.
- **TIM-R010 Hub tracking:** Buyer hub search and purchase cards show pending tracking, current tracking code, carrier, URL, status, and available event timeline.
- **TIM-R011 Dashboard operations:** Tenant dashboard includes menus for `Integracoes`, `Pedidos/Envios`, `Clientes`, and `Embed`, with forms/logs to operate the MVP without database edits.
- **TIM-R012 Professional embed:** `POST /embed-sessions` can be called by tenant backend API key and supports allowed origin, scopes, and cart reference in the token claims.
- **TIM-R013 Enterprise checkout theme:** Merchant theme controls accent, text, background, surface colors, success/warning colors, fonts, logo, agent avatar, border radius, density, header/title/subtitle copy, trust badges, and optional background image.
- **TIM-R014 Checkout UX finish:** Checkout must feel enterprise/premium: restrained palette, strong typography, clear steps, no premature freight value, no final success until approved payment, accessible focus states, and mobile/desktop layouts without text overflow.
- **TIM-R015 Tests:** API, Prisma, dashboard, widget, and Playwright real-api tests validate API keys, webhooks, tracking inbound, hub tracking, dashboard forms, embed token issuance, and full checkout success.

## Non-Goals

- OAuth marketplace install flow.
- Real carrier adapters for every logistics provider.
- Blocking checkout success on tenant webhook success.
- Storing raw card data, CVV, commerce secrets, payment provider secrets, or tenant private credentials in browser payloads.

## Acceptance

- A merchant creates an API key and webhook, completes checkout, receives `order.approved`, registers tracking through the API, and the buyer hub finds the tracking state.
- Dashboard exposes the integration and shipment operations used in the pilot.
- The checkout visual system is configurable by tenant and looks polished with default settings.
- Source docs, task status, tests, and commits stay aligned.
