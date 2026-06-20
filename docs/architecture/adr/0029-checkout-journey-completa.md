# ADR — Jornada Completa do Checkout AACP (Chat + Voz)

- **Status:** Proposta (contrato de implementação e testes)
- **Data:** 2026-06-20
- **Autor:** architect-adr
- **Escopo:** Widget conversacional embutido (`apps/widget`, React/Vite) + API (`apps/api`, NestJS)
- **Aplica-se a:** Ambos os canais — chat por texto (`data-channel="chat"`) e voz (`data-channel="voice"`)
- **Objetivo:** Mapear, passo a passo, toda a jornada do comprador no checkout — estados, transições, variáveis de sucesso/erro, cópia de recuperação e seletores e2e estáveis — para servir de **contrato** de implementação e base de testes Playwright.

---

## 0. Sumário executivo / decisões-chave

1. **Máquina de estágios é derivada no servidor**, não no widget. O estágio (`data_collection → shipping → payment → completed`) é calculado por `deriveChatStage()` a partir do preenchimento da entidade `CheckoutSession`. O widget apenas reflete esse estágio em `data-stage`. Fonte da verdade: `apps/api/.../domain/services/customer-extraction.service.ts:156-171`.
2. **PIX é real (Asaas), webhook-driven, nunca aprova síncrono.** A cobrança nasce em `requires_action`/`pending` e só conclui via webhook (`PAYMENT_RECEIVED → approved`; `PAYMENT_OVERDUE | PAYMENT_DELETED → failed`). O widget faz polling do status persistido a cada 4s por até 10 min. Decisão de UX nova: exibir um componente de **"aguardando/escutando pagamento"** dedicado quando PIX estiver selecionado (hoje só existem mensagens de agente).
3. **Layout unificado voz↔chat.** O layout de voz será reconstruído reaproveitando o layout de **chat ambientado para voz** (meio-termo): mesma espinha (thread + painéis + journey stepper), com camada de voz (orb + legendas + estado) por cima. Isso resolve a "bagunça" do voice atual.
4. **Gaps de produto a fechar:** cross-sell/order-bump não aparece (bloqueado por estágio e por falta de chamada efetiva), crypto não aparece (gating exige 6 campos do snapshot + `cryptoPayments.enabled`), cartão Stripe está "em ativação" (provider não configurado), frete mistura R$0 e pago sem distinção visual, e quick replies iniciais reaparecem após uso.
5. **Seletores e2e são contrato.** `data-channel`, `data-stage`, `data-voice-state`, `data-risk` e as classes `.aacp-*` listadas na seção 12 **não podem quebrar** — são o ponto de ancoragem de toda a suíte Playwright. Qualquer renomeação exige migração coordenada dos testes.

---

## 1. Modelo de estados global (fonte da verdade)

### 1.1 Estágios do checkout (`data-stage`)

Ordem canônica e rótulos — `apps/widget/src/hooks/checkout-presentation.ts:32-37`:

| Ordem | `data-stage`        | Rótulo PT  | Condição de saída (servidor)                                              |
|-------|---------------------|------------|---------------------------------------------------------------------------|
| 1     | `data_collection`   | Cadastro   | nome + email + email_verified + cpf + phone + phone_verified preenchidos  |
| 2     | `shipping`          | Entrega    | zip + street + city/state + address_verified + number + complement + frete |
| 3     | `payment`           | Pagamento  | `paymentMethod` definido                                                  |
| 4     | `completed`         | Concluído  | pedido confirmado / pagamento aprovado                                     |

Derivação canônica — `apps/api/src/modules/checkout/domain/services/customer-extraction.service.ts:156-171`:

```ts
export function deriveChatStage(session, completed = false): ChatStage {
  if (completed) return "completed";
  const c = session.customer ?? {};
  if (!c.fullName || !c.email || !c.email_verified || !c.cpf || !c.phone || !c.phone_verified)
    return "data_collection";
  const addr = c.address ?? {};
  if (!addr.zip || !addr.street || !(addr.city && addr.state) || !c.address_verified ||
      !addr.number || addr.complement === undefined || !session.shipping)
    return "shipping";
  if (!session.paymentMethod) return "payment";
  return "completed";
}
```

> **Contrato e2e:** o atributo `data-stage` deve refletir **exatamente** esses 4 valores. Não introduzir estágios intermediários no DOM — substeps (cross-sell, cupom, método) vivem dentro de `payment` via `prePaymentStep` (ver §5–§7).

### 1.2 Substeps de pré-pagamento (`prePaymentStep`)

Dentro do estágio `payment`, o widget orquestra substeps — `apps/widget/src/hooks/checkout-presentation.ts:398-427`:

- `cross_sell` → order bump / produtos sugeridos
- `coupon_gate` → "quer usar cupom?" (Sim/Não)
- `coupon_entry` → digitar cupom
- `payment_method` → escolher método (PIX / cartão / crypto)

### 1.3 Estados de voz (`data-voice-state`)

`apps/widget/src/features/onboarding/VoiceCheckoutExperience.tsx:49` — valores: `idle | listening | speaking | thinking | confirming`.

### 1.4 Cart journey (rail lateral)

`apps/widget/src/hooks/checkout-presentation.ts:22-29`:

| key        | rótulo curto | descrição                    |
|------------|--------------|------------------------------|
| `items`    | Carrinho     | Itens no carrinho            |
| `identity` | Dados        | Nome, e-mail e contato       |
| `delivery` | Frete        | CEP e opção de envio         |
| `payment`  | Pagamento    | PIX ou cartão seguro         |

