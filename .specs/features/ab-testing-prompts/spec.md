# A/B Testing de Prompts — Spec

## Context

Agentes de checkout funcionam mas não aprendem. Todos buyers recebem mesmo estilo de abordagem. Precisamos testar variantes de prompt (tom, timing de oferta, estilo) e promover automaticamente a que converte mais.

## Produto

- Localização: Dashboard → Configurações de IA → Tab "Testes A/B"
- Merchant cria experimento, define variantes de prompt, acompanha resultados
- Sistema sorteia variante por session, registra resultado, promove winner

## Problema

Sem A/B test:
- Agente fala igual pra todos → subóptimo
- Não sabe se prompt "agressivo" ou "consultivo" converte mais
- Merchant não tem visibilidade sobre performance do agente
- Melhorias são especulativas, não data-driven

## Goals

1. **Experiment Management** — Merchant cria/gerencia experimentos via dashboard
2. **Variant Routing** — Cada session recebe variante por weighted random
3. **Result Tracking** — Conversão, revenue, offer acceptance rastreados por variante
4. **Auto-Promotion** — Winner promovido automaticamente (ou manual)
5. **Dashboard UX** — Tab dedicada "Testes A/B" com métricas claras
6. **E2E Testing** — Fluxo completo validado automaticamente

## Non-Goals (MVP)

- Multi-variate testing (combinações de múltiplas variáveis)
- Bayesian optimization (simples frequentist é suficiente)
- Segmentação por buyer type (todas variantes servidas igualitariamente)
- Auto-geração de prompts por IA (merchant escreve manualmente)

---

## Requirements

### REQ-AB-001: Experiment Entity
- Merchant cria experimento com nome descritivo
- Status: `draft` → `running` → `completed` → `archived`
- Máximo 1 experimento `running` por merchant (evita conflito)
- Campos: name, status, startedAt, endedAt, winnerVariantId

### REQ-AB-002: Prompt Variants
- Cada experimento tem 2-4 variantes
- Cada variante: nome, system prompt (texto), peso (weight)
- Peso determina % de tráfego (ex: weight=1,1,1 = 33% cada)
- Variante pode ser editada apenas em `draft` (não durante `running`)

### REQ-AB-003: Variant Routing
- No início de cada CheckoutSession, sorteia variante por weighted random
- Registra `variantId` na session (rastreabilidade)
- Se experimento não existe ou não está `running` → usa prompt default do merchant
- Routing é determinístico por session (mesma variante durante toda conversa)

### REQ-AB-004: Result Tracking
- Quando order completa → registra resultado positivo (converted=true, revenue)
- Quando session expira/abandona (>24h sem complete) → registra negativo (converted=false)
- Métricas por variante:
  - Conversion rate (converted / total)
  - Average revenue per session
  - Offer acceptance rate (offers accepted / offers shown)
  - Average session duration

### REQ-AB-005: Statistical Significance
- Mínimo 100 sessions por variante antes de declarar winner
- Confidence threshold: 95% (chi-squared test ou z-test simples)
- Dashboard mostra: "X está ganhando com Y% de confiança (N sessions)"
- Se nenhuma variante significativa → "Precisa mais dados"

### REQ-AB-006: Winner Promotion
- **Manual:** Merchant clica "Promover" → variante vira prompt default
- **Automático:** Quando confidence ≥95% + min 100 sessions/variante → marca winner
- Após promoção: experimento muda pra `completed`
- Prompt da variante winner é copiado pra `AgentIdentity.configDocument`

### REQ-AB-007: Dashboard UX
- Tab "Testes A/B" em Configurações de IA
- Tela principal: lista de experimentos (nome, status, winner, datas)
- Criar experimento: formulário com nome + variantes (prompt textarea)
- Tela de resultados:
  - Gráfico de barras: conversion rate por variante
  - Tabela: sessions, converted, revenue, acceptance rate
  - Indicador de confiança ("83% confidence — precisa mais dados")
  - Botão "Promover Winner" (enabled quando confidence ≥95%)
- Real-time update (ou refresh manual)

