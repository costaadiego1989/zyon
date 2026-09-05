# ADR — API / returns

> Implementação posterior na branch `fix/ready-to-prod-audit`: consultar [correções, evidências e pendências](../CORRECOES.md). O conteúdo abaixo preserva o retrato da auditoria original; o gate de produção continua aberto.


Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Solicitação, recebimento, inspeção, estorno e reposição de devolução.

Inventário: 17 arquivos de implementação, 0 arquivos reconhecidos como testes, 951 linhas de implementação. 11 declarações HTTP; 9 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, self-checkout**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `productStock`, `return`, `returnInspection`, `returnLabel`, `returnRefund`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Estorno fictício e sem testes no módulo; buyer controller não está montado. Pedido original e itens devolvidos precisam ser fonte do valor e autorização, inclusive estorno parcial.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 6/10 | 4/10 | 4/10 | 4/10 | 1/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Entidade impõe estágios/canRefund/canCancel e listagem merchant existe.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| PrismaReturnRepository | 210 | 1 | [apps/api/src/modules/returns/infrastructure/repositories/prisma-return.repository.ts:20](<../../../../../apps/api/src/modules/returns/infrastructure/repositories/prisma-return.repository.ts#L20>) |
| ReturnsController | 106 | 8 | [apps/api/src/modules/returns/presentation/http/returns.controller.ts:15](<../../../../../apps/api/src/modules/returns/presentation/http/returns.controller.ts#L15>) |
| ReturnEntity | 58 | 1 | [apps/api/src/modules/returns/domain/entities/return.entity.ts:77](<../../../../../apps/api/src/modules/returns/domain/entities/return.entity.ts#L77>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-007](<ADR-api-returns.md#api-007>) (P0): Reembolso é declarado concluído sem devolver dinheiro.
- [DASH-003](<../dashboard/ADR-dashboard.md#dash-003>) (P1): Ações de devolução usam nomes de rotas divergentes.
- [SF-005](<../storefront/ADR-storefront.md#sf-005>) (P1): Devolução do comprador chama controller não montado.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Teste completo pós-venda com provedor sandbox, order ownership, itens reais, replay e concorrência refund/restock.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| POST /buyer/returns/request | Não montada | UseGuards(BuyerAuthGuard) | [apps/api/src/modules/returns/presentation/http/buyer-returns.controller.ts:15](<../../../../../apps/api/src/modules/returns/presentation/http/buyer-returns.controller.ts#L15>) |
| GET /buyer/returns | Não montada | UseGuards(BuyerAuthGuard) | [apps/api/src/modules/returns/presentation/http/buyer-returns.controller.ts:45](<../../../../../apps/api/src/modules/returns/presentation/http/buyer-returns.controller.ts#L45>) |
| POST /merchants/:mid/returns | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/returns/presentation/http/returns.controller.ts:29](<../../../../../apps/api/src/modules/returns/presentation/http/returns.controller.ts#L29>) |
| GET /merchants/:mid/returns | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/returns/presentation/http/returns.controller.ts:51](<../../../../../apps/api/src/modules/returns/presentation/http/returns.controller.ts#L51>) |
| GET /merchants/:mid/returns/:rid | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/returns/presentation/http/returns.controller.ts:67](<../../../../../apps/api/src/modules/returns/presentation/http/returns.controller.ts#L67>) |
| POST /merchants/:mid/returns/:rid/label | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/returns/presentation/http/returns.controller.ts:75](<../../../../../apps/api/src/modules/returns/presentation/http/returns.controller.ts#L75>) |
| POST /merchants/:mid/returns/:rid/receive | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/returns/presentation/http/returns.controller.ts:81](<../../../../../apps/api/src/modules/returns/presentation/http/returns.controller.ts#L81>) |
| POST /merchants/:mid/returns/:rid/inspect | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/returns/presentation/http/returns.controller.ts:87](<../../../../../apps/api/src/modules/returns/presentation/http/returns.controller.ts#L87>) |
| POST /merchants/:mid/returns/:rid/refund | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/returns/presentation/http/returns.controller.ts:97](<../../../../../apps/api/src/modules/returns/presentation/http/returns.controller.ts#L97>) |
| POST /merchants/:mid/returns/:rid/restock | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/returns/presentation/http/returns.controller.ts:103](<../../../../../apps/api/src/modules/returns/presentation/http/returns.controller.ts#L103>) |
| PUT /merchants/:mid/returns/:rid/cancel | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/returns/presentation/http/returns.controller.ts:109](<../../../../../apps/api/src/modules/returns/presentation/http/returns.controller.ts#L109>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-007"></a>

## API-007 — Reembolso é declarado concluído sem devolver dinheiro

| Campo | Registro |
| --- | --- |
| ID | API-007 |
| SEVERITY | P0 |
| MODULE | returns |
| FILE(S) | [apps/api/src/modules/returns/application/use-cases/process-refund.use-case.ts:18](<../../../../../apps/api/src/modules/returns/application/use-cases/process-refund.use-case.ts#L18>)<br>[apps/api/src/modules/returns/presentation/http/returns.controller.ts:97](<../../../../../apps/api/src/modules/returns/presentation/http/returns.controller.ts#L97>) |
| ISSUE | Reembolso é declarado concluído sem devolver dinheiro |
| EVIDENCE | ProcessRefundUseCase calcula quantity * 1000, salva refund COMPLETED e RETURN REFUND_COMPLETED sem chamar provedor. R06 executou o use case com repositório falso: três itens viraram 3000 centavos e status concluído. |
| VERIFICATION | REPRODUCED_LOCAL R06 |
| PRODUCTION IMPACT | Operação financeira informa sucesso falso e usa valor sem relação com o pedido pago. |
| ROOT CAUSE | Stub de MVP permaneceu no caminho de produção. |
| RECOMMENDED FIX | Calcular saldo reembolsável a partir do pedido/payment ledger; registrar intenção e chave idempotente, chamar provedor e concluir apenas após confirmação conciliável. Desabilitar a ação até existir esse fluxo. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Testar estorno parcial/integral, retry, timeout após sucesso, chargeback prévio e duplicidade. Status COMPLETED precisa de providerRefundId e valor confirmado. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
