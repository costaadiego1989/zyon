# ADR — API / inventory

> Atualização de implementação: consulte a [terceira etapa](../CORRECOES-ETAPA-3.md). O restante deste ADR preserva o diagnóstico original; validação local não encerra o gate de produção.

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Estoque operacional, movimentações, ERP, alertas e integrações CRM.

Inventário: 52 arquivos de implementação, 1 arquivos reconhecidos como testes, 3500 linhas de implementação. 18 declarações HTTP; 18 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, checkout, integrations**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `crmConnection`, `erpConnection`, `inventoryAlert`, `inventoryItem`, `inventoryLocation`, `inventoryMovement`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Coexiste com catálogo estoque; dono do saldo precisa ser único. Handler de venda com token incorreto e erros absorvidos compromete baixa; transferências e ajuste de saldo/auditoria exigem transação por depósito.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 5/10 | 3/10 | 3/10 | 3/10 | 2/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Portas de inventário/ERP e casos de uso separados por movimentação; identificadores merchant aparecem no modelo.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| ErpOAuthController | 307 | 1 | [apps/api/src/modules/inventory/presentation/http/erp-oauth.controller.ts:13](<../../../../../apps/api/src/modules/inventory/presentation/http/erp-oauth.controller.ts#L13>) |
| PrismaInventoryRepository | 273 | 1 | [apps/api/src/modules/inventory/infrastructure/repositories/prisma-inventory.repository.ts:6](<../../../../../apps/api/src/modules/inventory/infrastructure/repositories/prisma-inventory.repository.ts#L6>) |
| InventoryDashboardController | 242 | 15 | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:25](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L25>) |

Há candidato a concentração de responsabilidades. Separar protocolo HTTP, política de negócio e coordenação de efeitos em etapas pequenas; tamanho é sinal de revisão, não defeito por si só.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-017](<ADR-api-inventory.md#api-017>) (P1): Handler de venda injeta token incorreto e absorve falhas.
- [API-002](<ADR-api-catalog.md#api-002>) (P0): Reserva concorrente pode ultrapassar estoque disponível.
- [API-016](<ADR-api-shared.md#api-016>) (P1): Claim do outbox não conserva exclusividade até o processamento.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Conservar estoque por depósito, reconciliar catálogo/inventory/ERP, provar exatamente um efeito de baixa por item pago.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /inventory/erp/oauth/:provider/authorize | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/erp-oauth.controller.ts:23](<../../../../../apps/api/src/modules/inventory/presentation/http/erp-oauth.controller.ts#L23>) |
| GET /inventory/erp/oauth/callback | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/inventory/presentation/http/erp-oauth.controller.ts:104](<../../../../../apps/api/src/modules/inventory/presentation/http/erp-oauth.controller.ts#L104>) |
| GET /dashboard/inventory/summary | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:48](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L48>) |
| GET /dashboard/inventory/items | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:56](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L56>) |
| POST /dashboard/inventory/items/:id/movements | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:74](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L74>) |
| POST /dashboard/inventory/items/transfer | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:95](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L95>) |
| GET /dashboard/inventory/movements | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:114](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L114>) |
| GET /dashboard/inventory/alerts | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:133](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L133>) |
| POST /dashboard/inventory/alerts/:id/acknowledge | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:145](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L145>) |
| GET /dashboard/inventory/locations | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:156](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L156>) |
| POST /dashboard/inventory/locations | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:164](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L164>) |
| GET /dashboard/inventory/erp-connections | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:177](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L177>) |
| POST /dashboard/inventory/erp-connections/:provider/connect | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:185](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L185>) |
| POST /dashboard/inventory/erp-connections/:id/disconnect | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:207](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L207>) |
| POST /dashboard/inventory/erp-connections/:id/sync | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:218](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L218>) |
| GET /dashboard/inventory/crm-connections | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:230](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L230>) |
| POST /dashboard/inventory/crm-connections/:provider/connect | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:238](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L238>) |
| POST /dashboard/inventory/crm-connections/:id/disconnect | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts:256](<../../../../../apps/api/src/modules/inventory/presentation/http/inventory-dashboard.controller.ts#L256>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-017"></a>

## API-017 — Handler de venda injeta token incorreto e absorve falhas

| Campo | Registro |
| --- | --- |
| ID | API-017 |
| SEVERITY | P1 |
| MODULE | inventory |
| FILE(S) | [apps/api/src/modules/inventory/infrastructure/event-handlers/on-order-completed.handler.ts:15](<../../../../../apps/api/src/modules/inventory/infrastructure/event-handlers/on-order-completed.handler.ts#L15>)<br>[apps/api/src/modules/inventory/application/use-cases/handle-sale-completed.use-case.ts:1](<../../../../../apps/api/src/modules/inventory/application/use-cases/handle-sale-completed.use-case.ts#L1>)<br>[apps/api/src/modules/checkout/domain/ports/checkout-session.repository.port.ts:1](<../../../../../apps/api/src/modules/checkout/domain/ports/checkout-session.repository.port.ts#L1>) |
| ISSUE | Handler de venda injeta token incorreto e absorve falhas |
| EVIDENCE | Handler usa @Optional @Inject("CHECKOUT_SESSION_REPOSITORY") string, enquanto a porta exporta Symbol. Sem provider com essa string, items fica vazio. O handler e o use case também capturam falhas sem propagá-las para o outbox. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Pedido concluído pode não baixar estoque nem sincronizar ERP/CRM; evento é considerado entregue sem retry. |
| ROOT CAUSE | Injeção opcional mascara dependência essencial e captura de erro elimina sinal de falha. |
| RECOMMENDED FIX | Usar a porta exportada com wiring obrigatório ou payload de venda versionado; tornar baixa idempotente e separar integrações em jobs retryable. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Teste de composição Nest deve resolver a dependência real; evento order.completed baixa itens uma vez; falha no ERP gera retry independente sem repetir a baixa. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
