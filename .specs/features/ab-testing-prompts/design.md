# A/B Testing de Prompts — Design

## Architecture Decision

**Approach:** Novo módulo `experiments` seguindo Clean Architecture existente.

**Por que módulo separado (não dentro de checkout):**
- Experimentos são cross-cutting (futuramente podem afetar storefront também)
- Não poluir lógica de checkout com concerns de testing
- Permite evolução independente (multi-variate, segmentação, etc)
- Dashboard tab dedicada = responsabilidade dedicada

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXPERIMENTS MODULE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────┐    ┌───────────────────────────────┐  │
│  │ Experiment CRUD      │    │ Experiment Router             │  │
│  │ (create/start/stop)  │    │ (weighted random selection)   │  │
│  └──────────┬───────────┘    └──────────────┬────────────────┘  │
│             │                               │                    │
│             ▼                               │                    │
│  ┌──────────────────────┐                   │                    │
│  │ Significance Calc    │                   │                    │
│  │ (chi-squared/z-test) │                   │                    │
│  └──────────────────────┘                   │                    │
│                                             │                    │
└─────────────────────────────────────────────┼────────────────────┘
                                              │
                    ┌─────────────────────────┼──────────────────┐
                    │                         │                  │
                    ▼                         ▼                  ▼
         ┌──────────────────┐     ┌────────────────┐   ┌───────────────┐
         │ Checkout Module  │     │ Agent Identity │   │ Dashboard     │
         │ (session routing)│     │ (promote winner)│   │ (results UI)  │
         └──────────────────┘     └────────────────┘   └───────────────┘
```

---

## Data Flow

```
1. ROUTING (início da session)

   Buyer inicia checkout
           │
           ▼
   CheckoutExperienceService.buildAgentContext()
           │
           ▼
   ExperimentRouter.selectVariant(merchantId)
           │
           ├── Tem experimento running?
           │     ├── SIM → sorteia variante por peso
           │     │         → salva variantId na session
           │     │         → injeta prompt da variante
           │     └── NÃO → usa prompt default
           │
           ▼
   Agente conversa com buyer (usando prompt da variante)
           │
           ▼
   Safety gates + Rules Engine (INALTERADO)


2. TRACKING (fim da session)

   Caso A: Order completa
           │
           ▼
   CompleteOrder.execute()
           │
           ├── Session tem variantId?
           │     └── SIM → record(converted=true, revenue, offers)
           │
           ▼
   Done.

   Caso B: Session expira (cron job, 24h)
           │
           ▼
   ExpireSessionsJob.execute()
           │
           ├── Sessions com variantId + >24h + não completadas
           │     └── record(converted=false)
           │
           ▼
   Done.


3. ANALYSIS (contínuo)

   Cron a cada 6h
           │
           ▼
   AutoPromoteJob.execute()
           │
           ├── Experimentos running com >100 sessions/variante
           │     └── Calcula significance
           │           ├── ≥95% → marca winner, notifica merchant
           │           └── <95% → aguarda mais dados
           │
           ▼
   Done.
```

---

## Experiment Router — Algorithm

```typescript
interface ExperimentRouterPort {
  /**
   * Retorna variante sorteada OU null (usa default)
   * Null = sem experimento running pra este merchant
   */
  selectVariant(merchantId: string): Promise<PromptVariant | null>;
}

// Implementation
class ExperimentRouterService implements ExperimentRouterPort {
  
  async selectVariant(merchantId: string): Promise<PromptVariant | null> {
    // 1. Busca experimento running do merchant (cached 5min)
    const experiment = await this.repo.findRunning(merchantId);
    if (!experiment) return null;
    
    // 2. Weighted random selection
    const variants = experiment.variants;
    const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
    
    let random = Math.random() * totalWeight;
    for (const variant of variants) {
      random -= variant.weight;
      if (random <= 0) return variant;
    }
    
    return variants[0]; // fallback
  }
}
```

**Cache:** Experimento running é cached por 5 minutos (não muda frequentemente, evita query a cada session).

---

## Significance Calculator — Algorithm

```typescript
/**
 * Z-test para proporções (conversion rates)
 * Simples, correto pra binomial (converted: yes/no)
 */
class SignificanceCalculator {
  
  calculateConfidence(variants: VariantStats[]): SignificanceResult {
    // Ordena por conversion rate (melhor primeiro)
    const sorted = variants.sort((a, b) => b.conversionRate - a.conversionRate);
    const best = sorted[0];
    const second = sorted[1];
    
    // Z-test: H0 = ambos têm mesma taxa
    const p1 = best.converted / best.sessions;
    const p2 = second.converted / second.sessions;
    const n1 = best.sessions;
    const n2 = second.sessions;
    
    // Pooled proportion
    const p = (best.converted + second.converted) / (n1 + n2);
    const se = Math.sqrt(p * (1 - p) * (1/n1 + 1/n2));
    
    // Z-score
    const z = (p1 - p2) / se;
    
    // Confidence (one-tailed)
    const confidence = this.zToConfidence(z);
    
    return {
      winnerId: best.variantId,
      winnerName: best.name,
      confidence,  // 0..1
      isSignificant: confidence >= 0.95,
      needsMore: n1 < 100 || n2 < 100,
    };
  }
  
