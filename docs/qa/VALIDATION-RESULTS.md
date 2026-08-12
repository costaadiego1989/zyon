# Resultados de Validação Real — Zyon Checkout

**Data:** 2026-08-12
**Infra:** PostgreSQL Docker + API NestJS local + Widget Vite + React Store

---

## Fluxo Completo de Pagamento (VALIDADO)

### Card (Stripe) ✅ FUNCIONA
```
Start → Customer → Shipping (3 opções) → Card intent (201)
→ Stripe confirm (201) → status: approved → checkout_completed
```

### PIX (Asaas) ✅ FUNCIONA
```
Start → Customer → Shipping → PIX intent (201)
→ QR code gerado → Webhook PAYMENT_RECEIVED → checkout_completed_after_payment
```

### Boleto (Asaas) ✅ FUNCIONA
```
Start → Customer → Shipping → Boleto intent (201)
→ Bank slip URL gerada → Invoice URL disponível
```

### Crypto ✅ FUNCIONA
```
Start → Customer → Shipping → Crypto intent (201)
→ Wallet address gerada
```

---

## Dashboard → Widget Propagation (VALIDADO)

| Config | Dashboard | Widget Context | Status |
|--------|-----------|---------------|--------|
| mode | silent_until_trigger | silent_until_trigger | ✅ |
| position | bottom_right | bottom_right | ✅ |
| inviteText | Posso ajudar? | Posso ajudar? | ✅ |
| presentationMode | fab | fab | ✅ |
| startMinimized | true | true | ✅ |
| suppressed_steps | [] | [] | ✅ |
| blocked_regions | [] | [] | ✅ |
| handoff_enabled | true | true | ✅ |
| handoff_message | I can call a store specialist... | I can call a store... | ✅ |

---

## Cross-Sell (VALIDADO)

```
embed/start com SKU no carrinho → suggestedProducts retornado:
- "Carteira Slim RFID" — R$ 89,90 (categoria: acessórios)
```

Cross-sell funciona automaticamente quando há promoção configurada para o SKU.

---

## Brand/Agent Config (VALIDADO — API retorna corretamente)

| Campo | Valor da API | Fonte |
|-------|-------------|-------|
| brand.name | Athom Tech | merchant profile |
| brand.accent_color | #ba801c | merchant theme |
| brand.theme.agentName | Anamara | merchant theme |
| agent.name | Zion | agent-rules |
| agent.greeting | "Olá, estou aqui para..." | agent-rules |
| agent.tone | consultative | agent-rules |
| agent.language | pt-BR | agent-rules |

---

## React Store Integration (VALIDADO)

- ✅ App carrega em http://127.0.0.1:5180
- ✅ 4 produtos renderizam
- ✅ Add to cart funciona
- ✅ Cart page mostra total correto
- ✅ Checkout monta `<zyon-checkout-agent>` com merchant-id real
- ✅ Widget carrega com dados do merchant (Athom Tech, Zion, Pulse UI)
- ✅ Channel gate mostra (chat/voz)
- ✅ Cross-sell oferecido automaticamente
- ✅ Cupom PULSE10 aplicado (5% desconto)

---

## Merchant Rules (VALIDADO)

| Regra | Valor | Enforcement |
|-------|-------|-------------|
| maxDiscountPercent | 12% | ✅ rules-engine hard-cap |
| minimumMarginPercent | 51% | ✅ rejeita abaixo |
| allowFreeShipping | false | ✅ widget não oferece |
| couponBoxEnabled | true | ✅ cupom funciona |
| originZip | NÃO CONFIGURADO | ⚠️ Novo campo adicionado |

---

## Shipping (VALIDADO)

```
POST /embed/shipping/quote {destination_zip: "01311-100"}
→ 201: 3 opções retornadas (Correios PAC, Sedex, estimado)
POST /embed/shipping/select {carrier_key, quote_id}
→ 201: transportadora selecionada
```

---

## Segurança (VALIDADO)

| Check | Status |
|-------|--------|
| Token embed com allowedOrigin | ✅ Valida origin no request |
| Webhook Asaas token validation | ✅ 401 se token inválido |
| Webhook value mismatch protection | ✅ Detecta divergência de valor |
| shipping_method_required_before_payment | ✅ Bloqueia pagamento sem frete |
| asaas_customer_data_incomplete | ✅ Bloqueia sem fullName/CPF |
| Tenant isolation (orders) | ✅ Merchant A não vê B |

---

## E2E Playwright (VALIDADO)

```
7 tests passing (realapi project):
✅ smoke — seed endpoint works
✅ happy-path-pix — PIX renders
✅ happy-path-card — Card renders
✅ deterministic-chat — bubble renders + send message
✅ coupon — apply coupon + rejection
```

---

## Pendências para Próxima Fase

| Item | Bloqueador |
|------|-----------|
| Contas Shopify/Nuvemshop/Tray | Criação manual (OAuth, email) |
| LLM cross-sell validation | Precisa OpenAI key ativa |
| Dashboard visual (browser) | Precisa Playwright MCP funcional |
| PIX webhook E2E real | Precisa ngrok + Asaas sandbox callback |
| Onboarding flow E2E | Precisa dashboard + API rodando juntos |
