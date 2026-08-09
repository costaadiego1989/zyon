# Resumo da Adaptação do Prompt — Template AIOS → AACP

## Status

✅ **Prompt adaptado e salvo em:** `.specs/audit/AACP_DOCS_PROMPT_ADAPTED.md`

---

## Mapeamento Principal

### Identidade do Projeto

| Aspecto | Template Original | AACP Real |
| --- | --- | --- |
| **Nome** | AIOS | AACP (Agentic AI Checkout Platform) |
| **Tipo** | Universal AI Platform + Compute Network | Plataforma de checkout agêntico multi-tenant |
| **Modelo** | Cloud + On-Prem + Compute Network | Cloud monolito modular NestJS |
| **Stack** | Python, Kubernetes, etc | NestJS + Prisma + React + Vite |
| **Tenant** | Organization | Merchant (`merchant_id`) |
| **Buyer** | N/A | `global_user_id` |

### Integrações

| Template Original | AACP Real |
| --- | --- |
| OpenRouter + GPT | OpenAI / Fable 5 + fallback determinístico |
| Provider Adapters (multi-provider LLM) | Commerce Adapters (Shopify GraphQL) + Payment (Asaas, Stripe, Crypto) |
| BYOK | Merchant rules (`AgentRule`, `MerchantRule`) |
| Metering / Billing | Asaas integration + `OutboxMessage` |
| Rate Limit | `LoginAttemptCounter` (auth) + planned global |
| Circuit Breaker | Planejado |
| Observability | Logs estruturados; métricas/traces faltam |

### Personas

| Template | AACP |
| --- | --- |
| Developer | Merchant Owner, Merchant Operator |
| CTO | Platform Admin |
| FinOps | Finance internal |
| Platform Engineer | Platform Admin |
| Administrator | Merchant Operator, Support Agent |
| Compute Provider | N/A (PLANNED em Compute Network) |
| End User | Buyer |

---

## Módulos — Mapeamento

### Template Original (39 módulos) → AACP Real (34 módulos)

#### Encontrados e IMPLEMENTADOS (23)

1. ✅ **auth** → `authentication`
2. ✅ **buyer-account** → `buyer profile + OTP + WebAuthn`
3. ✅ **checkout** → core checkout flow
4. ✅ **checkout-settings** → widget behavior + triggers
5. ✅ **agent-rules** → identity + guardrails
6. ✅ **merchant** → merchant config
7. ✅ **negotiation** → M2M negotiation
8. ✅ **payment** → Asaas + Stripe + Crypto
9. ✅ **commerce** → Shopify sync
10. ✅ **fulfillment** → shipment + tracking
11. ✅ **shipping** → quotes + engine
12. ✅ **coupons** → cupons + redemptions
13. ✅ **cross-sell** → promoções + sugestões
14. ✅ **support** → tickets + FAQ
15. ✅ **audit** → eventos auditoria
16. ✅ **buyer-purchase-history** → personalização
17. ✅ **rules-engine** (pacote) → discount validation
18. ✅ **decision-engine** (pacote) → offer decisions
19. ✅ **conversation-engine** (pacote) → objection classifier + copy
20. ✅ **shipping-engine** (pacote) → shipping math
21. ✅ **negotiation-engine** (pacote) → M2M logic
22. ✅ **recommendations** (pacote) → recomendation-engine
23. ✅ **agent-orchestrator** (embedido em checkout)

#### Parcialmente Implementados (8)

24. ⚠️ **observability** — logs existem, métricas/traces faltam
25. ⚠️ **rate-limit** — LoginAttemptCounter em auth; global falta
26. ⚠️ **api-keys** — `MerchantApiKey` em auth
27. ⚠️ **billing** — Asaas integrado; metering avançado falta
28. ⚠️ **notifications** — suporte parcial; canal dedicado falta
29. ⚠️ **governance** — via `agent-rules`; centralizado falta
30. ⚠️ **quality-harness** — testes de safety existem; runtime validation falta
31. ⚠️ **evaluation** — `.specs/checkout-ai-safety-battery` planejado

#### Scaffold / Mocked (3)

32. 🏗️ **self-checkout** — estrutura; integração parcial
33. 🏗️ **scraping-agent** — `PriceQuoteJob` entity; execution falta
34. 🏗️ **installations** — `MerchantInstallation` para WP plugin; sync falta

#### Packages (11)

35. ✅ `shared-types`
36. ✅ `contracts`
37. ✅ `agentic-checkout-js` (SDK TS)
38. ✅ `commerce-adapters`
39. ✅ `payments-evm`

### Template Original NÃO ENCONTRADOS no AACP (16)

- ❌ Universal AI Gateway → `MISSING` (checkout orchestrator substitui)
- ❌ Provider Adapters (multi-LLM) → `MISSING` (fixo em OpenAI)
- ❌ Smart Router → `MISSING`
- ❌ Complexity Classifier → `MISSING`
- ❌ Semantic Cache → `MISSING`
- ❌ Prompt Compaction → `MISSING`
- ❌ Adaptive Intelligence Loop → `MISSING`
- ❌ Circuit Breaker → `MISSING`
- ❌ BYOK (gerenciamento) → `MISSING` (existe apenas regras)
- ❌ Provisioner → `MISSING`
- ❌ Cluster Manager → `MISSING`
- ❌ AIOps → `MISSING`
- ❌ Portfolio Manager → `MISSING`
- ❌ Benchmark → `MISSING`
- ❌ SDK Python → `MISSING`
- ❌ IDE Integration → `MISSING`

