# ADR — API / revenue-lift

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **CONDITIONAL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Atribuir receita e comparar tratamento/holdout.

Inventário: 7 arquivos de implementação, 5 arquivos reconhecidos como testes, 499 linhas de implementação. 2 declarações HTTP; 2 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

O extrator não reconheceu acessos Prisma diretos; isso não comprova ausência de persistência indireta/SQL.

Unidades monetárias e persistência da atribuição no checkout não estão fechadas; população de sessões não convertidas deve participar da análise.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 6/10 | 5/10 | 5/10 | 5/10 | 3/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Há serviço de cohort determinístico e consultas agregadas por merchant/janela.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| RevenueLiftRepository | 88 | 1 | [apps/api/src/modules/revenue-lift/infrastructure/revenue-lift.repository.ts:26](<../../../../../apps/api/src/modules/revenue-lift/infrastructure/revenue-lift.repository.ts#L26>) |
| AttributionTaggerService | 49 | 0 | [apps/api/src/modules/revenue-lift/domain/services/attribution-tagger.service.ts:49](<../../../../../apps/api/src/modules/revenue-lift/domain/services/attribution-tagger.service.ts#L49>) |
| RevenueLiftCalculatorService | 45 | 0 | [apps/api/src/modules/revenue-lift/domain/services/revenue-lift-calculator.service.ts:37](<../../../../../apps/api/src/modules/revenue-lift/domain/services/revenue-lift-calculator.service.ts#L37>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-034](<ADR-api-revenue-lift.md#api-034>) (P2): Atribuição monetária usa unidade divergente e só é logada neste fluxo.
- [W2-008](<../widget_v2/ADR-widget_v2.md#w2-008>) (P2): Tracking envia campos diferentes do contrato e não captura rejeição assíncrona.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Reconciliar source events, centavos, cohort, denominator, descontos e custo AI antes de exibir lift como medido.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /analytics/revenue-lift | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/revenue-lift/presentation/http/revenue-lift.controller.ts:16](<../../../../../apps/api/src/modules/revenue-lift/presentation/http/revenue-lift.controller.ts#L16>) |
| GET /analytics/revenue-lift/trend | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/revenue-lift/presentation/http/revenue-lift.controller.ts:28](<../../../../../apps/api/src/modules/revenue-lift/presentation/http/revenue-lift.controller.ts#L28>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-034"></a>

## API-034 — Atribuição monetária usa unidade divergente e só é logada neste fluxo

| Campo | Registro |
| --- | --- |
| ID | API-034 |
| SEVERITY | P2 |
| MODULE | revenue-lift |
| FILE(S) | [apps/api/src/modules/checkout/application/use-cases/complete-order.use-case.ts:210](<../../../../../apps/api/src/modules/checkout/application/use-cases/complete-order.use-case.ts#L210>)<br>[apps/api/src/modules/revenue-lift/domain/services/attribution-tagger.service.ts:1](<../../../../../apps/api/src/modules/revenue-lift/domain/services/attribution-tagger.service.ts#L1>) |
| ISSUE | Atribuição monetária usa unidade divergente e só é logada neste fluxo |
| EVIDENCE | CompleteOrder passa order_total em moeda principal como orderValueCents ao tagger, com flags/AI cost fixados, e registra resultado por logger.debug. Isso não demonstra persistência completa de attribution_tags consultada pelo relatório. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Revenue lift pode ficar vazio ou representar valores escalados incorretamente; não há evidência de medição confiável de incrementalidade. |
| ROOT CAUSE | Contrato de unidade e cadeia de coleta/projeção não estão fechados. |
| RECOMMENDED FIX | Padronizar centavos, persistir tag versionada e medir tratamento/controle de todas as sessões elegíveis; explicitar ausência de amostra. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | NO |
| CRITÉRIO DE ACEITE | Pedido de R$100 deve persistir 10000 centavos; relatório precisa reconciliar população, conversões e custos com eventos de origem. |

Decisão: registrar correção priorizada e acompanhar o risco residual. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
