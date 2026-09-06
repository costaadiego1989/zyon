# ADR — API / marketplace

> Implementação posterior integrada na `master`: consultar [correções, evidências e pendências](../CORRECOES.md). O conteúdo abaixo preserva o retrato da auditoria original; o gate de produção continua aberto.


Data: 2026-09-05. Status: decisão de auditoria registrada; atualização de implementação em 2026-09-06. Veredito: **FAIL** até os gates financeiros com provedor real.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Catálogo federado, pedidos entre lojas, liquidações, dívidas e chargebacks.

Inventário: 37 arquivos de implementação, 13 arquivos reconhecidos como testes, 3627 linhas de implementação. 16 declarações HTTP; 16 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `crossStoreLineItem`, `federatedProduct`, `marketplaceConfig`, `marketplaceConnection`, `marketplaceSellerDebt`, `marketplaceSettlement`, `merchant`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Financeiro tem conclusão fictícia e comando chargeback sem tenant. Workers/setIntervals, APIs públicas parcialmente montadas e fontes de estoque tornam as fronteiras frágeis.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 4/10 | 3/10 | 2/10 | 2/10 | 1/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Há máquina de estados de settlement, listagens por vendedor e fila BullMQ de catálogo com retry/close.

## Atualização pós-auditoria — 2026-09-06

O dashboard tinha ações de envio e entrega que chamavam rotas inexistentes. A API agora expõe as duas operações sob `/marketplace/dashboard`, deriva o vendedor do principal autenticado e atualiza o item com predicado de tenant e estado esperado. A sequência permitida é `pending → shipped → delivered`; envio exige rastreio e concorrência retorna conflito, sem sobrescrever outro estado.

O build completo da API, o typecheck do dashboard e verificações diretas de ownership, transição inválida e concorrência passaram. DASH-004 deixa de ser pendência de implementação. Isso não libera marketplace para produção: API-006 e API-008 continuam bloqueadores financeiros.

O job de repasses também foi revisado no código atual: ele mantém o settlement em `transfer_scheduled` quando o provedor não está disponível, contabiliza o bloqueio e registra `marketplace_payout_blocked`; não grava `transferred` nem inventa `providerTransferId`. A verificação direta com dois repasses vencidos confirmou zero escrita e zero transferências executadas. API-008 deixa de ser uma conclusão financeira falsa, mas a capacidade de payout permanece indisponível até existir adaptador, idempotência e conciliação de provedor.