---

## 2. Abertura / Channel Gate (voz vs chat)

**Componente:** `apps/widget/src/features/onboarding/AgentChannelWelcome.tsx`
**Modelo/seletor:** `apps/widget/src/presentation/models/channel-welcome.model.ts`, `.../selectors/channel-welcome.selector.ts`

### 2.1 Estados do gate

| Estado          | Condição (model)                          | UI                                                                | Fonte                                  |
|-----------------|-------------------------------------------|-------------------------------------------------------------------|----------------------------------------|
| Loading         | `!model.channelReady`                     | "Sincronizando sessão com a loja…"                                | `AgentChannelWelcome.tsx:58-62`        |
| Erro de rede    | `model.networkError` truthy               | Alerta + botão "Tentar de novo"                                   | `AgentChannelWelcome.tsx:51-57`        |
| Pronto          | `!model.busy && model.channelReady`       | Dois botões habilitados (voz / chat)                              | `AgentChannelWelcome.tsx:70,86`        |
| Visível?        | `vm.showChannelWelcome`                   | controla render do gate                                           | `channel-welcome.selector.ts:8`        |

### 2.2 Seleção de canal

- Voz: `onSelectVoice → vm.selectPurchaseChannel("voice")` — `channel-welcome.selector.ts:17`. Botão: `.aacp-channel-gate__channel--voice.is-featured`, label "Comprar por voz" / tag "Recomendado" — `AgentChannelWelcome.tsx:66-80`.
- Chat: `onSelectChat → vm.selectPurchaseChannel("chat")` — `channel-welcome.selector.ts:18`. Botão: `.aacp-channel-gate__channel--chat`, label "Comprar por chat" / tag "Texto" — `AgentChannelWelcome.tsx:82-96`.

Ao escolher, monta-se a experiência correspondente:
- Chat: `<section data-channel="chat">` — `apps/widget/src/app/ChatCheckoutExperience.tsx:21`
- Voz: `<section data-channel="voice">` — `apps/widget/src/features/onboarding/VoiceCheckoutExperience.tsx:48`

### 2.3 Quick replies iniciais ("oi" etc.)

Definição — `apps/widget/src/hooks/use-checkout-chat.ts:28-32`:

```ts
const DEFAULT_QUICK_REPLIES = [
  { label: "Olá!" },
  { label: "Quero começar" },
  { label: "Quero finalizar agora" },
];
```

- **Aparecem quando:** `!lastChat` (nenhuma resposta de chat ainda) — `use-checkout-chat.ts:103-107`.
- **Não aparecem quando:** `!isConversational`, `turns.length < 1`, `busy`, ou `isCartEmpty` — `use-checkout-chat.ts:99-100`.

> **Variável de erro (bug §11.7):** quando `lastChat` volta a `null` depois de ter sido preenchido, o `useMemo` (`use-checkout-chat.ts:134`) recomputa e **as quick replies iniciais reaparecem indevidamente**. Estado esperado: uma vez que o comprador enviou a primeira mensagem (ou avançou de estágio), os defaults `DEFAULT_QUICK_REPLIES` **não devem voltar**. Ver §11.7 para a correção.

### Contrato Channel Gate

| Item             | Valor                                                                |
|------------------|----------------------------------------------------------------------|
| Prompt do agente | "Como você prefere comprar?" (gate visual, sem turno de chat)        |
| Input esperado   | clique em voz **ou** chat                                            |
| Sucesso          | `data-channel` setado; experiência montada                          |
| Erro             | `networkError` → alerta + retry; `!channelReady` → loading            |
| Seletores e2e    | `.aacp-channel-gate`, `.aacp-channel-gate__channel--voice`, `.aacp-channel-gate__channel--chat`, `[data-channel]` |

---

## 3. Reconhecimento de comprador recorrente vs novo cadastro

**Fonte da verdade:** `apps/api/src/modules/checkout/application/services/checkout-customer.service.ts:287-320` (`hydrateReturningBuyerFromEmailHint`).

### 3.1 `hydrateReturningBuyerFromEmailHint`

- **Quando dispara:** após o e-mail ser capturado (`customer.email` setado) e **antes** de `email_verified`.
- **O que verifica:** existe `BuyerAccount` por e-mail **OU** `CheckoutSession` anterior com mesmo e-mail e mesmo `merchantId`.
- **Quando reconhece (`priorEmailVerified`):**
  - `email_verified = true`, `otp_code = ''` → **pula o OTP de e-mail**
  - `recognized_buyer = true`, `isReturning = true`
  - hidrata `fullName`, `cpf`, `phone`, `address` da conta/sessão anterior
  - `phone_verified = true` se a conta tem telefone (pula OTP SMS)
  - `address_verified = true` se há endereço completo
  - liga `globalUserId` à conta reconhecida

### 3.2 Skip de auto-cadastro (widget)

`shouldSkipAutoRegistration` — `apps/widget/src/hooks/checkout-presentation.ts:450-454`. Retorna `true` se:
- `email_verified`, **ou**
- `email` + (`otp_code` **ou** `fullName`), **ou**
- `recognized_buyer` + cadastro completo.

Bootstrap relacionado — `use-checkout-chat.ts`:
- `autoTriggerRegistration` (`:439`) — envia `"Iniciar cadastro"` quando não há hint de e-mail ou e-mail já verificado.
- `bootstrapCustomerEmail` (`:462`) — injeta o e-mail como primeiro turno quando capturado mas não verificado.

### 3.3 Variáveis de fluxo