### AACP Específicos (não no template)

- ✅ **onboarding** — merchant wizard
- ✅ **integrations** — conexões gerais
- ✅ **operations** — admin internas
- ✅ **embed** — session tokens para widget
- ✅ **catalog** — product catalog
- ✅ **self-checkout** — checkout sem agente

---

## Estrutura de Documentação

### Criar em `docs/modules/`

```
docs/modules/
├── README.md                                    # Índice mestre
├── IMPLEMENTATION_MATRIX.md                     # Matriz de status (56 linhas = 34 módulos + headers)
├── DEPENDENCY_MAP.md                            # Mapa de dependências (Mermaid)
├── USER_JOURNEYS.md                             # 18 jornadas
│
├── [LOTE 1] Fundação
│   ├── auth/                    OVERVIEW.md, API.md, FRONTEND.md, IMPLEMENTATION.md
│   ├── onboarding/
│   ├── merchant/
│   ├── buyer-account/
│   ├── audit/
│   └── ...
│
├── [LOTE 2] Checkout Core
│   ├── checkout/
│   ├── checkout-settings/
│   ├── agent-rules/
│   ├── fulfillment/
│   ├── shipping/
│   └── ...
│
├── [LOTE 3] Inteligência
│   ├── rules-engine/
│   ├── decision-engine/
│   ├── conversation-engine/
│   ├── buyer-purchase-history/
│   └── ...
│
├── [LOTE 4] Negociação
│   ├── negotiation/
│   ├── negotiation-engine/
│   ├── support/
│   └── ...
│
├── [LOTE 5] Pagamentos
│   ├── payment/
│   ├── payments-evm/
│   ├── commerce/
│   └── ...
│
├── [LOTE 6] Platform
│   ├── shared-types/
│   ├── contracts/
│   ├── agentic-checkout-js/
│   └── dashboard/
│
└── [LOTE 7] Compute Network (PLANNED — todos MISSING ou PLANNED)
    ├── compute-provider-management/
    ├── aios-worker/
    └── ...
```

### Preservar documentação existente

- ✅ `docs/architecture/bounded-contexts.md` — referenciar como "mapa oficial"
- ✅ `docs/architecture/adr/0001-0014` — linkar em cada módulo
- ✅ `.specs/codebase/STACK.md`, `TESTING.md`, `INTEGRATIONS.md`, `CONCERNS.md`
- ✅ `.specs/features/<feature>/` — referenciar como source of truth para planejamento

---

## Estatísticas Esperadas (resumo final)

| Métrica | Valor |
| --- | --- |
| **Módulos encontrados no código** | 34 (23 backend + 11 packages) |
| **Módulos apenas documentados** | 8 (specs + ADRs) |
| **Módulos planejados (Compute Network)** | 25 |
| **Documentos a criar** | ~136 (4 por módulo × 34) |
| **Próximos à produção** | auth, checkout, payment, commerce, audit (5) |
| **Somente scaffolding** | self-checkout, scraping-agent, installations (3) |
| **Maiores gaps backend** | observability, rate-limit global, circuit-breaker, gateway, metering, notifications, fraud-detection, settlements, governance, cache |
| **Maiores gaps frontend** | observability dashboard, FinOps console, Compute Provider portal, Admin console (PLANNED) |
| **Riscos arquiteturais** | (a identificar durante documentação) |
| **Permanecer no monolito** | auth, checkout, merchant, decision-engine, conversation-engine (core negotiation logic) |
| **Candidatos a serviço separado** | (a identificar durante análise de dependências) |

---

## Próximos Passos

1. **Você (usuário)** executa o prompt `.specs/audit/AACP_DOCS_PROMPT_ADAPTED.md`
   - Trabalhe em lotes (8 lotes definidos)
   - Não implemente código, somente documente
   - Ao terminar cada lote, revise, não pare para pedir autorização

2. **Resultado esperado**
   - 136+ arquivos `.md` em `docs/modules/`
   - Índice mestre atualizado
   - Matriz de implementação completa
   - Mapa de dependências com Mermaid
   - Resumo final com 17 pontos obrigatórios

3. **Qualidade**
   - Evidências sempre citadas (arquivo:linha, DTO, controller, spec)
   - Sem inventar contratos ou telas
   - Status padronizado + justificativas
   - Links entre módulos verificados
   - Preservar documentação existente (ADRs, specs)

---

## Configuração Pronta

✅ Prompt salvo em: `.specs/audit/AACP_DOCS_PROMPT_ADAPTED.md`
✅ Este resumo em: `.specs/audit/PROMPT_ADAPTATION_SUMMARY.md`

**Para iniciar a documentação, copie o prompt adapted e execute etapa por etapa.**