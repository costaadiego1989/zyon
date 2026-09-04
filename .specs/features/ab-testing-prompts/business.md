# A/B Testing de Prompts — Business & Architecture Document

## Executive Summary

**Objetivo:** Transformar ATHOM de "agente que funciona" para "agente que aprende".

**Impacto:** Cada experimento é oportunidade de descobrir qual estilo de oferecimento converte mais. Dados reais, não opinião.

**ROI esperado:** +15-30% conversion rate após 2-3 experimentos bem executados.

---

## Business Case

### O Problema Hoje

```
Agente oferece desconto "Quer 15% de desconto?"
Buyer: "Não, obrigado"

Outro agente oferece: "Você está hesitando... pode ser que R$100 é muito. 
Tenho uma sugestão: se você levar este jeans agora, saem por R$85."
Buyer: "Legal, deixa eu pensar..."
Buyer: "OK, levo!"
```

**Questão:** Qual estilo funciona melhor?
- Com dados: sabemos qual desconta as vendas
- Sem dados: chutamos

### A Solução

Merchant cria 3 variantes de abordagem. ATHOM testa com 100 buyers. **Dados falam sozinhos.**

```
"Agressivo"  → 20% conversão
"Consultivo" → 28% conversão ← WINNER
"Escassez"   → 16% conversão

Próximo mês: sempre "Consultivo"
```

### Negócio

| Antes | Depois |
|---|---|
| "Não sabe por que vende pouco" | "Sabe exatamente qual estilo converte" |
| Dinheiro em agente genérico | Investe em teste, dobra conversão |
| Chute pra escolher prompt | Data-driven prompt selection |

**Posicionamento:** "Agentes que aprendem" vs "agentes que falam"

---

## How A/B Testing Fits in Product

### Para o Merchant

```
Dashboard
├── Vendas (já existe)
├── Funil (já existe)
└── 🆕 Testes A/B ← aqui
    ├── [+ Novo Teste]
    ├── Teste "Estilo de Oferta"
    │   └── 🟢 Consultivo ganhando (28% vs 20%)
    ├── Teste "Tom de Voz"
    │   └── ✅ Amigável venceu (pronto)
    └── Teste "Timing de Frete"
        └── 🔴 Insuficientes dados (68/100 sessions)
```

### Para a Oferta de ATHOM

**Antes:** "Agente inteligente que oferece desconto"
**Depois:** "Agente que aprende qual oferta converte + dashboard mostra resultado"

Diferencial:
- Competitor = prompt genérico, mesma oferta pra todos
- ATHOM = testa variantes, promove winner, merchant vê ROI

---

## Architecture — How It Integrates

### Current Flow (Today)

```
Buyer inicia checkout
         │
         ▼
Merchant config (identity, max discount, margin floor)
         │
         ▼
Agente conversa (sempre MESMO sistema prompt)
         │
         ▼
Rules-Engine valida (max discount, margin)
         │
         ▼
Buyer aceita ou não
         │
         ▼
Order completes
         │
         ▼
(merchant não sabe: qual estilo funcionou melhor?)
```

### New Flow (A/B Testing)

```
Buyer inicia checkout
         │
         ▼
🆕 Experiment Router: sorteia variante (A, B, C)
         │
         ▼
Merchant config (identity, max discount, margin floor)
         │
         ▼
Agente conversa (sistema prompt = VARIANTE SORTEADA)
         │
         ▼
Rules-Engine valida (max discount, margin, INALTERADO)
         │
         ▼
Safety Validator (INALTERADO, mesma segurança)
         │
         ▼
Buyer aceita ou não
         │
         ▼
Order completes
         │
         ▼
🆕 Record Result (converted?, revenue, offers accepted)
         │
         ▼
🆕 Cron Job (analysis, significance, winner promotion)
         │
         ▼
🆕 Dashboard mostra: qual variante ganhou
```

**Key Invariants:**
- A/B testing NÃO muda rules-engine
- A/B testing NÃO bypassa safety
- A/B testing é ADDON, não replacement
- Rules permanecem: max discount, margin floor, guardrails

