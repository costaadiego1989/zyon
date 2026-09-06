# ADR — API / buyer-purchase-history

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Identidade local do buyer e histórico de compras por merchant.

Inventário: 16 arquivos de implementação, 5 arquivos reconhecidos como testes, 785 linhas de implementação. 1 declarações HTTP; 1 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, checkout**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `buyerIdentity`, `buyerPurchaseRecord`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Histórico completo é carregado/regravado em operações de compra, elevando custo com recorrência. Identidade para reconhecimento não pode ser tratada como autenticação.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 8/10 | 6/10 | 7/10 | 7/10 | 4/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Identidade é indexada por merchant+identityKey; histórico possui persistência e chave de compra que permitem dedup local.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| BuyerPurchaseHistoryEntity | 122 | 1 | [apps/api/src/modules/buyer-purchase-history/domain/entities/buyer-purchase-history.entity.ts:9](<../../../../../apps/api/src/modules/buyer-purchase-history/domain/entities/buyer-purchase-history.entity.ts#L9>) |
| PrismaBuyerPurchaseHistoryRepository | 64 | 1 | [apps/api/src/modules/buyer-purchase-history/infrastructure/prisma-buyer-purchase-history.repository.ts:12](<../../../../../apps/api/src/modules/buyer-purchase-history/infrastructure/prisma-buyer-purchase-history.repository.ts#L12>) |
| GetBuyerPurchaseContextUseCase | 60 | 3 | [apps/api/src/modules/buyer-purchase-history/application/buyer-purchase-history.use-cases.ts:68](<../../../../../apps/api/src/modules/buyer-purchase-history/application/buyer-purchase-history.use-cases.ts#L68>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-032](<ADR-api-buyer-purchase-history.md#api-032>) (P2): Histórico cresce sem limite nas leituras e saves.
- [API-042](<ADR-api-checkout.md#api-042>) (P0): E-mail conhecido é tratado como prova de identidade do comprador.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Paginação, unique merchant/order, perf com histórico grande e consistência após order.completed.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /buyer-purchase-history/global-users/:globalUserId/context | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/buyer-purchase-history/presentation/http/buyer-purchase-history.controller.ts:14](<../../../../../apps/api/src/modules/buyer-purchase-history/presentation/http/buyer-purchase-history.controller.ts#L14>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-032"></a>

## API-032 — Histórico cresce sem limite nas leituras e saves

| Campo | Registro |
| --- | --- |
| ID | API-032 |
| SEVERITY | P2 |
| MODULE | buyer-purchase-history |
| FILE(S) | [apps/api/src/modules/buyer-purchase-history/infrastructure/prisma-buyer-purchase-history.repository.ts:15](<../../../../../apps/api/src/modules/buyer-purchase-history/infrastructure/prisma-buyer-purchase-history.repository.ts#L15>) |
| ISSUE | Histórico cresce sem limite nas leituras e saves |
| EVIDENCE | getByBuyer carrega todas as compras; save percorre histórico para upserts. recordPurchase também recarrega histórico após inserir. |
| VERIFICATION | CONFIRMED_STATIC; REQUIRES LOAD VALIDATION |
| PRODUCTION IMPACT | Custo de I/O e memória cresce com o comprador; recorrência deixa o caminho de checkout progressivamente mais caro. |
| ROOT CAUSE | Agregado acumula histórico completo em operações que precisam de estatísticas ou uma compra. |
| RECOMMENDED FIX | Separar append idempotente, projeção resumida e consulta paginada por cursor; medir com buyer de histórico grande. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | NO |
| CRITÉRIO DE ACEITE | EXPLAIN e teste com 100 mil compras por buyer devem demonstrar leitura limitada e inserção sem regravar o histórico. |

Decisão: registrar correção priorizada e acompanhar o risco residual. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
