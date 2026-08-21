# WhatsApp Commerce — Decisões (context.md)

**Created:** 2026-08-21

---

## Decisões Finais

| # | Questão | Decisão | Rationale |
|---|---------|---------|-----------|
| D1 | Coleta de dados | Chat (nome, email, CPF) | Asaas precisa. Birthday default. Phone do WhatsApp |
| D2 | Navegação catálogo | Menus numerados 1-10, "1" mais, "0" volta | Determinístico, funciona em qualquer celular |
| D3 | Confirmação de ação | Número obrigatório ([1] Adicionar, [1] Finalizar, [2] Continuar) | Evita ambiguidade em ações com consequência |
| D4 | Pagamento | Link externo (Stripe/Asaas/MP) | Buyer abre no browser. Webhook confirma |
| D5 | Quick replies → números | Cada reply do banco = opção numerada | `StoreQuickRepliesConfig.stages[].replies[N]` → `[N+1] texto` |
| D6 | Asaas customer | Criado no momento do payment (já implementado) | name+email+cpf coletados por chat |
| D7 | Fee | Split em todo pedido (application_fee / split) | App owner recebe em toda transação |
| D8 | Rate limiting | Batch 5 segundos | Buyer manda 3 msgs rápidas → processa todas, responde uma vez |
| D9 | Multi-device | 1 número por merchant (1 device) | Simplicidade para PME |
| D10 | Groups | Ignorar 100% (`isGroup: true` → drop) | Sem complexidade de grupo |
| D11 | Audio | Phase 2 — Whisper (OpenAI) para transcrição | Já temos OpenAI key no .env. Custo ~$0.006/minuto |
| D12 | Proativo (cart recovery WA) | Não implementar | Minimizar custos. Buyer inicia sempre |

---

## Nota sobre Audio (D11)

Para audio no WhatsApp:
- BubbleWhats já envia URL do audio (`mimetype: "audio/ogg"`)
- Precisamos apenas chamar Whisper API (`POST /v1/audio/transcriptions`)
- Custo: ~$0.006/minuto de audio
- Já temos `OPENAI_API_KEY` configurada
- É literalmente: download audio → Whisper → texto → pipeline normal

**Decisão:** Phase 2. Fácil de adicionar, custo baixo. Não bloqueia Phase 1.

---

## Nota sobre Fee (D7)

Verificar se `create-payment-intent.use-case.ts` já inclui split/fee. Se não:
- Asaas: `split[{ walletId: platformWalletId, percentualValue: feePercent }]`
- Stripe: `application_fee_amount` no PaymentIntent (requer Connected Accounts)
- MercadoPago: `marketplace_fee`

O `transactionFeePercent` por plano já existe em `billing-plans.ts`:
- Starter: 2.49%
- Growth: 1.99%
- Scale: 1.49%

Essa % precisa ser aplicada como fee em cada payment intent.

---

## Rate Limiting — Batch 5s

Quando buyer manda 3 mensagens rápidas ("oi", "quero pizza", "calabresa"):
1. Primeira msg chega → inicia timer de 5s
2. Msgs seguintes chegam dentro de 5s → acumula no buffer
3. Timer expira → concatena todas como uma só msg: "oi\nquero pizza\ncalabresa"
4. Engine processa texto completo → resposta única

**Implementação:** Debounce per-session no `HandleIncomingMessageUseCase`.

Evita:
- 3 respostas separadas (spam no buyer)
- Race conditions no session state
- Custo LLM triplicado

---

## Flow Final Consolidado (com decisões aplicadas)

```
1. Buyer envia msg no WhatsApp
2. BubbleWhats webhook → nosso endpoint
3. Verificações:
   - isGroup? → DROP
   - fromMe? → DROP
   - deviceID → resolve merchantId (ou 404)
4. Debounce 5s (acumula msgs rápidas)
5. Após 5s:
   - Encontrar/criar WhatsAppSession (phone → session)
   - Se input é número → resolve para texto da opção ativa
   - Se input é "0" → volta menu anterior
   - Se input é texto → passa para engine
6. Engine processa (checkout ou storefront, dependendo do stage)
7. Resposta + quickReplies gerados
8. WhatsAppMenuRenderer formata com números
9. Salva currentOptions no WhatsAppSession
10. Envia via BubbleWhats send API
11. (Webhook status: delivery/read → analytics)
```