### REQ-AB-008: Safety Invariants
- **Rules Engine continua validando** — A/B test muda tom, não regras
- **SafetyValidator roda em todas variantes** — nenhuma variante bypassa safety
- **Max discount, margin floor, guardrails = inalterados**
- Variante com unsafe output → fallback template (como já funciona)
- Merchant não pode injetar prompt que desabilita safety gates

### REQ-AB-009: E2E Test Coverage
- Fluxo completo: criar experimento → rodar sessions → registrar resultados → declarar winner
- Validar: variant routing distribui uniformemente (±5% do esperado)
- Validar: resultado registrado corretamente
- Validar: winner promotion atualiza prompt default
- Validar: safety gates não burladas por variantes

---

## Data Model

```prisma
model PromptExperiment {
  id              String    @id @default(cuid())
  merchantId      String    @map("merchant_id")
  name            String
  status          String    @default("draft") // draft, running, completed, archived
  startedAt       DateTime? @map("started_at")
  endedAt         DateTime? @map("ended_at")
  winnerVariantId String?   @map("winner_variant_id")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  variants PromptVariant[]

  @@unique([merchantId, name])
  @@index([merchantId, status])
  @@map("prompt_experiments")
}

model PromptVariant {
  id            String @id @default(cuid())
  experimentId  String @map("experiment_id")
  name          String
  weight        Int    @default(1)
  systemPrompt  String @map("system_prompt") @db.Text
  createdAt     DateTime @default(now()) @map("created_at")

  experiment PromptExperiment @relation(fields: [experimentId], references: [id], onDelete: Cascade)
  results    PromptVariantResult[]

  @@unique([experimentId, name])
  @@map("prompt_variants")
}

model PromptVariantResult {
  id              String   @id @default(cuid())
  variantId       String   @map("variant_id")
  sessionId       String   @map("session_id")
  converted       Boolean
  revenue         Decimal? @db.Decimal(12, 4)
  offersShown     Int      @default(0) @map("offers_shown")
  offersAccepted  Int      @default(0) @map("offers_accepted")
  durationSeconds Int?     @map("duration_seconds")
  createdAt       DateTime @default(now()) @map("created_at")

  variant PromptVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)

  @@unique([variantId, sessionId])
  @@index([variantId, createdAt])
  @@map("prompt_variant_results")
}
```

### CheckoutSession modification:
```prisma
model CheckoutSession {
  // ... existing fields ...
  promptVariantId String? @map("prompt_variant_id")  // NOVO: qual variante recebeu
}
```

---

## Module Structure

```
apps/api/src/modules/experiments/
  domain/
    entities/
      prompt-experiment.entity.ts
      prompt-variant.entity.ts
    ports/
      experiment-repository.port.ts
    services/
      experiment-router.service.ts       # sorteia variante por peso
      significance-calculator.service.ts # calcula confiança estatística
    events/
      experiment-domain-event.ts
  application/
    use-cases/
      create-experiment.use-case.ts
      update-experiment.use-case.ts
      start-experiment.use-case.ts
      stop-experiment.use-case.ts
      archive-experiment.use-case.ts
      get-experiment-results.use-case.ts
      promote-winner.use-case.ts
      record-experiment-result.use-case.ts
      assign-variant-to-session.use-case.ts
  infrastructure/
    repositories/
      prisma-experiment.repository.ts
    jobs/
      expire-sessions.job.ts             # marca abandoned sessions como converted=false
      auto-promote-winner.job.ts         # verifica significance e promove
  presentation/
    http/
      experiments.controller.ts
  experiments.module.ts
```

---

## API Surface

### Experiment Management (Dashboard)
```
POST   /api/experiments                  — criar experimento
GET    /api/experiments                  — listar experimentos do merchant
GET    /api/experiments/:id              — detalhes + resultados
PUT    /api/experiments/:id              — editar (só em draft)
POST   /api/experiments/:id/start       — iniciar (draft → running)
POST   /api/experiments/:id/stop        — parar (running → completed)
POST   /api/experiments/:id/archive     — arquivar
POST   /api/experiments/:id/promote     — promover winner manualmente
GET    /api/experiments/:id/results     — métricas detalhadas por variante
```

---

## Integration Points

### 1. Checkout Experience Service (routing)
```
checkout-experience.service.ts
  → Antes de montar context pro agente
  → Chama ExperimentRouter.selectVariant()
  → Injeta prompt da variante no system message
  → Registra variantId na session
```

