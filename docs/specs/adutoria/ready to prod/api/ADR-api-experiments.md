# ADR — API / experiments

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Configurar variantes, atribuir sessões, coletar métricas e promover vencedor.

Inventário: 26 arquivos de implementação, 6 arquivos reconhecidos como testes, 2635 linhas de implementação. 18 declarações HTTP; 18 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, integrations**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `checkoutSession`, `promptExperiment`, `promptVariant`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Não foi demonstrado rollout consistente de promoção nem atomicidade entre promoção e evento. Análise estatística exige população/contaminação e stop rules explícitas; sem tráfego real não há validação de resultado.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 7/10 | 5/10 | 6/10 | 6/10 | 4/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Entidades/resultados com persistência; registro de resultado verifica a sessão por merchant. Checkout mantém atribuição no snapshot.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| ExperimentsController | 229 | 9 | [apps/api/src/modules/experiments/presentation/http/experiments.controller.ts:39](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments.controller.ts#L39>) |
| PromptExperimentEntity | 191 | 1 | [apps/api/src/modules/experiments/domain/entities/prompt-experiment.entity.ts:27](<../../../../../apps/api/src/modules/experiments/domain/entities/prompt-experiment.entity.ts#L27>) |
| ExperimentsDashboardController | 181 | 9 | [apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts:40](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts#L40>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-016](<ADR-api-shared.md#api-016>) (P1): Claim do outbox não conserva exclusividade até o processamento.
- [API-034](<ADR-api-revenue-lift.md#api-034>) (P2): Atribuição monetária usa unidade divergente e só é logada neste fluxo.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Assignment estável por sessão, tenant A/B, promoção concorrente, evento recuperável e dados mínimos para decisão.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /dashboard/experiments | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts:55](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts#L55>) |
| GET /dashboard/experiments/:id | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts:62](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts#L62>) |
| POST /dashboard/experiments | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts:70](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts#L70>) |
| PUT /dashboard/experiments/:id | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts:92](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts#L92>) |
| POST /dashboard/experiments/:id/start | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts:116](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts#L116>) |
| POST /dashboard/experiments/:id/stop | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts:129](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts#L129>) |
| POST /dashboard/experiments/:id/archive | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts:142](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts#L142>) |
| POST /dashboard/experiments/:id/promote | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts:155](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts#L155>) |
| GET /dashboard/experiments/:id/results | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts:173](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments-dashboard.controller.ts#L173>) |
| POST /experiments | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments.controller.ts:56](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments.controller.ts#L56>) |
| GET /experiments | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments.controller.ts:79](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments.controller.ts#L79>) |
| GET /experiments/:id | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments.controller.ts:91](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments.controller.ts#L91>) |
| PUT /experiments/:id | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments.controller.ts:107](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments.controller.ts#L107>) |
| POST /experiments/:id/start | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments.controller.ts:132](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments.controller.ts#L132>) |
| POST /experiments/:id/stop | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments.controller.ts:150](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments.controller.ts#L150>) |
| POST /experiments/:id/archive | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments.controller.ts:168](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments.controller.ts#L168>) |
| POST /experiments/:id/promote | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments.controller.ts:186](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments.controller.ts#L186>) |
| GET /experiments/:id/results | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/experiments/presentation/http/experiments.controller.ts:208](<../../../../../apps/api/src/modules/experiments/presentation/http/experiments.controller.ts#L208>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.



## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
