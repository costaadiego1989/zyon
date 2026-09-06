# ADR — API / operations

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Pedidos, expedição, cancelamento e comandos operacionais de loja.

Inventário: 9 arquivos de implementação, 2 arquivos reconhecidos como testes, 1865 linhas de implementação. 12 declarações HTTP; 12 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **checkout, commerce, integrations**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `buyerPurchaseRecord`, `checkoutSession`, `completedOrder`, `paymentIntent`, `shipment`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Cancelamento local/external é inconsistente após falha; processamento manual precisa auditar autorização, motivo e idempotência. Integração por webhook não equivale a recuperação interna do comando.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 6/10 | 4/10 | 5/10 | 5/10 | 2/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Controladores derivam principal de tenant e casos de uso encapsulam comandos de order.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| OrdersController | 307 | 6 | [apps/api/src/modules/operations/presentation/http/operations.controller.ts:59](<../../../../../apps/api/src/modules/operations/presentation/http/operations.controller.ts#L59>) |
| PrismaOperationsReadRepository | 225 | 1 | [apps/api/src/modules/operations/infrastructure/prisma-operations-read.repository.ts:15](<../../../../../apps/api/src/modules/operations/infrastructure/prisma-operations-read.repository.ts#L15>) |
| CancelOrderUseCase | 122 | 4 | [apps/api/src/modules/operations/application/order-command.use-cases.ts:29](<../../../../../apps/api/src/modules/operations/application/order-command.use-cases.ts#L29>) |

Há candidato a concentração de responsabilidades. Separar protocolo HTTP, política de negócio e coordenação de efeitos em etapas pequenas; tamanho é sinal de revisão, não defeito por si só.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-022](<ADR-api-operations.md#api-022>) (P1): Cancelamento local pode encerrar antes do cancelamento externo.
- [API-023](<ADR-api-shipping.md#api-023>) (P1): Compra de etiqueta precede validação do pedido.
- [API-028](<ADR-api-audit.md#api-028>) (P2): Trilha de auditoria é gravada fora do commit da mutação.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Pedido próprio/alheio, state machine, cancelamento/refund/label com falha de provedor e retry.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /orders | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/operations/presentation/http/operations.controller.ts:75](<../../../../../apps/api/src/modules/operations/presentation/http/operations.controller.ts#L75>) |
| POST /orders | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/operations/presentation/http/operations.controller.ts:112](<../../../../../apps/api/src/modules/operations/presentation/http/operations.controller.ts#L112>) |
| GET /orders/:orderId | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/operations/presentation/http/operations.controller.ts:150](<../../../../../apps/api/src/modules/operations/presentation/http/operations.controller.ts#L150>) |
| POST /orders/:orderId/cancel | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/operations/presentation/http/operations.controller.ts:174](<../../../../../apps/api/src/modules/operations/presentation/http/operations.controller.ts#L174>) |
| PUT /orders/:orderId/status | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/operations/presentation/http/operations.controller.ts:214](<../../../../../apps/api/src/modules/operations/presentation/http/operations.controller.ts#L214>) |
| GET /orders/:orderId/timeline | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/operations/presentation/http/operations.controller.ts:251](<../../../../../apps/api/src/modules/operations/presentation/http/operations.controller.ts#L251>) |
| GET /orders/:orderId/tracking | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/operations/presentation/http/operations.controller.ts:274](<../../../../../apps/api/src/modules/operations/presentation/http/operations.controller.ts#L274>) |
| PUT /orders/:orderId/tracking | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/operations/presentation/http/operations.controller.ts:309](<../../../../../apps/api/src/modules/operations/presentation/http/operations.controller.ts#L309>) |
| GET /customers | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/operations/presentation/http/operations.controller.ts:379](<../../../../../apps/api/src/modules/operations/presentation/http/operations.controller.ts#L379>) |
| GET /customers/:customerId | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/operations/presentation/http/operations.controller.ts:412](<../../../../../apps/api/src/modules/operations/presentation/http/operations.controller.ts#L412>) |
| GET /payments | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/operations/presentation/http/operations.controller.ts:448](<../../../../../apps/api/src/modules/operations/presentation/http/operations.controller.ts#L448>) |
| GET /payments/:paymentId | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/operations/presentation/http/operations.controller.ts:481](<../../../../../apps/api/src/modules/operations/presentation/http/operations.controller.ts#L481>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-022"></a>

## API-022 — Cancelamento local pode encerrar antes do cancelamento externo

| Campo | Registro |
| --- | --- |
| ID | API-022 |
| SEVERITY | P1 |
| MODULE | operations |
| FILE(S) | [apps/api/src/modules/operations/application/order-command.use-cases.ts:50](<../../../../../apps/api/src/modules/operations/application/order-command.use-cases.ts#L50>) |
| ISSUE | Cancelamento local pode encerrar antes do cancelamento externo |
| EVIDENCE | Cancelamento salva estado local antes de chamar provedor. Falha externa publica order.cancellation_provider_failed; repetição encontra cancelled e retorna antecipadamente. Não foi localizado consumidor que retome o comando. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Pedido parece cancelado, mas o provedor pode continuar cobrando/processando; retry da mesma ação não repara a divergência. |
| ROOT CAUSE | Estado final publicado antes de confirmar efeito externo e ausência de recuperação específica. |
| RECOMMENDED FIX | Introduzir cancellation_pending e comando durável; concluir após confirmação ou conciliação, preservando chave de idempotência. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Falhar o provedor após update local e reiniciar: cancelamento deve continuar pendente e ser retomado sem duplicar reembolso. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
