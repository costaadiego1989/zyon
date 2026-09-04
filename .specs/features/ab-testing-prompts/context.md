# A/B Testing de Prompts — Context (Decisions & Trade-offs)

## No Gray Areas

Spec foi alinhada direto com seu palpite durante conversa. Não há ambiguidade.

**O que vocês querem:**
- Dashboard tab "Testes A/B" em Configurações de IA ✓
- Merchant cria variantes de prompt ✓
- Sistema sorteia por session ✓
- Dashboard mostra qual ganhou ✓
- E2E tests validando fluxo completo ✓
- Documentação em architecture ✓

Tudo está nos 5 documentos.

---

## Decisions Made

### 1. Novo Módulo vs Extensão do Checkout

**Decision:** Novo módulo `experiments` separado.

**Rationale:**
- Checkout fica limpo (responsabilidade única)
- Experiments evolui independentemente (multi-variate, storefront, etc)
- Dashboard tab dedicada = módulo dedicado
- Reutilizável em outros contextos

### 2. Weighted Random vs Deterministic

**Decision:** Weighted random (sorteio probabilístico).

**Rationale:**
- Simples de implementar
- Justo (peso 1,1,1 = 33% cada)
- Flexibility (peso 2,1,1 = 50%, 25%, 25%)
- Padrão em A/B testing

### 3. Z-Test vs Bayesian

**Decision:** Z-test (simples, suficiente).

**Rationale:**
- MVP não precisa de Bayesian
- Z-test é robusto pra proporções (converted: sim/não)
- Implementação rápida (<1 dia)
- Resultado interpretável ("87% confidence")

### 4. Manual Promote vs Auto-Only

**Decision:** Ambos.
- Auto-promote em ≥95% confidence + 100 samples
- Manual sempre disponível (merchant pode acelerar)

**Rationale:**
- Auto = fire-and-forget (confiável, padrão)
- Manual = controle merchant (confiança nele)
- Melhor UX

### 5. Cache Experiment Running

**Decision:** Cache 5 minutos.

**Rationale:**
- Experiment running não muda a cada segundo
- 5 min = tradeoff entre freshness e performance
- Se merchant stop experiment durante cache → session usa old variant (aceitável)
- Alternativa: sem cache (mais queries), overhead

---

## Trade-offs Aceitos

| Trade-off | Pro | Con |
|---|---|---|
| Cache 5min | Performance | Small lag time se stop |
| Weighted random | Simple, fair | Statistical power lower pra skewed weights |
| Z-test | Fast, simple | Not ideal pra muito skewed (>90% vs <10%) |
| Max 4 variants | Clarity, focus | Can't test many things at once |
| Min 100 samples | Statistical rigor | Espera mais dados |
| Prompt ADIÇÃO (não SUBSTITUI) | Safety preserved | Variants slightly "fat" |

Todos trade-offs favorecem **safety + simplicity** sobre **optimization**.

---

## What We're NOT Doing (MVP)

| Feature | Why Skip |
|---|---|
| Multi-variate testing | 2-variable testing is order of magnitude more complex |
| Bayesian optimization | Z-test sufficient, overkill otherwise |
| Segmentation by buyer type | Add later if needed |
| Auto prompt generation | Merchant writes, ATHOM tests. Keep control. |
| Sequential testing | Fix sample size (100) is simpler |
| Time-series analysis | "Offer ROI" dashboard separate feature |

---

## Safety Philosophy

**Core principle:** A/B testing é sobre HOW agente fala, NÃO WHAT agente pode fazer.

```
❌ NEVER via A/B test:
   - Bypass max discount rule
   - Skip margin floor validation
   - Ignore safety gates
   - Override customer guardrails

✅ ALWAYS via A/B test:
   - Tone (aggressive vs consultive)
   - Timing (upfront vs after objection)
   - Framing (escassez vs customization)
   - Opening move (desconto vs entendimento)
```

Rules-Engine é layer independente. Variant ADICIONADA como contexto, não como regra override.

---

## Metrics Philosophy

**What we measure:** Proxy indicators of success
- Conversion: "Did buyer complete?"
- Revenue: "Did buyer spend?"
- Offer acceptance: "Did buyer take the deal?"
- Duration: "Was buyer engaged?"

**What we DON'T measure:** Satisfaction, NPS, subjective feeling
- Reason: Direct outcome (did they buy) more reliable than survey
- Future: Can add NPS survey if needed

---