| Cenário                 | Etapas puladas                                  | data-stage de entrada      |
|-------------------------|-------------------------------------------------|----------------------------|
| Novo comprador          | nenhuma                                         | `data_collection` (do zero) |
| Recorrente reconhecido  | OTP e-mail, CPF, telefone, OTP SMS, endereço    | pode entrar em `shipping`/`payment` |
| Recorrente parcial      | só o que já estava verificado                   | varia conforme campos      |

> **Variável de erro:** se a hidratação reconhecer o e-mail mas o endereço estiver incompleto, o estágio cai para `shipping` (não pular para pagamento). Garantir que `address_verified` só seja `true` com endereço **completo**.

---

## 4. Cadastro passo a passo (estágio `data_collection`)

**Extração:** `apps/api/.../domain/services/customer-extraction.service.ts`
**Prompts/quick replies:** `apps/api/.../application/services/checkout-experience.service.ts:30-110`
**Patch de cliente:** `checkout-customer.service.ts` (`buildCustomerPatch`)

Ordem dos campos: `DATA_FIELD_ORDER` (`customer-extraction.service.ts:173-181`); faltantes via `missingFieldsForStage()` (`:187-226`).

### 4.1 E-mail

- **Prompt:** agente pede e-mail.
- **Validação:** `EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/`, TLD ≥ 2.
- **Sucesso:** e-mail aceito → dispara OTP via Brevo (ou hidratação recorrente §3).
- **Erro/retry:** e-mail inválido → reprompt. Reenvio: `/reenviar.*(email|e-mail)/i`.
- **Quick replies:** "Vão me mandar SPAM?" / "Posso usar outro e-mail?" / "Vocês enviam a nota por e-mail?".

### 4.2 OTP de e-mail

- **Prompt:** "Digite o código enviado para seu e-mail".
- **Validação:** `extractOtp()` — 4–6 dígitos, prefere rótulo "otp/código/code".
- **Verificado em:** `buildCustomerPatch()` (~`:192-203`); seta `email_verified`.
- **Erro:** "Código de verificação inválido. Por favor, confira o código enviado para o seu e-mail e tente novamente." — `checkout-customer.service.ts:248`.
- **Quick replies:** "Reenviar código de e-mail" / "Não recebi o código" / "Qual e-mail foi usado?".

### 4.3 Nome

- **Prompt:** disparado quando `lastAgentTurn` casa `/\b(nome\s*completo|seu\s+nome|...)\b/i`.
- **Validação:** `extractName` / `extractStandaloneName` — 1–5 tokens, filtra fillers (é, e, sou, meu, nome, me, chamo), rejeita stopwords (quero, cupom…), exige início capitalizado no modo standalone.
- **Quick replies:** "Por que precisa do meu nome?" / "Posso usar nome de empresa?" / "É seguro informar dados aqui?".

### 4.4 CPF

- **Prompt:** agente pede CPF.
- **Validação:** `extractCpf` — 11 dígitos consecutivos. **Não há validação mod-11 hoje** (ver §11 oportunidade).
- **Quick replies:** "Por que o CPF é obrigatório?" / "Posso informar CNPJ?" / "É seguro enviar meu CPF?".

### 4.5 Telefone

- **Prompt:** agente pede celular.
- **Validação:** `extractPhone` → `isBrazilianMobilePhone` — celular BR, 11 dígitos com 9 na posição após DDD. Regex `/\(?\s*(\d{2})\s*\)?\s*-?(\d{4,5})\s*-?\s*(\d{4})/`.
- **Erro:** "Precisamos de um celular com DDD (ex: 11 98888-7777) para enviar o rastreio pelo WhatsApp." — `checkout-customer.service.ts:227`.
- **Quick replies:** "Vocês vão me ligar?" / "Mandam rastreio por WhatsApp?" / "Por que precisa ser celular?".

### 4.6 OTP SMS

- **Prompt:** "Digite o código enviado por SMS".
- **Validação:** `extractOtp()` — 4–6 dígitos. Seta `phone_verified`.
- **Erro:** "Código de verificação do celular inválido. Por favor, confira o código enviado por SMS e tente novamente." — `checkout-customer.service.ts:253`.
- **Resend:** `/reenviar.*(c[oó]digo|sms|celular)/i`.
- **Quick replies:** "Reenviar código SMS" / "Não recebi o SMS" / "Posso usar outro número?".

### Contrato Cadastro

| Campo   | Sucesso (seta)    | Erro principal                     | Retry              |
|---------|-------------------|------------------------------------|--------------------|
| email   | `customer.email`  | regex inválido                     | reprompt           |
| OTP mail| `email_verified`  | código inválido (`:248`)           | reenviar e-mail    |
| nome    | `fullName`        | tokens rejeitados                  | reprompt           |
| cpf     | `cpf`             | < 11 dígitos                       | reprompt           |
| phone   | `phone`           | não-celular (`:227`)               | reprompt           |
| OTP SMS | `phone_verified`  | código inválido (`:253`)           | reenviar SMS       |

**Seletores e2e (auth/registration):** `.aacp-auth-layer`, `.aacp-auth-dialog`, `.aacp-login-panel`, `.aacp-auth-form`, `.aacp-auth-field`, `.aacp-auth-input-wrap`, `.aacp-auth-primary`, `.aacp-auth-error` (`role=alert`), `.aacp-auth-status` (`role=status`) — `apps/widget/src/components/checkout/GlobalAuthModal.tsx`.

---

## 5. Endereço & CEP (estágio `shipping` — parte 1)

**Lookup:** `apps/api/.../domain/services/viacep-lookup.service.ts:14-53`

