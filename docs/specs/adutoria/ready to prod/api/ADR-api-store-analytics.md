# ADR — API / store-analytics

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **CONDITIONAL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Agregações de venda/funil/produto por loja.

Inventário: 12 arquivos de implementação, 0 arquivos reconhecidos como testes, 1046 linhas de implementação. 6 declarações HTTP; 6 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `acceptedOffer`, `authorizedOffer`, `buyerPurchaseRecord`, `checkoutSession`, `completedOrder`, `merchant`, `paymentIntent`, `product`, `storeMetricDaily`, `storeProductMetric`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Zero testes do módulo encontrados; origem dos eventos frontend é quebrada. Planos de query e índices aplicados, timezone de relatórios e limites de intervalos não foram medidos.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 7/10 | 5/10 | 6/10 | 6/10 | 4/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Repositório usa consultas agregadas e delimitadores de merchant/janela em caminhos inspecionados.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| PrismaAnalyticsRepository | 304 | 1 | [apps/api/src/modules/store-analytics/infrastructure/repositories/prisma-analytics.repository.ts:54](<../../../../../apps/api/src/modules/store-analytics/infrastructure/repositories/prisma-analytics.repository.ts#L54>) |
| AnalyticsController | 113 | 6 | [apps/api/src/modules/store-analytics/presentation/http/analytics.controller.ts:12](<../../../../../apps/api/src/modules/store-analytics/presentation/http/analytics.controller.ts#L12>) |
| GA4MeasurementService | 78 | 0 | [apps/api/src/modules/store-analytics/infrastructure/ga4-measurement.service.ts:30](<../../../../../apps/api/src/modules/store-analytics/infrastructure/ga4-measurement.service.ts#L30>) |

Há candidato a concentração de responsabilidades. Separar protocolo HTTP, política de negócio e coordenação de efeitos em etapas pequenas; tamanho é sinal de revisão, não defeito por si só.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [W2-008](<../widget_v2/ADR-widget_v2.md#w2-008>) (P2): Tracking envia campos diferentes do contrato e não captura rejeição assíncrona.
- [API-034](<ADR-api-revenue-lift.md#api-034>) (P2): Atribuição monetária usa unidade divergente e só é logada neste fluxo.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Reconciliação com ledger/eventos, timezone explícito, paginação/janela máxima e EXPLAIN com volume representativo.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /merchants/:mid/analytics/dashboard | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-analytics/presentation/http/analytics.controller.ts:24](<../../../../../apps/api/src/modules/store-analytics/presentation/http/analytics.controller.ts#L24>) |
| GET /merchants/:mid/analytics/products | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-analytics/presentation/http/analytics.controller.ts:35](<../../../../../apps/api/src/modules/store-analytics/presentation/http/analytics.controller.ts#L35>) |
| GET /merchants/:mid/analytics/offers | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-analytics/presentation/http/analytics.controller.ts:53](<../../../../../apps/api/src/modules/store-analytics/presentation/http/analytics.controller.ts#L53>) |
| GET /merchants/:mid/analytics/payments | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-analytics/presentation/http/analytics.controller.ts:66](<../../../../../apps/api/src/modules/store-analytics/presentation/http/analytics.controller.ts#L66>) |
| GET /merchants/:mid/analytics/customers | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-analytics/presentation/http/analytics.controller.ts:79](<../../../../../apps/api/src/modules/store-analytics/presentation/http/analytics.controller.ts#L79>) |
| GET /merchants/:mid/analytics/overview | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-analytics/presentation/http/analytics.controller.ts:92](<../../../../../apps/api/src/modules/store-analytics/presentation/http/analytics.controller.ts#L92>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.



## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
