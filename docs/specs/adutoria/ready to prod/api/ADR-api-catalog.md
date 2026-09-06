# ADR — API / catalog

> Implementação posterior integrada na `master`: consultar [correções, evidências e pendências](../CORRECOES.md). O conteúdo abaixo preserva o retrato da auditoria original; o gate de produção continua aberto.


Data: 2026-09-05. Status: decisão de auditoria registrada; atualização de implementação em 2026-09-06. Veredito: **FAIL** até executar o gate PostgreSQL concorrente.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Catálogo próprio, variantes, mídia, categorias e reserva de estoque.

Inventário: 39 arquivos de implementação, 6 arquivos reconhecidos como testes, 3284 linhas de implementação. 19 declarações HTTP; 19 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, checkout, commerce, cross-sell, embed, experiments, integrations, merchant**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `crossSellPromotion`, `product`, `productCategory`, `productMedia`, `productPrice`, `productStock`, `productVariant`, `stockReservation`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Controller concentra catálogo/estoque/upload. Modelos relacionais não cobertos pelo middleware global exigem ownership explícito. Reserva tem race e mídia ignora tenant.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 5/10 | 4/10 | 3/10 | 2/10 | 1/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Listagem e parte das mutações usam merchantId; guard administrativo e validação de plano existem.

## Atualização pós-auditoria — 2026-09-06

O snapshot original abaixo foi corrigido no código atual: a reserva trava a variante, confirma `variant → product → merchant` antes de qualquer retry, vincula a reserva ao estoque escolhido e faz transições condicionais para confirmar e expirar. Upload, remoção de mídia e alteração de variante também filtram o merchant proprietário. O teste de integração `prisma-stock.repository.integration.spec.ts` cobre duas lojas, retries concorrentes, expiração e invariantes, mas requer PostgreSQL descartável configurado e portanto não foi certificado nesta execução local.