---

## Implementation Strategy

### Why "Experiments" Module

```
Não dentro de checkout:
  ✗ Poluiria lógica de checkout
  ✗ Difícil de evoluir (multi-variate, segmentação)
  ✗ Dashboard seria acoplada

Módulo separado "experiments":
  ✓ Responsabilidade clara
  ✓ Pode evoluir pra storefront, storefront search
  ✓ Dashboard tab dedicada
  ✓ Reutilizável
```

### Module Responsibilities

| O que faz | Quem faz |
|---|---|
| Decide qual variante servir (routing) | ExperimentRouter |
| Calcula confiança estatística | SignificanceCalculator |
| Persiste experimento/variantes | ExperimentRepository |
| Registra resultado (converted, revenue) | RecordExperimentResult use-case |
| Cron: promocão automática do winner | AutoPromoteJob |
| Dashboard: mostra resultados | ExperimentsController |

---

## Safety & Guardrails

### What CANNOT Change

```
Rules-Engine: max discount, margin floor
  → Variant CANNOT bypass
  → Variant é instrução de ESTILO, não de REGRA

SafetyValidator: output validation
  → Variant CANNOT bypass
  → Output sempre passa por validator

Merchant config: identity, name, tone
  → Variant é ADIÇÃO ao config, não SUBSTITUIÇÃO
```

### What CHANGES

```
System Prompt (instruções ao LLM)
  Before:  "Você é vendedor. Ofereça desconto se buyer hesita."
  Variant: "Você é consultor. Entenda necessidade primeiro. Ofereça depois."
  After:   Rules-Engine valida AMBOS
           Safety-Validator valida AMBOS
           Margin floor = IGUAL em ambos
```

### Injection Protection

```
Blocklist na validação:
  ✗ "ignore previous instructions"
  ✗ "you are now"
  ✗ "bypass safety"
  ✗ "disable guardrails"

Approach:
  Variante é ADIÇÃO (append) ao system prompt
  Variante NÃO substitui base
  Variante roda POR BAIXO de safety gates
```

---

## Data Model Rationale

### Why 3 Tables?

```
PromptExperiment
  ├── id, merchantId, name, status, winner
  └── serves as experiment container

PromptVariant
  ├── id, experimentId, name, weight, systemPrompt
  └── variants within experiment (flexible # of variants)

PromptVariantResult
  ├── variantId, sessionId, converted, revenue, offers
  └── each session's outcome (many results per variant)
```

**Benefits:**
- Variant can be added/removed before experiment starts
- Results are immutable (audit trail)
- Flexible to N variants (not just A/B)
- Can analyze by variant, by time, by merchant

---

## Metrics & Success

### What We Measure

| Metric | Why | Formula |
|---|---|---|
| **Conversion Rate** | Did buyer buy? | converted / total sessions |
| **Avg Revenue** | Did buyer spend more? | total revenue / sessions |
| **Offer Acceptance** | Did buyer take offer? | offers accepted / offers shown |
| **Session Duration** | Was buyer engaged? | avg seconds in conversation |

### Example Result

```
Variante: "Consultivo"
  Conversion Rate:    27.7% (31 conversões / 112 sessions)
  Avg Revenue:        R$ 215.30
  Offer Acceptance:   38.2% (34 accepted / 89 shown)
  Avg Duration:       4m 5s

Variante: "Agressivo"
  Conversion Rate:    20.0% (23 conversões / 115 sessions)
  Avg Revenue:        R$ 189.50
  Offer Acceptance:   45.1% (46 accepted / 102 shown) ← mais offers, menos conversão
  Avg Duration:       2m 0s ← conversa mais curta

Winner: "Consultivo" (27.7% > 20%, confidence 87%)
```

---

## Business Logic

### Experiment Lifecycle