A fila de sincronização de catálogo agora preserva `eventId` e versão de schema, usa um `jobId` derivado e seguro para BullMQ e preserva TLS quando `REDIS_URL` usa `rediss://`. O consumidor trata o evento como invalidação e relê o produto canônico antes de projetá-lo; portanto, `delete v3` seguido de `upsert v2` converge para a exclusão, e um delete antigo após reativação converge para o produto atual. A projeção também torna delete idempotente. O build da API e uma verificação direta dos dois cenários, do job ID e do parsing TLS passaram. Não houve conexão contra Redis TLS real, e a emissão direta de eventos do catálogo ainda não é um outbox transacional; queda entre a mutação e a publicação exige reconciliação posterior.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| MarketplaceModule | 242 | 0 | [apps/api/src/modules/marketplace/marketplace.module.ts:51](<../../../../../apps/api/src/modules/marketplace/marketplace.module.ts#L51>) |
| PrismaFederatedProductRepository | 172 | 1 | [apps/api/src/modules/marketplace/infrastructure/repositories/prisma-federated-product.repository.ts:11](<../../../../../apps/api/src/modules/marketplace/infrastructure/repositories/prisma-federated-product.repository.ts#L11>) |
| MarketplaceController | 165 | 10 | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:34](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L34>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-006](<ADR-api-marketplace.md#api-006>) (P0): Chargeback administrativo não recebe nem valida a loja.
- [API-008](<ADR-api-marketplace.md#api-008>) (P0): correção fail-closed presente; payout com provedor e conciliação continuam bloqueadores.
- [API-040](<ADR-api-marketplace.md#api-040>) (P2): implementado localmente; outbox transacional e Redis TLS real continuam gates operacionais.
- [DASH-004](<../dashboard/ADR-dashboard.md#dash-004>) (P1): corrigido em 2026-09-06; envio/entrega usam rotas declaradas, tenant-bound e com transição estrita.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Tenant adversarial, payout real conciliado, transação settlement/debt, ordering de catálogo e restart de jobs.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /marketplace/stores | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace-discovery.controller.ts:44](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace-discovery.controller.ts#L44>) |
| POST /marketplace/stores/:sellerId/connect | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace-discovery.controller.ts:113](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace-discovery.controller.ts#L113>) |
| DELETE /marketplace/stores/:sellerId/connect | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace-discovery.controller.ts:139](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace-discovery.controller.ts#L139>) |
| GET /marketplace/stores/my-connections | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace-discovery.controller.ts:158](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace-discovery.controller.ts#L158>) |
| GET /marketplace/dashboard/config | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:50](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L50>) |
| PATCH /marketplace/dashboard/config | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:59](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L59>) |
| GET /marketplace/dashboard/orders | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:77](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L77>) |
| GET /marketplace/dashboard/stats | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:85](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L85>) |
| POST /marketplace/dashboard/line-items/:lineItemId/ship | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:204](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L204>) |
| POST /marketplace/dashboard/line-items/:lineItemId/deliver | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:222](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L222>) |
| POST /marketplace/dashboard/chargeback/:settlementId | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:93](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L93>) |
| GET /marketplace/dashboard/settlements | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:103](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L103>) |
| GET /marketplace/dashboard/settlements/:settlementId | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:123](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L123>) |
| GET /marketplace/dashboard/debts | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:135](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L135>) |
| GET /marketplace/dashboard/debts/:debtId | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:147](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L147>) |
| GET /marketplace/dashboard/chargebacks | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:159](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L159>) |
| POST /marketplace/dashboard/chargebacks/:id/dispute | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:167](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L167>) |
| GET /marketplace/dashboard/events | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:186](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L186>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-006"></a>

## API-006 — Chargeback administrativo não recebe nem valida a loja

| Campo | Registro |
| --- | --- |
| ID | API-006 |
| SEVERITY | P0 |
| MODULE | marketplace |
| FILE(S) | [apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:93](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L93>)<br>[apps/api/src/modules/marketplace/application/use-cases/handle-marketplace-chargeback.use-case.ts:34](<../../../../../apps/api/src/modules/marketplace/application/use-cases/handle-marketplace-chargeback.use-case.ts#L34>)<br>[apps/api/src/modules/marketplace/infrastructure/repositories/prisma-marketplace-settlement.repository.ts:36](<../../../../../apps/api/src/modules/marketplace/infrastructure/repositories/prisma-marketplace-settlement.repository.ts#L36>) |
| ISSUE | Chargeback administrativo não recebe nem valida a loja |
| EVIDENCE | POST marketplace/dashboard/chargeback/:settlementId exige login, mas descarta request.user. O use case consulta getById(settlementId), transiciona o settlement e pode criar dívida sem tenant. Repositório busca/atualiza somente id. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Uma loja autenticada com ID conhecido pode cancelar liquidação ou criar dívida de outro vendedor. |
| ROOT CAUSE | Comando financeiro exposto como operação global em uma rota de tenant. |
| RECOMMENDED FIX | Passar merchant derivado do principal e validar papel/participação/autoridade do evento; chargeback do provedor deve ter entrada autenticada separada e transação idempotente. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Settlement de B não pode ser afetado por A; replay do evento do provedor não duplica dívida; falha entre transição e criação deve reverter ou ser recuperada. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="api-008"></a>

## API-008 — Job marcava transferência como realizada sem provedor

| Campo | Registro |
| --- | --- |
| ID | API-008 |
| SEVERITY | P0 |
| MODULE | marketplace |
| FILE(S) | [apps/api/src/modules/marketplace/application/use-cases/process-scheduled-transfers.use-case.ts:60](<../../../../../apps/api/src/modules/marketplace/application/use-cases/process-scheduled-transfers.use-case.ts#L60>)<br>[apps/api/src/modules/marketplace/infrastructure/jobs/process-transfers.job.ts:1](<../../../../../apps/api/src/modules/marketplace/infrastructure/jobs/process-transfers.job.ts#L1>) |
| ISSUE | Job marcava transferência como realizada sem provedor |
| EVIDENCE | O código atual busca repasses vencidos, registra `marketplace_payout_blocked` e retorna `transfersExecuted: 0`; não chama update de settlement nessa etapa. O agendamento após a janela de devolução segue condicionado por status e pela data calculada. |
| VERIFICATION | Build da API e verificação direta de dois repasses vencidos confirmaram zero escrita e zero transferências executadas. Integração com PostgreSQL e provedor continua não executada. |
| PRODUCTION IMPACT | Corrigido o estado financeiro falso: dashboard e ledger não passam a afirmar pagamento sem evidência externa. O saldo permanece pendente, portanto payout real não está disponível. |
| ROOT CAUSE | Máquina de estados local tratada como prova de liquidação financeira. |
| RECOMMENDED FIX | Implementar port de payout com idempotência, intenção durável e conciliação; só então confirmar `transferred` com ID verificado do provedor. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES para liberar payout de marketplace; NO para impedir a conclusão financeira falsa. |
| CRITÉRIO DE ACEITE | Parcialmente atendido: não há `transferred` sem evidência do provedor. Falta implementar e provar, em falha/reinício, uma única transferência externa reconciliada. |

Decisão: manter o fail-closed; bloquear a liberação de payout até cumprir o critério de aceite com provedor.

<a id="api-040"></a>

## API-040 — Fila de catálogo perde identidade e ordenação de evento

| Campo | Registro |
| --- | --- |
| ID | API-040 |
| SEVERITY | P2 |
| MODULE | marketplace |
| FILE(S) | [apps/api/src/modules/marketplace/application/handlers/marketplace-catalog-sync.handler.ts:16](<../../../../../apps/api/src/modules/marketplace/application/handlers/marketplace-catalog-sync.handler.ts#L16>)<br>[apps/api/src/modules/marketplace/application/handlers/marketplace-catalog-sync.handler.ts:83](<../../../../../apps/api/src/modules/marketplace/application/handlers/marketplace-catalog-sync.handler.ts#L83>) |
| ISSUE | Fila de catálogo perdia identidade e ordenação de evento |
| EVIDENCE | Correção em `master`: jobs levam `eventId`/schemaVersion, usam job ID deduplicável e `redisConnection` preserva TLS de `rediss`. Consumidores relêem o produto do catálogo e não aplicam o payload potencialmente obsoleto. |
| VERIFICATION | Build da API e verificação direta de delete seguido de upsert obsoleto, delete obsoleto após reativação, job ID e parsing `rediss` passaram. Redis com certificado real permanece UNVERIFIED. |
| PRODUCTION IMPACT | O replay concorrente converge para o estado canônico atual, sem recriar exclusão por payload antigo; duplicatas de delete também não falham. |
| ROOT CAUSE | Transporte usado como garantia implícita de ordenação/identidade; parsing parcial da conexão. |
| RECOMMENDED FIX | Implementado para identidade, convergência e TLS. Adotar outbox transacional para eliminar a janela entre mutação do catálogo e publicação, e testar Redis TLS no ambiente de deploy. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | NO |
| CRITÉRIO DE ACEITE | Primeiro cenário atendido por verificação direta. Falta validar conexão `rediss` com certificado válido/inválido e entrega durável em queda do processo. |

Decisão: implementação local concluída para identidade, convergência e parsing TLS; acompanhar o risco residual de publicação sem outbox e do ambiente Redis.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