  private zToConfidence(z: number): number {
    // Approximation of normal CDF
    // z=1.65 → 95%, z=1.96 → 97.5%, z=2.33 → 99%
    return 0.5 * (1 + this.erf(z / Math.sqrt(2)));
  }
}
```

---

## Prompt Injection Protection

```typescript
// Validação ao criar/editar variante
const BLOCKED_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now/i,
  /forget\s+(everything|all|your)/i,
  /new\s+instructions/i,
  /disregard\s+(all|your|the)/i,
  /override\s+system/i,
  /bypass\s+safety/i,
  /disable\s+(safety|guard|filter)/i,
];

function validateVariantPrompt(prompt: string): boolean {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(prompt)) return false;
  }
  return true;
}
```

**Importante:** Variante é ADICIONADA como instrução de estilo dentro do system prompt existente. NÃO substitui o system prompt inteiro. Safety gates são independentes e rodam DEPOIS da geração.

---

## API Contract

### POST /api/experiments

```json
// Request
{
  "name": "Estilo de Oferta - Agosto",
  "variants": [
    { "name": "Agressivo", "weight": 1, "systemPrompt": "Você oferece desconto logo no início..." },
    { "name": "Consultivo", "weight": 1, "systemPrompt": "Você entende a necessidade antes..." },
    { "name": "Escassez", "weight": 1, "systemPrompt": "Você comunica urgência e escassez..." }
  ]
}

// Response (201)
{
  "id": "clx...",
  "merchantId": "m1",
  "name": "Estilo de Oferta - Agosto",
  "status": "draft",
  "variants": [...]
}
```

### POST /api/experiments/:id/start

```json
// Response (200)
{
  "id": "clx...",
  "status": "running",
  "startedAt": "2026-08-18T10:00:00Z"
}
```

### GET /api/experiments/:id/results

```json
// Response (200)
{
  "experiment": {
    "id": "clx...",
    "name": "Estilo de Oferta - Agosto",
    "status": "running",
    "startedAt": "2026-08-01T00:00:00Z"
  },
  "totalSessions": 342,
  "significance": {
    "confidence": 0.87,
    "isSignificant": false,
    "needsMore": false,
    "winnerId": "clx_consultivo",
    "winnerName": "Consultivo"
  },
  "variants": [
    {
      "id": "clx_consultivo",
      "name": "Consultivo",
      "sessions": 112,
      "converted": 31,
      "conversionRate": 0.277,
      "avgRevenue": 215.30,
      "offersShown": 89,
      "offersAccepted": 34,
      "offerAcceptanceRate": 0.382,
      "avgDurationSeconds": 245
    },
    {
      "id": "clx_agressivo",
      "name": "Agressivo",
      "sessions": 115,
      "converted": 23,
      "conversionRate": 0.200,
      "avgRevenue": 189.50,
      "offersShown": 102,
      "offersAccepted": 46,
      "offerAcceptanceRate": 0.451,
      "avgDurationSeconds": 120
    },
    {
      "id": "clx_escassez",
      "name": "Escassez",
      "sessions": 115,
      "converted": 19,
      "conversionRate": 0.165,
      "avgRevenue": 142.80,
      "offersShown": 98,
      "offersAccepted": 51,
      "offerAcceptanceRate": 0.520,
      "avgDurationSeconds": 95
    }
  ]
}
```

### POST /api/experiments/:id/promote

```json
// Request
{ "variantId": "clx_consultivo" }

// Response (200)
{
  "promoted": true,
  "variantName": "Consultivo",
  "appliedTo": "agent-identity"
}
```

---

## Dependencies

- **checkout module** → assign variant on session start, record result on complete
- **agent-rules module** → update configDocument when winner promoted
- **outbox** → emit events (experiment.started, experiment.completed, winner.promoted)
- **dashboard app** → nova tab "Testes A/B"

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Variante com prompt ruim crasheia agente | SafetyValidator + fallback template (existente) |
| Prompt injection via variante | Regex blocklist + variante como addon (não substitui base) |
| Tráfego insuficiente pra significance | Dashboard mostra "precisa mais dados" + min 100 sessions |
| Merchant promove winner errado | Confirmation dialog + revert possible |
| Performance (query experiment a cada session) | Cache 5min do experimento running |

---

## Testing Strategy

### Unit Tests
- ExperimentRouter: weighted random distribution (mock random, verify selection)
- SignificanceCalculator: known datasets → known confidence values
- Prompt injection validator: blocked patterns detected

### Integration Tests
- Create experiment → start → assign variant → record result → get results
- Promote winner → agent identity updated
- Safety: variant prompt + safety validator = safe output

### E2E Tests
- Full flow: merchant cria experimento → buyer faz checkout → resultado registrado → dashboard mostra
- Distribution: 1000 sessions simuladas → cada variante ≈33% (±5%)
- Promote: winner promovido → próximas sessions usam prompt default atualizado
- Safety: variante com conteúdo edge-case → safety gate funciona