### 5.1 CEP

- **Validação:** `extractCep` — `\b(\d{5})-?(\d{3})\b` ou 8 dígitos.
- **Lookup ViaCEP:** `https://viacep.com.br/ws/{cep}/json/`, timeout 4500ms (AbortController).
- **Mapeamento:** `logradouro→street`, `complemento→complement`, `bairro→neighborhood`, `localidade→city`, `uf→state`.
- **Erro:** retorna `null` em falha/timeout/`erro=true`; fallback `estimatePacQuote(state, zip)` (PAC R$28,90 SE / R$38,90 outros, 4–8 dias).
- **Quick replies:** "Como calculo o frete?" / "Entregam em todo o Brasil?" / "Não sei meu CEP, como faço?".

### 5.2 Confirmar endereço

- Retornado quando o lookup teve sucesso mas faltam zip/city/state.
- **Quick replies:** "O CEP está correto" / "Não encontram meu endereço" / "Qual o problema com o CEP?".

### 5.3 Número

- **Validação:** `extractAddressDetailLine` — `^\d{1,6}[a-zA-Z]?` ou "S/N".
- **Quick replies:** "Minha casa não tem número" / "Como informo o bloco?" / "Moro em zona rural".

### 5.4 Complemento

- **Validação:** texto livre (máx 160 chars) ou "Não tem". `complement` deve ser `!== undefined` para fechar o estágio (string vazia conta como respondido).
- **Quick replies:** "Não tem" / "Como informo o bloco?" / "Moro em zona rural".

---

## 6. Seleção de frete (estágio `shipping` — parte 2)

**Serviço:** `apps/api/.../application/services/checkout-shipping.service.ts` (`processShippingState` `:18`, `tryEnsureShippingOptions` `~:70`)
**Avaliação grátis:** `apps/api/.../application/use-cases/evaluate-shipping.use-case.ts:20-48`
**UI:** `apps/widget/src/components/checkout/ShippingSelector.tsx`

### 6.1 Comportamento esperado

- Opções vêm de `QuoteShippingUseCase` (integração MelhorEnvio) → `ShippingQuote[]` com `priceInCents` e flag `isFree`.
- **Frete grátis (R$0,00) é válido** somente quando a regra do merchant aprova: `allowFreeShipping` + `evaluateShippingOffer()` retorna `approved` com subsídio (`evaluate-shipping.use-case.ts:24-26,35`). Default seguro: `allowFreeShipping: false` quando não há regra.
- Renderização: grátis → "Grátis"; pago → `formatCurrency()` — `ShippingSelector.tsx:45-46`.

### 6.2 Regra de consistência (contrato)

- Quando **frete grátis é aprovado**, ele é a opção recomendada/selecionada; opções pagas podem coexistir como alternativas **explicitamente rotuladas** (ex.: "Expresso — R$X"), mas **nunca** uma opção "Padrão R$0,00" lado a lado com "Padrão R$X" para o mesmo serviço.
- A opção R$0,00 só é válida se originada de oferta de frete grátis aprovada (`type: shipping_free`) ou de quote real com `isFree=true`.

### 6.3 Variável de erro (BUG §11.4)

- **Hoje:** `checkout-shipping.service.ts` (~`:110`) repassa todas as quotes **sem filtrar/deduplicar**, e a oferta de frete grátis (`apply-offer.use-case.ts`) atualiza `session.shipping` de forma independente. Resultado: opções **pagas e R$0,00 coexistem** sem distinção, e o usuário pode escolher pago estando elegível a grátis.
- Visualmente, grátis e pago recebem o mesmo estilo de destaque (`text-[var(--aacp-accent)]`) — `ShippingSelector.tsx:45-46` — sem diferenciação clara.
- **Correção esperada:** deduplicar por serviço, aplicar a oferta de grátis **antes** de renderizar, e estilizar "Grátis" distinto do preço pago.

### Contrato Frete

| Item          | Valor                                                                       |
|---------------|-----------------------------------------------------------------------------|
| Prompt        | "Escolha a opção de entrega"                                                |
| Sucesso       | `session.shipping` definido; rail `delivery` = done                         |
| Erro          | nenhuma quote → fallback PAC; mistura R$0+pago (bug) → marcar inconsistência |
| Seletor e2e   | `.aacp-shipping-selector`, `.aacp-shipping-total`                           |

---

## 7. Cross-sell / Order bump (substep `cross_sell`)

**API:** `checkout-offer.service.ts:15-70`, `ListEligibleCrossSellsUseCase` (injetado em `send-chat-message.use-case.ts:20`), `offer-factory.ts`
**UI:** `apps/widget/src/components/checkout/CrossSellBanner.tsx`

### 7.1 Estado esperado

- **Gatilho:** ao entrar no estágio `payment`, substep `cross_sell` deve oferecer produtos elegíveis **antes** do método de pagamento.
- **UI:** chips de produto + "Não agora" + "Ir para pagamento" — `checkout-presentation.ts:403-407`.

### 7.2 Por que NÃO aparece hoje (GAP §11.6)

- Ofertas são **bloqueadas** durante `data_collection` e `shipping` → `evaluation.approved: false, reason: "complete_customer_before_offers"` — `checkout-offer.service.ts:23-32` (correto, mas significa que só pode surgir em `payment`).
- `ListEligibleCrossSellsUseCase` está **injetado mas não é efetivamente chamado** no fluxo visível — `send-chat-message.use-case.ts:20`. **Este é o gap principal.**
- Condições de não-render no widget — `CrossSellBanner.tsx:8`: `suggestedProducts.length === 0`, `crossSellDismissed === true`, `checkoutStage !== 'payment'`, ou `couponGateEnabled === true` (coupon gate tem prioridade).