### 2. Complete Order (result tracking)
```
complete-order.use-case.ts
  → Após completar pedido
  → Se session tem promptVariantId
  → Registra resultado (converted=true, revenue, offers)
```

### 3. Expire Sessions Job (abandoned tracking)
```
Cron: a cada 1 hora
  → Busca sessions com promptVariantId + criadas >24h + não completadas
  → Registra resultado (converted=false)
```

### 4. Auto-Promote Job (significance check)
```
Cron: a cada 6 horas
  → Busca experimentos running com >100 sessions/variante
  → Calcula significance
  → Se ≥95%: marca winner, notifica merchant
```

---

## Safety Rules

1. **A/B test NUNCA bypassa rules-engine** — max discount, margin floor inalterados
2. **SafetyValidator roda em TODAS variantes** — output sempre validado
3. **Prompt injection protection:**
   - Variantes NÃO podem conter: "ignore previous instructions", "you are now", etc
   - Validação regex no create/update da variante
   - Variante é ADICIONADA ao prompt base, não SUBSTITUI safety gates
4. **Fallback:** Se variante gera output unsafe → usa template determinístico (existente)
5. **Limite:** máximo 4 variantes por experimento (evita tráfego fragmentado demais)

---

## Dashboard UX (Tab "Testes A/B")

### Tela: Lista de Experimentos
```
┌──────────────────────────────────────────────────┐
│ Configurações de IA > Testes A/B                 │
├──────────────────────────────────────────────────┤
│                                                  │
│ [+ Novo Experimento]                             │
│                                                  │
│ ┌────────────────────────────────────────────┐   │
│ │ ● Estilo de Oferta - Agosto               │   │
│ │   Status: 🟢 Rodando | 234 sessions       │   │
│ │   Variantes: Agressivo, Consultivo, Escas  │   │
│ │   Liderando: Consultivo (27% conv)         │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ ┌────────────────────────────────────────────┐   │
│ │ ○ Tom de Voz - Julho                       │   │
│ │   Status: ✅ Concluído | Winner: Amigável  │   │
│ │   Conv: 24% vs 18% (formal)               │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
└──────────────────────────────────────────────────┘
```

### Tela: Resultados do Experimento
```
┌──────────────────────────────────────────────────┐
│ Estilo de Oferta - Agosto                        │
│ 🟢 Rodando desde 01/08 | 234 sessions           │
├──────────────────────────────────────────────────┤
│                                                  │
│ Confiança: 87% (precisa mais dados)              │
│ ████████████████████░░░░ 87%                     │
│                                                  │
│ ┌──────────┬──────────┬─────────┬────────────┐  │
│ │ Variante │ Sessions │ Conv %  │ Receita/s  │  │
│ ├──────────┼──────────┼─────────┼────────────┤  │
│ │ Consult. │ 82       │ 27.7% ★│ R$ 215     │  │
│ │ Agress.  │ 78       │ 20.0%  │ R$ 189     │  │
│ │ Escassez │ 74       │ 16.5%  │ R$ 142     │  │
│ └──────────┴──────────┴─────────┴────────────┘  │
│                                                  │
│ [Promover Winner] (disabled - <95% confidence)   │
│ [Parar Experimento]                              │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

## Acceptance Criteria

- [ ] Merchant cria experimento com 2-4 variantes
- [ ] Experimento inicia (running) e para (completed)
- [ ] Cada checkout session recebe variante por weighted random
- [ ] Variante routing é sticky (mesma variante durante toda session)
- [ ] Resultado registrado quando order completa (converted=true)
- [ ] Resultado registrado quando session expira (converted=false)
- [ ] Dashboard mostra métricas por variante (conv%, revenue, acceptance)
- [ ] Confidence calculada e exibida
- [ ] Winner promovido manualmente (botão)
- [ ] Winner promovido automaticamente (confidence ≥95% + 100 sessions)
- [ ] Promoção copia prompt da variante para agent identity
- [ ] Safety gates NÃO são bypassadas por nenhuma variante
- [ ] Rules-engine valida ofertas normalmente
- [ ] E2E: fluxo completo testado
- [ ] E2E: distribuição uniforme validada (±5%)
- [ ] E2E: safety não burlada