```
1. DRAFT
   - Merchant creates experiment
   - Adds variants (2-4)
   - Defines weights (1,1,1 = equal)
   - Can edit variants

2. RUNNING
   - Merchant clicks "Start"
   - Cron job: ExpireSessionsJob watches for abandoned
   - Cron job: AutoPromoteJob checks significance every 6h
   - Dashboard shows live results
   - Variants are READ-ONLY (can't change mid-test)

3. COMPLETED (auto or manual)
   - Merchant clicks "Stop" OR significance ≥95%
   - Winner promoted (prompt copied to agent identity)
   - New sessions use winning prompt by default
   - Old sessions archived

4. ARCHIVED
   - Merchant archives old experiment
   - Can re-run experiment with same variants or new ones
```

### Merchant Actions

| Action | When | Effect |
|---|---|---|
| Create | Anytime | Draft experiment created |
| Edit variants | Draft only | Can modify prompts/weights |
| Start | Draft → Running | Experiment begins collecting data |
| Stop | Running | Experiment ends, winner promoted |
| Promote Winner | Manual | Variant prompt → agent identity |
| Archive | Completed | Clear experiment from view |

---

## ROI & Payback

### Conservative Estimate

```
Today:
  PME merchant: R$50k/month checkout
  Conversion rate: 2% (1000 visitors/month → 20 conversões)
  Revenue: R$50k

After A/B test (Consultivo wins with +28% conversion):
  New conversion rate: 2% × 1.28 = 2.56%
  New conversões: 1000 × 2.56% = 25.6
  New revenue: R$64k (28% lift)

Cost:
  Engineering: 3 weeks (sunk)
  Merchant time: <2h setup + monitoring

Payback: 1 month (ROI on engineering is org-level)
```

### Why This Matters

PME doesn't have data analyst. They use gut feeling. ATHOM gives them **data-driven optimization** with zero work.

Competitor: "Here's a checkout"
ATHOM: "Here's a checkout + experiments to find what works"

---

## Rollout Plan

### Week 1: Engineering
- Build A/B testing infrastructure
- Test locally
- Merge to main

### Week 2: Private Beta
- 3-5 merchants test
- Collect feedback
- Iterate UI/UX

### Week 3: Public Release
- All merchants can create experiments
- Documentation + tutorials
- Monitoring + alerts

---

## Success Metrics (Company)

| KPI | Target | How Measured |
|---|---|---|
| Merchants using A/B tests | 10% within 3 months | Analytics tracking |
| Avg conversion lift (winners) | +15% | Average of winning variants |
| Dashboard engagement | 20% daily active | Tab click tracking |
| Support tickets (A/B related) | <5/month | Support system |

---

## Future Evolution (Not MVP)

```
Phase 1 (MVP): Single-variable A/B testing
  ✓ Prompt variants

Phase 2 (6 months): Multi-variate
  → Test: prompt + discount strategy + timing simultaneously
  → More complex math (Bayesian optimization)

Phase 3 (12 months): Segmentation
  → Different variants for different buyer types
  → "New buyer" vs "Repeat customer" → different strategies

Phase 4 (18 months): Auto-generation
  → AI generates variant prompts based on merchant rules
  → Human approves, then A/B tests
```

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Variant bypassess safety | Low | High | Blocklist + validation |
| Experiment runs forever (no winner) | Medium | Low | Min confidence + manual stop |
| Merchant misinterprets results | Medium | Low | Dashboard guidance + docs |
| Performance impact (queue buildup) | Low | Medium | Cache experiment 5min |
| Statistical error | Low | Low | Z-test with min 100 samples |

---

## Summary

### What This Delivers

1. **To Merchant**
   - Visibility into agent performance
   - Data-driven optimization
   - ROI dashboard
   - Competitive advantage

2. **To ATHOM**
   - Differentiation (nobody else does this)
   - Customer lock-in (merchant invested in experiments)
   - Product evolution data
   - Positioning: "AI that learns"

3. **To Business**
   - Stickier product (higher engagement)
   - Upsell opportunity (advanced testing)
   - Brand story (innovation)

### Why Now

```
Today: "Checkout with agent"
Future: "Checkout with learning agent"

A/B testing is the bridge. It's not complex, but it's powerful.
MVP in 3 weeks unlocks next level of product maturity.
```