O commit `64bf5b9` estende a mesma fronteira ao HTTP: produtos/estoque, promoções e importação de planilha agora exigem que `:mid` corresponda ao tenant do JWT. O build completo da API passou. API-001 e API-002 deixam de ser pendências de implementação, mas só podem ser fechados após o gate de banco real descrito no critério de aceite.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| StoreBuilderCatalogController | 395 | 15 | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:22](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L22>) |
| PrismaProductRepository | 273 | 1 | [apps/api/src/modules/catalog/infrastructure/repositories/prisma-product.repository.ts:11](<../../../../../apps/api/src/modules/catalog/infrastructure/repositories/prisma-product.repository.ts#L11>) |
| CatalogCacheService | 186 | 1 | [apps/api/src/modules/catalog/infrastructure/cache/catalog-cache.service.ts:35](<../../../../../apps/api/src/modules/catalog/infrastructure/cache/catalog-cache.service.ts#L35>) |

Há candidato a concentração de responsabilidades. Separar protocolo HTTP, política de negócio e coordenação de efeitos em etapas pequenas; tamanho é sinal de revisão, não defeito por si só.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-001](<ADR-api-catalog.md#api-001>) (P0): Reserva e mídia permitem operar recursos de outra loja.
- [API-002](<ADR-api-catalog.md#api-002>) (P0): Reserva concorrente pode ultrapassar estoque disponível.
- [SF-001](<../storefront/ADR-storefront.md#sf-001>) (P1): Paginação do catálogo público usa endpoint administrativo.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Testes adversariais de duas lojas, estoque concorrente por depósito, upload e catálogo público.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| POST /merchants/:mid/products | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:43](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L43>) |
| GET /merchants/:mid/products | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:84](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L84>) |
| GET /merchants/:mid/products/:pid | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:106](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L106>) |
| PUT /merchants/:mid/products/:pid | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:115](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L115>) |
| PUT /merchants/:mid/products/:pid/variants/:vid | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:155](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L155>) |
| DELETE /merchants/:mid/products/:pid | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:201](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L201>) |
| POST /merchants/:mid/stock/reserve | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:211](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L211>) |
| POST /merchants/:mid/stock/confirm | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:226](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L226>) |
| GET /merchants/:mid/categories | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:238](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L238>) |
| POST /merchants/:mid/categories | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:244](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L244>) |
| PUT /merchants/:mid/categories/:cid | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:259](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L259>) |
| DELETE /merchants/:mid/categories/:cid | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:288](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L288>) |
| PATCH /merchants/:mid/categories/reorder | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:298](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L298>) |
| POST /merchants/:mid/products/media | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:310](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L310>) |
| DELETE /merchants/:mid/products/media/:mediaId | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:331](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L331>) |
| POST /merchants/:mid/products/:pid/generate-seo | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:341](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L341>) |
| POST /merchants/:mid/products/generate-description | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:351](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L351>) |
| GET /embed/catalog/search | Alcançável estaticamente | UseGuards(EmbedAuthGuard) | [apps/api/src/modules/catalog/presentation/http/widget-catalog.controller.ts:16](<../../../../../apps/api/src/modules/catalog/presentation/http/widget-catalog.controller.ts#L16>) |
| POST /embed/catalog/add | Alcançável estaticamente | UseGuards(EmbedAuthGuard) | [apps/api/src/modules/catalog/presentation/http/widget-catalog.controller.ts:29](<../../../../../apps/api/src/modules/catalog/presentation/http/widget-catalog.controller.ts#L29>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-001"></a>

## API-001 — Reserva e mídia permitem operar recursos de outra loja

| Campo | Registro |
| --- | --- |
| ID | API-001 |
| SEVERITY | P0 |
| MODULE | catalog |
| FILE(S) | [apps/api/src/modules/catalog/infrastructure/repositories/prisma-stock.repository.ts:11](<../../../../../apps/api/src/modules/catalog/infrastructure/repositories/prisma-stock.repository.ts#L11>)<br>[apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:310](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L310>)<br>[apps/api/src/shared/persistence/tenant.middleware.ts:1](<../../../../../apps/api/src/shared/persistence/tenant.middleware.ts#L1>) |
| ISSUE | Reserva e mídia permitem operar recursos de outra loja |
| EVIDENCE | reserve() recebe merchantId, mas consulta variantId/cartId e productStock sem verificar o proprietário. Upload associa body.variantId sem conferir a loja; delete de mídia usa somente id. Esses modelos não estão cobertos pelo middleware de tenant. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Com IDs conhecidos, uma conta da loja A pode reservar estoque ou excluir mídia da loja B. A autenticação do merchant no caminho não valida o recurso referenciado. |
| ROOT CAUSE | Escopo do tenant aplicado ao controller, sem predicado de ownership no repositório e nas relações. |
| RECOMMENDED FIX | Exigir merchantId em cada operação e validar variante → produto → merchant no mesmo limite transacional; aplicar o mesmo controle à mídia e sua exclusão. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Duas lojas: reservar variante, anexar mídia e excluir mídia alheias deve retornar 403/404 sem alterar nenhuma linha. Repetir usando todos os aliases HTTP. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="api-002"></a>

## API-002 — Reserva concorrente pode ultrapassar estoque disponível

| Campo | Registro |
| --- | --- |
| ID | API-002 |
| SEVERITY | P0 |
| MODULE | catalog |
| FILE(S) | [apps/api/src/modules/catalog/infrastructure/repositories/prisma-stock.repository.ts:24](<../../../../../apps/api/src/modules/catalog/infrastructure/repositories/prisma-stock.repository.ts#L24>)<br>[apps/api/src/modules/catalog/infrastructure/repositories/prisma-stock.repository.ts:69](<../../../../../apps/api/src/modules/catalog/infrastructure/repositories/prisma-stock.repository.ts#L69>) |
| ISSUE | Reserva concorrente pode ultrapassar estoque disponível |
| EVIDENCE | A condição do updateMany é quantity >= stock.reserved + input.quantity, usando reserved lido antes. Com quantity=1 e duas leituras reserved=0, ambas as atualizações podem incrementar reserved. Confirmação e expiração leem ACTIVE sem transição condicional e atualizam todos os estoques da variante. |
| VERIFICATION | CONFIRMED_STATIC; concorrência PostgreSQL UNVERIFIED |
| PRODUCTION IMPACT | Overselling, reserved negativo e baixa duplicada sob concorrência, múltiplos depósitos ou execução paralela do job. |
| ROOT CAUSE | Check-then-act com valor antigo; ausência de CAS/lock sobre reserva e ausência de vínculo da reserva ao registro de estoque específico. |
| RECOMMENDED FIX | Fazer reserva por update condicional que compare valores atuais, ou lock explícito; persistir stockId/locationId, transicionar ACTIVE por CAS e manter reserva/baixa no mesmo commit. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Em PostgreSQL, disparar 100 reservas para uma unidade: exatamente uma deve vencer. Competir confirm/expire/retry e provar conservation de quantity/reserved por depósito. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