### 7.3 Correção esperada

- Chamar `ListEligibleCrossSellsUseCase` ao transicionar para `payment` e popular `suggestedProducts`.
- Sequenciar `cross_sell → coupon_gate → payment_method` (cross-sell antes do gate de cupom).

### Contrato Cross-sell

| Item        | Valor                                                                |
|-------------|----------------------------------------------------------------------|
| Gatilho     | entrada em `payment`, `prePaymentStep="cross_sell"`                   |
| Sucesso     | aceita → item adicionado; "Não agora" → segue para cupom             |
| Erro/gap    | `suggestedProducts` vazio → banner não renderiza (gap atual)         |
| Seletor e2e | `.aacp-cross-sell` / `CrossSellBanner`                               |

---

## 8. Cupom (substeps `coupon_gate` / `coupon_entry`)

**Widget:** `apps/widget/src/hooks/use-checkout-chat.ts:576-630`
**API:** `apply-offer.use-case.ts:30-55`, `accept-checkout-offer.use-case.ts:16-47`

### 8.1 Fluxo

1. `coupon_gate` — "Quer usar cupom?" → quick replies "Sim" / "Não" (`checkout-presentation.ts:409`).
2. `coupon_entry` — digitar cupom; quick reply "Continuar sem cupom" (`:410`).

### 8.2 Estados de aplicação

| Estado          | HTTP | Mensagem                                                    | Fonte                        |
|-----------------|------|-------------------------------------------------------------|------------------------------|
| Aplicado        | 200  | "Cupom {CODE} aplicado! Desconto de R${amount}."            | `use-checkout-chat.ts:576-630` |
| Não encontrado  | 404  | "Cupom não encontrado…"                                     | idem                         |
| Já aplicado     | 409  | "Este cupom já foi aplicado nesta sessão."                  | idem                         |
| Inválido/expirado| 400 | "Cupom inválido ou expirado…"                               | idem                         |

Expiração no servidor — `apply-offer.use-case.ts:39`: `Date.parse(offer.expiresAt) <= Date.now()` → `reason: "offer_expired"`. Aceite registra evento `offer_accepted` e publica `checkout.event.tracked` (`accept-checkout-offer.use-case.ts:41-55`).

### Contrato Cupom

| Item        | Valor                                                                  |
|-------------|------------------------------------------------------------------------|
| Sucesso     | desconto aplicado; total recalculado (`.aacp-totals-discount`)         |
| Erro        | 404/409/400 → mensagem específica + permanecer em `coupon_entry`       |
| Seletor e2e | `.aacp-totals-discount`, quick replies do gate                          |

---

## 9. Pagamento (substep `payment_method`)

**Widget:** `apps/widget/src/hooks/use-checkout-payment.ts`
**API criação:** `apps/api/.../modules/payment/application/create-payment-intent.use-case.ts`
**API webhook:** `apps/api/.../modules/payment/application/handle-asaas-webhook.use-case.ts`
**Entidade:** `payment-intent.entity.ts`

### 9.1 Máquina de status (servidor)

`PaymentIntentStatus` — `payment-intent.entity.ts:11-16`: `pending | requires_action | approved | failed | cancelled | refunded`.

Transições:
- `markRequiresAction()` `:126` — `pending → requires_action`
- `markApproved()` `:157` — `pending|requires_action → approved`
- `markFailed()` `:141` — `pending|requires_action → failed`

Status do widget (`use-checkout-payment.ts`): apenas `approved` (`:181,410`), `failed`/`expired`/`canceled` (`:188`). **Não existe `requires_action` no widget** — ele faz polling do status persistido.

### 9.2 PIX (real, webhook-driven)

- **Real, não mock.** Adapter real `AsaasPaymentAdapter` (`asaas-payment.adapter.ts:53-56`); webhook em `asaas-webhook.controller.ts`. Mock `FakePaymentProvider` existe só para dev/teste (`fake-payment-provider.ts:6,19`).
- **Nascimento:** intent criada em `requires_action` (`create-payment-intent.use-case.ts:185`).
- **Mapeamento webhook → estado:**

| Evento Asaas        | Ação interna        | Fonte                                         |
|---------------------|---------------------|-----------------------------------------------|
| `PAYMENT_RECEIVED`  | `markApproved()`    | `handle-asaas-webhook.use-case.ts:131,227`    |
| `PAYMENT_OVERDUE`   | `markFailed(event)` | `handle-asaas-webhook.use-case.ts:149`        |
| `PAYMENT_DELETED`   | `markFailed(event)` | `handle-asaas-webhook.use-case.ts:149`        |

  Mapeamento de status Asaas — `asaas-payment.adapter.ts:13-28`: `RECEIVED|CONFIRMED|RECEIVED_IN_CASH→approved`; `OVERDUE|REFUNDED|CHARGEBACK_*|DELETED→failed`; `PENDING|AWAITING_RISK_ANALYSIS→pending`.
- **Polling no widget:** `pollPaymentStatus()` a cada 4s por até 10 min (`use-checkout-payment.ts:156-210`). Docstring: "PIX is never confirmed optimistically — only persisted status drives completion" (`:153-155`).
- **Timeout msg:** "Ainda não recebi a confirmação do seu PIX. Assim que o pagamento for compensado, libero seu pedido aqui." (`:201`).

#### Requisito NOVO de UX — componente "aguardando/escutando pagamento"

