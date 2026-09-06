# ADR — API / revenue-manager

> Atualização de implementação: consulte a [terceira etapa](../CORRECOES-ETAPA-3.md). O restante deste ADR preserva o diagnóstico original; validação local não encerra o gate de produção.

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **CONDITIONAL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Observar métricas, formular hipóteses e registrar aprendizagem operacional.

Inventário: 25 arquivos de implementação, 9 arquivos reconhecidos como testes, 2578 linhas de implementação. 6 declarações HTTP; 6 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, experiments**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `checkoutEvent`, `checkoutSession`, `completedOrder`, `merchant`, `negotiationCostLedgerEntry`, `outboxMessage`, `promptExperiment`, `revenueManagerHypothesis`, `revenueManagerObservation`, `revenueManagerStrategyLesson`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Fallbacks numéricos sintéticos contaminam análise. Execução autônoma precisa versão, evidência, limite de ação e audit do resultado; precisão/performance de AI não validadas.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 7/10 | 5/10 | 6/10 | 6/10 | 3/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Casos de uso e entidades separam hipótese/observação/estratégia.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| ObserveMetricsUseCase | 258 | 2 | [apps/api/src/modules/revenue-manager/application/use-cases/observe-metrics.use-case.ts:32](<../../../../../apps/api/src/modules/revenue-manager/application/use-cases/observe-metrics.use-case.ts#L32>) |
| LLMHypothesisGenerator | 203 | 0 | [apps/api/src/modules/revenue-manager/infrastructure/hypothesis-generator.adapter.ts:16](<../../../../../apps/api/src/modules/revenue-manager/infrastructure/hypothesis-generator.adapter.ts#L16>) |
| RevenueManagerController | 180 | 6 | [apps/api/src/modules/revenue-manager/presentation/http/revenue-manager.controller.ts:38](<../../../../../apps/api/src/modules/revenue-manager/presentation/http/revenue-manager.controller.ts#L38>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-033](<ADR-api-revenue-manager.md#api-033>) (P2): Observação usa estimativas fixas como métricas.
- [API-034](<ADR-api-revenue-lift.md#api-034>) (P2): Atribuição monetária usa unidade divergente e só é logada neste fluxo.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Dados insuficientes devem bloquear decisão dependente; rastrear hipótese→ação→resultado com métricas reais.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /revenue-manager/observations | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/revenue-manager/presentation/http/revenue-manager.controller.ts:54](<../../../../../apps/api/src/modules/revenue-manager/presentation/http/revenue-manager.controller.ts#L54>) |
| GET /revenue-manager/hypotheses | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/revenue-manager/presentation/http/revenue-manager.controller.ts:83](<../../../../../apps/api/src/modules/revenue-manager/presentation/http/revenue-manager.controller.ts#L83>) |
| POST /revenue-manager/hypotheses/:id/approve | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/revenue-manager/presentation/http/revenue-manager.controller.ts:124](<../../../../../apps/api/src/modules/revenue-manager/presentation/http/revenue-manager.controller.ts#L124>) |
| POST /revenue-manager/hypotheses/:id/reject | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/revenue-manager/presentation/http/revenue-manager.controller.ts:148](<../../../../../apps/api/src/modules/revenue-manager/presentation/http/revenue-manager.controller.ts#L148>) |
| GET /revenue-manager/strategy-lessons | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/revenue-manager/presentation/http/revenue-manager.controller.ts:176](<../../../../../apps/api/src/modules/revenue-manager/presentation/http/revenue-manager.controller.ts#L176>) |
| POST /revenue-manager/trigger | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/revenue-manager/presentation/http/revenue-manager.controller.ts:207](<../../../../../apps/api/src/modules/revenue-manager/presentation/http/revenue-manager.controller.ts#L207>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-033"></a>

## API-033 — Observação usa estimativas fixas como métricas

| Campo | Registro |
| --- | --- |
| ID | API-033 |
| SEVERITY | P2 |
| MODULE | revenue-manager |
| FILE(S) | [apps/api/src/modules/revenue-manager/application/use-cases/observe-metrics.use-case.ts:115](<../../../../../apps/api/src/modules/revenue-manager/application/use-cases/observe-metrics.use-case.ts#L115>) |
| ISSUE | Observação usa estimativas fixas como métricas |
| EVIDENCE | Fallbacks calculam parcelas de sessões por 0.6/0.4 e taxas de abandono fixas em vez de retornar ausência de medição. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Hipóteses e decisões automáticas podem se apoiar em valores sintéticos apresentados como observação. |
| ROOT CAUSE | Disponibilidade de dado substituída por número plausível sem provenance. |
| RECOMMENDED FIX | Retornar unknown/insufficient_data com fonte e janela; bloquear avaliação automática que exige métrica ausente. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | NO |
| CRITÉRIO DE ACEITE | Dataset sem eventos medidos não pode gerar taxa observada; decisão registra origem/amostra e exige dados suficientes. |

Decisão: registrar correção priorizada e acompanhar o risco residual. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
