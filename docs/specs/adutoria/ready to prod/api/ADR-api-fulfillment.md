# ADR — API / fulfillment

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Shipment e eventos de rastreamento pós-venda.

Inventário: 16 arquivos de implementação, 10 arquivos reconhecidos como testes, 910 linhas de implementação. 1 declarações HTTP; 1 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Nenhum import intermodular TypeScript extraído neste diretório.

Acessos Prisma reconhecidos pelo extrator: `shipment`, `trackingEvent`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Evento/transição não são atômicos. Entrada legada de carrier depende de política NonProductionRoute; ativação não substitui autenticação do provedor.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 7/10 | 5/10 | 6/10 | 6/10 | 3/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Há entidade e repositório de shipment com escopo; consultas de rastreio validam merchant.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| PrismaShipmentRepository | 127 | 1 | [apps/api/src/modules/fulfillment/infrastructure/repositories/prisma-shipment.repository.ts:9](<../../../../../apps/api/src/modules/fulfillment/infrastructure/repositories/prisma-shipment.repository.ts#L9>) |
| RecordTrackingEventUseCase | 101 | 3 | [apps/api/src/modules/fulfillment/application/use-cases/record-tracking-event.use-case.ts:10](<../../../../../apps/api/src/modules/fulfillment/application/use-cases/record-tracking-event.use-case.ts#L10>) |
| InMemoryShipmentRepository | 63 | 0 | [apps/api/src/modules/fulfillment/infrastructure/repositories/in-memory-shipment.repository.ts:5](<../../../../../apps/api/src/modules/fulfillment/infrastructure/repositories/in-memory-shipment.repository.ts#L5>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-029](<ADR-api-fulfillment.md#api-029>) (P2): Tracking e evento não são atômicos.
- [API-005](<ADR-api-storefront.md#api-005>) (P0): Flag de legado expõe consultas e mutações administrativas sem autenticação.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Carrier assinado, eventos repetidos/fora de ordem, transição e notificação recuperáveis.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| POST /webhooks/tracking/:carrier | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/fulfillment/presentation/http/tracking-webhook.controller.ts:25](<../../../../../apps/api/src/modules/fulfillment/presentation/http/tracking-webhook.controller.ts#L25>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-029"></a>

## API-029 — Tracking e evento não são atômicos

| Campo | Registro |
| --- | --- |
| ID | API-029 |
| SEVERITY | P2 |
| MODULE | fulfillment |
| FILE(S) | [apps/api/src/modules/fulfillment/application/use-cases/record-tracking-event.use-case.ts:35](<../../../../../apps/api/src/modules/fulfillment/application/use-cases/record-tracking-event.use-case.ts#L35>) |
| ISSUE | Tracking e evento não são atômicos |
| EVIDENCE | Atualização de shipment, registro de tracking e publicação de evento são sequenciais. Se a falha ocorrer após novo status, replay pode sair por sameStatus e não emitir o evento perdido. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Status na tela e notificações/consumidores podem divergir após falha parcial. |
| ROOT CAUSE | Transição e outbox não compartilham unidade de trabalho. |
| RECOMMENDED FIX | Persistir evento do carrier, transição e outbox atomicamente com chave única; deduplicar por evento e não só igualdade de status. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | NO |
| CRITÉRIO DE ACEITE | Crash em cada gravação e eventos fora de ordem precisam convergir sem perder notificações nem regredir shipment. |

Decisão: registrar correção priorizada e acompanhar o risco residual. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