- **Hoje:** só mensagens de agente (`:189-203`); **não há** componente dedicado de espera (chat nem voz).
- **Esperado:** ao selecionar PIX e gerar a cobrança (`requires_action`), exibir um componente persistente de **"aguardando pagamento"** que comunica que o sistema está "escutando" o webhook:
  - Estado visual de escuta ativa (pulsar/animação), QR Code + copia-e-cola, contador regressivo (10 min), e transições para sucesso/falha/timeout.
  - Em voz: reaproveitar o orb com `data-voice-state="thinking"` + legenda "Aguardando confirmação do PIX…".
- **Seletor e2e proposto:** `.aacp-pix-waiting` com `data-pix-state="listening|approved|failed|expired"`.

### 9.3 Cartão (Stripe — "em ativação")

- **Gating:** `create-payment-intent.use-case.ts:104-106` → `ConflictException("stripe_provider_not_configured")` se `!isStripeConfigured()` (`stripe-env.ts:3-5`: `!!secretKey`).
- Conexão: `stripe_connect_not_active` se `stripeConnection?.status !== "active"` (`:148-157`); `stripe_connect_not_configured` se faltar account id.
- **Widget:** erro `stripe_connect_not_active` → "O cartão ainda está em ativação pelo provedor" (`use-checkout-payment.ts:53-54`). Render do form exige `clientSecret` + `stripePublishableKey` ambos truthy (`:306`).
- **Estado atual:** cartão **não funciona** (provider não configurado) — ver §11.3.

### 9.4 Crypto (deve aparecer; user de teste aceita)

- **Gating de oferta:** `quickRepliesForStage("payment")` inclui "Pagar com crypto" só quando `cryptoPayments.enabled: true` nas regras do merchant (chain/network/treasuryAddress/token/quoteTtl/brlPerUsdc) — `checkout-experience.crypto.spec.ts:12-33`.
- **Gating de render no widget:** os 6 campos do snapshot devem existir: `chainId && tokenAddress && amountAtomic && destinationAddress && quoteExpiresAt && snap.id` — `use-checkout-payment.ts:327-335`. Faltando qualquer um → **opção não aparece** (GAP §11.5).
- **Fluxo:** intent em `requires_action`; `confirm-crypto-payment.use-case.ts:66` retorna `{ status: "approved" }` após validação on-chain. Payload: `chainId`, `evmNetwork`, `tokenAddress`, `destinationAddress` (`payment-provider.port.ts:35-45`).
- **UI:** `CryptoPaymentPanel.tsx`, `crypto-payment.types.ts`, `crypto-payment-panel.model.ts`.
- **Correção esperada:** habilitar `cryptoPayments` no merchant de teste e garantir o snapshot completo, para que a opção apareça e o user de teste consiga aceitar crypto.

### 9.5 Aprovação (handler)

- Evento `PaymentApprovedEvent` (`payment-approved.event.ts:1-11`); handler `payment-approved.handler.ts`. Payload: `sessionId`, `externalOrderId`, `orderTotalMajorUnits`, `currency`, `acceptedOfferId?`.

### Contrato Pagamento

| Método | Estado inicial    | Sucesso              | Falha                                  | Seletor e2e                          |
|--------|-------------------|----------------------|----------------------------------------|--------------------------------------|
| PIX    | `requires_action` | webhook → `approved` | `PAYMENT_OVERDUE/DELETED`/timeout      | `.aacp-pix-waiting[data-pix-state]` (novo) |
| Cartão | depende de provider| `approved`          | `stripe_connect_not_active` (em ativação)| `.aacp-card-form`                    |
| Crypto | `requires_action` | on-chain → `approved`| quote expirada / saldo                 | `CryptoPaymentPanel`                 |

---

## 10. Pós-pagamento (estágio `completed`)

### 10.1 Sucesso

- Pagamento `approved` → `PaymentApprovedEvent` → estágio `completed`.
- UI: confirmação de pedido, número/ID, resumo. Rail `payment` = done; `data-stage="completed"`.

### 10.2 Erro / retry

- PIX expirou (`PAYMENT_OVERDUE`) ou cartão recusado (`failed`):
  - Mensagem de falha + ação **"gerar nova cobrança"** (novo `create-payment-intent`).
  - Retry deve **reusar a sessão** (não recriar cadastro/endereço); apenas novo intent.
- Crypto: quote expirada → recotar (`quoteExpiresAt`).

### Contrato Pós-pagamento

| Cenário   | UI                                          | Ação                          |
|-----------|---------------------------------------------|-------------------------------|
| Sucesso   | confirmação + resumo do pedido              | encerrar / acompanhar pedido  |
| Expirado  | aviso + "gerar nova cobrança"               | novo intent, mesma sessão     |
| Recusado  | aviso + trocar método                       | voltar a `payment_method`     |

---

## 11. Defeitos conhecidos / a corrigir

### 11.1 Layout de voz "bagunçado" → adotar layout de chat ambientado para voz

- **Sintoma:** `VoiceCheckoutExperience.tsx` tem DOM pesado (9 `<span>` de wave bars `:106-131`), legendas de agente+comprador empilhadas sem separação (`:136-143`), sem hierarquia clara.
- **Decisão de produto:** **usar o layout do CHAT adaptado para voz** — um meio-termo entre os dois canais.
- **Princípios do layout unificado:**
  1. **Espinha compartilhada:** mesma estrutura do chat (thread/legendas + painéis de ação `CheckoutPanels`/`CheckoutActionPanels` + journey stepper lateral) para ambos os canais.
  2. **Camada de voz por cima, não em vez de:** orb + estado (`data-voice-state`) + legendas vivem **dentro** da mesma casca; voz adiciona, não substitui.
  3. **Paridade de painéis:** frete, cupom, cross-sell e pagamento usam **os mesmos componentes** nos dois canais (uma fonte de verdade visual).
  4. **Confirmação por voz** (`VoiceConfirmationPanel`, `data-risk`) é um painel a mais sobre a mesma casca, não um layout separado.
  5. **Mesmos seletores e2e** (`.aacp-*`, `data-stage`) válidos em ambos os canais; só `data-channel` e a camada de voz mudam.

### 11.2 PIX "fake" (mock) vs real

- **Real:** `AsaasPaymentAdapter` (`asaas-payment.adapter.ts:53-56`) + webhook (`asaas-webhook.controller.ts`). Este é o caminho de produção.
- **Mock:** `FakePaymentProvider` (`fake-payment-provider.ts:6,19`) retorna `requires_action` hardcoded — **somente dev/teste**. Garantir que produção use o adapter Asaas e que e2e possa alternar via config.

### 11.3 Cartão (Stripe) não funciona

- Bloqueado em `stripe_provider_not_configured` / `stripe_connect_not_active` (`create-payment-intent.use-case.ts:104-106,148-157`). Estado de UI: "em ativação pelo provedor". Ação: configurar provider Stripe (secretKey + Connect ativo) ou ocultar a opção até ativar.

### 11.4 Frete com preços misturados (R$0 + pago)

- Ver §6.3. Sem filtragem/dedupe em `checkout-shipping.service.ts (~:110)`; estilo idêntico para grátis e pago (`ShippingSelector.tsx:45-46`). Corrigir dedupe + aplicar oferta grátis antes do render + estilo distinto.

### 11.5 Crypto não aparece

- Ver §9.4. Gating exige `cryptoPayments.enabled` + 6 campos do snapshot (`use-checkout-payment.ts:327-335`). Habilitar no merchant de teste e popular o snapshot.

### 11.6 Cross-sell não aparece

- Ver §7.2. `ListEligibleCrossSellsUseCase` injetado mas não chamado (`send-chat-message.use-case.ts:20`); `suggestedProducts` fica vazio. Chamar o use-case ao entrar em `payment`.

### 11.7 Quick replies iniciais reaparecendo

- Ver §2.3. Causa: `lastChat` volta a `null` e reativa `DEFAULT_QUICK_REPLIES` (`use-checkout-chat.ts:103,134`).
- **Estado esperado:** os defaults só aparecem **uma vez**, antes da primeira mensagem do comprador. Após o primeiro turno **ou** após sair de `data_collection`, nunca reaparecem.
- **Correção:** condicionar os defaults a um flag de "conversa já iniciada" (ex.: `turns.length > 0` persistente ou `hasStarted`), não a `lastChat` nullable.

### 11.8 Oportunidades de melhoria de experiência

- Validação mod-11 de CPF (hoje só conta 11 dígitos) — §4.4.
- Distinção visual clara entre frete grátis e pago — §6.
- Componente de espera de PIX com QR + copia-e-cola + countdown — §9.2.
- Reaproveitar painéis idênticos entre canais para reduzir divergência de UX — §11.1.

---

## 12. Seletores e2e estáveis (CONTRATO — não quebrar)

### 12.1 Atributos de dados

| Atributo            | Valores                                                | Onde                                  |
|---------------------|--------------------------------------------------------|---------------------------------------|
| `data-channel`      | `chat` \| `voice`                                      | `ChatCheckoutExperience.tsx:21`, `VoiceCheckoutExperience.tsx:48` |
| `data-stage`        | `data_collection` \| `shipping` \| `payment` \| `completed` | `ChatCheckoutExperience.tsx:20`, `VoiceCheckoutExperience.tsx:47` |
| `data-voice-state`  | `idle` \| `listening` \| `speaking` \| `thinking` \| `confirming` | `VoiceCheckoutExperience.tsx:49` |
| `data-risk`         | `low` \| `medium` \| `high`                            | `VoiceConfirmationPanel.tsx:26`       |
| `data-color-mode`   | `light` \| `dark`                                      | casca raiz                            |
| `data-cart-open`    | bool                                                   | casca raiz chat                       |
| `data-pix-state` (novo) | `listening` \| `approved` \| `failed` \| `expired` | componente de espera PIX (§9.2)       |

### 12.2 Classes `.aacp-*` (núcleo)

- **Gate:** `.aacp-channel-gate`, `.aacp-channel-gate__backdrop`, `.aacp-channel-gate__panel`, `.aacp-channel-gate__channels`, `.aacp-channel-gate__channel--voice.is-featured`, `.aacp-channel-gate__channel--chat`, `.aacp-channel-gate__loading`.
- **Casca:** `.checkout-experience`, `.aacp-page`, `.aacp-widget`, `.aacp-widget--conversational`, `.aacp-widget--voice`, `.aacp-shell`, `.aacp-main`.
- **Auth/cadastro:** `.aacp-auth-layer`, `.aacp-auth-dialog`, `.aacp-login-panel`, `.aacp-auth-form`, `.aacp-auth-field`, `.aacp-auth-input-wrap`, `.aacp-auth-primary`, `.aacp-auth-error`, `.aacp-auth-status`.
- **Carrinho/journey:** `.aacp-cart-fab`, `.aacp-cart-header`, `.aacp-cart-journey`, `.aacp-cart-journey-step`, `.aacp-totals`, `.aacp-shipping-total`, `.aacp-totals-discount`, `.aacp-item-name`, `.aacp-item-price`.
- **Frete:** `.aacp-shipping-selector` (+ itens de opção).
- **Voz:** `.aacp-voice-shell`, `.aacp-voice-bar`, `.aacp-voice-bar__state[data-state]`, `.aacp-voice-orb`, `.aacp-voice-orb--[state]`, `.aacp-voice-caption`, `.aacp-voice-confirmation[data-risk]`.

> Renomear qualquer seletor desta seção exige PR coordenado atualizando a suíte Playwright no mesmo commit.

---

## 13. Matriz de testes Playwright (resumo)

| # | Cenário                                   | Canal | Asserções-chave (seletores)                                  |
|---|-------------------------------------------|-------|--------------------------------------------------------------|
| 1 | Gate: escolher chat                       | chat  | `[data-channel="chat"]` presente                             |
| 2 | Gate: escolher voz                        | voz   | `[data-channel="voice"]`, orb visível                        |
| 3 | Gate: erro de rede + retry                | ambos | `.aacp-channel-gate__*` alerta + retry                       |
| 4 | Quick replies iniciais somem após 1º turno| ambos | defaults ausentes após primeiro envio (regressão §11.7)      |
| 5 | Novo cadastro completo (e-mail→OTP→…→pix)| chat  | `data-stage` progride 1→4                                    |
| 6 | Recorrente reconhecido pula etapas        | chat  | entra direto em `shipping`/`payment`                         |
| 7 | OTP e-mail inválido → erro + reenviar     | ambos | `.aacp-auth-error` com msg `:248`                            |
| 8 | OTP SMS inválido → erro                    | ambos | msg `:253`                                                   |
| 9 | CEP válido → ViaCEP preenche endereço     | ambos | campos street/city/state populados                           |
|10 | Frete: grátis vs pago distintos (bug)     | ambos | sem R$0+pago duplicados; "Grátis" estilizado distinto        |
|11 | Cross-sell aparece em `payment` (gap)     | ambos | `CrossSellBanner` renderiza com `suggestedProducts`          |
|12 | Cupom: aplicado/404/409/400               | ambos | mensagens §8.2; `.aacp-totals-discount`                      |
|13 | PIX: espera + webhook approved            | ambos | `.aacp-pix-waiting[data-pix-state="approved"]` → `completed` |
|14 | PIX: timeout/overdue → nova cobrança      | ambos | msg `:201`; ação "gerar nova cobrança"                       |
|15 | Cartão em ativação → mensagem             | ambos | "em ativação pelo provedor" (`:53-54`)                       |
|16 | Crypto aparece e aceita (gap)             | ambos | `CryptoPaymentPanel` visível; aprovação on-chain             |
|17 | Sucesso → `completed` + resumo            | ambos | `data-stage="completed"`                                     |
|18 | Paridade de layout voz↔chat (§11.1)       | voz   | mesmos painéis/seletores que chat sob `data-channel="voice"` |

---

## 14. Referências de código (fontes da verdade)

- Estágios: `apps/api/src/modules/checkout/domain/services/customer-extraction.service.ts:156-171,173-181,187-226`
- Prompts/quick replies: `apps/api/src/modules/checkout/application/services/checkout-experience.service.ts:30-110`
- Cadastro/recorrente: `apps/api/src/modules/checkout/application/services/checkout-customer.service.ts:227,248,253,287-320`
- ViaCEP: `apps/api/src/modules/checkout/domain/services/viacep-lookup.service.ts:14-53`
- Frete: `apps/api/.../application/services/checkout-shipping.service.ts:18,70,110`; `evaluate-shipping.use-case.ts:20-48`
- Ofertas/cupom: `checkout-offer.service.ts:15-70`; `offer-factory.ts:8-19`; `apply-offer.use-case.ts:30-55`; `accept-checkout-offer.use-case.ts:16-47`
- Pagamento (API): `create-payment-intent.use-case.ts:104-106,148-157,185`; `handle-asaas-webhook.use-case.ts:131,149,227`; `asaas-payment.adapter.ts:13-28,53-56`; `payment-intent.entity.ts:11-16,126,141,157`; `stripe-env.ts:3-5`; `fake-payment-provider.ts:6,19`; `confirm-crypto-payment.use-case.ts:66`; `payment-approved.event.ts:1-11`; `checkout-experience.crypto.spec.ts:12-33`
- Channel gate: `apps/widget/src/features/onboarding/AgentChannelWelcome.tsx:15-96`; `channel-welcome.selector.ts:8,17-18`
- Quick replies: `apps/widget/src/hooks/use-checkout-chat.ts:28-32,99-134,576-630`
- Estágios widget: `apps/widget/src/hooks/checkout-presentation.ts:22-29,32-37,398-427,450-454`
- Pagamento (widget): `apps/widget/src/hooks/use-checkout-payment.ts:53-54,153-210,306,327-335,410`
- Frete (widget): `apps/widget/src/components/checkout/ShippingSelector.tsx:45-46`
- Cross-sell (widget): `apps/widget/src/components/checkout/CrossSellBanner.tsx:8`
- Voz (widget): `apps/widget/src/features/onboarding/VoiceCheckoutExperience.tsx:42,47-49,106-143`; `VoiceConfirmationPanel.tsx:4-8,26`
- Cascas: `apps/widget/src/app/ChatCheckoutExperience.tsx:15-24`

> Nota: alguns números de linha foram coletados por investigação de leitura e podem variar ±poucas linhas após edições; os símbolos/funções citados são a âncora estável.
