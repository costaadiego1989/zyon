# ADR — Storefront: prontidão e consumo da API

Data: 2026-09-05. Status: auditoria registrada; correções propostas. Veredito: **FAIL / NO-GO**.

[Índice geral](<../README.md>) · [API primeiro](<../api/README.md>) · [Validação](<../VALIDACAO.md>)

## Escopo e controles existentes

Jornada pública Next: SSR por slug, catálogo, conversas, buyer auth, carrinho, marketplace, suporte, consentimento e redirect para checkout.

SSR usa cache no-store; carrinho salvo possui chave por merchant; redirect envia referência de carrinho e token embed. Há headers de CSP/referrer no Next, sem comprovação de implantação.

Este relatório verifica integração e comportamento implementado, não é uma aprovação visual/acessibilidade do produto em navegador. Layout responsivo, leitores de tela e testes em dispositivos permanecem UNVERIFIED.

## ADRs por módulo do front

| Módulo | Call sites no agrupamento | Achados relacionados |
| --- | --- | --- |
| [sessao-e-proxy](<modulos/ADR-storefront-sessao-e-proxy.md>) | 6 | [API-044](<../api/ADR-api-embed.md#api-044>), [SF-006](<ADR-storefront.md#sf-006>), [API-005](<../api/ADR-api-storefront.md#api-005>) |
| [catalogo](<modulos/ADR-storefront-catalogo.md>) | 14 | [SF-001](<ADR-storefront.md#sf-001>), [API-003](<../api/ADR-api-stories.md#api-003>) |
| [carrinho](<modulos/ADR-storefront-carrinho.md>) | 14 | [SF-002](<ADR-storefront.md#sf-002>), [SF-003](<ADR-storefront.md#sf-003>), [API-005](<../api/ADR-api-storefront.md#api-005>) |
| [marketplace](<modulos/ADR-storefront-marketplace.md>) | 15 | [SF-004](<ADR-storefront.md#sf-004>), [API-006](<../api/ADR-api-marketplace.md#api-006>) |
| [comprador](<modulos/ADR-storefront-comprador.md>) | 15 | [SF-005](<ADR-storefront.md#sf-005>), [API-042](<../api/ADR-api-checkout.md#api-042>), [API-020](<../api/ADR-api-intent-memory.md#api-020>) |
| [conversa](<modulos/ADR-storefront-conversa.md>) | 2 | [API-004](<../api/ADR-api-storefront.md#api-004>), [API-042](<../api/ADR-api-checkout.md#api-042>), [SF-007](<ADR-storefront.md#sf-007>) |
| [checkout](<modulos/ADR-storefront-checkout.md>) | 1 | [W2-001](<../widget_v2/ADR-widget_v2.md#w2-001>), [API-044](<../api/ADR-api-embed.md#api-044>), [API-043](<../api/ADR-api-checkout.md#api-043>) |
| [suporte](<modulos/ADR-storefront-suporte.md>) | 3 | [API-041](<../api/ADR-api-support.md#api-041>), [W2-009](<../widget_v2/ADR-widget_v2.md#w2-009>) |
| [telemetria](<modulos/ADR-storefront-telemetria.md>) | 0 | [API-034](<../api/ADR-api-revenue-lift.md#api-034>), [W2-008](<../widget_v2/ADR-widget_v2.md#w2-008>) |

Agrupamentos do storefront/widget podem compartilhar o mesmo client, portanto contagens por módulo não devem ser somadas. Inventário único do app: 44 chamadas extraídas.

## Decisão

Compra anônima e buyer autenticado em duas lojas, preços altos, reload, falha de API e navegação até widget/pós-venda.

O contrato deve definir URL/método, principal, tenant/session, DTO, envelope, unidades, estados e idempotência. Manter fixtures derivadas de respostas reais e smoke sobre a composição production, incluindo ENABLE_LEGACY_ROUTES desligado.

<a id="sf-001"></a>

## SF-001 — Paginação do catálogo público usa endpoint administrativo

| Campo | Registro |
| --- | --- |
| ID | SF-001 |
| SEVERITY | P1 |
| MODULE | storefront |
| FILE(S) | [apps/storefront/src/lib/api/api-client.ts:68](<../../../../../apps/storefront/src/lib/api/api-client.ts#L68>)<br>[apps/storefront/src/components/blocks/ProductCarouselBlock.tsx:31](<../../../../../apps/storefront/src/components/blocks/ProductCarouselBlock.tsx#L31>)<br>[apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:1](<../../../../../apps/api/src/modules/catalog/presentation/http/catalog.controller.ts#L1>) |
| ISSUE | Paginação do catálogo público usa endpoint administrativo |
| EVIDENCE | productsApi.list/get chama /merchants/:id/products com credentials include. Esses endpoints pertencem ao catálogo administrativo protegido; comprador comum não tem cookie merchant. ProductCarouselBlock usa list para carregar a próxima página. O envelope products/nextCursor existe e o componente adapta variantes; o bloqueio confirmado é a credencial. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Paginação do carrossel falha para visitante sem sessão merchant, mesmo que a primeira página recebida na conversa apareça. Não se deve resolver isso entregando cookie/chave administrativa ao browser. |
| ROOT CAUSE | Cliente público reutiliza contrato e credencial de administração. |
| RECOMMENDED FIX | Usar catálogo público com escopo/DTO próprios e adaptar preços, variantes e paginação a uma resposta tipada. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Navegador sem sessão de lojista lista apenas produtos públicos da loja e escolhe variante válida sem acessar campos administrativos. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="sf-002"></a>

## SF-002 — Carrinho mistura alterações locais e chamadas incompletas

| Campo | Registro |
| --- | --- |
| ID | SF-002 |
| SEVERITY | P1 |
| MODULE | storefront |
| FILE(S) | [apps/storefront/src/lib/api/api-client.ts:192](<../../../../../apps/storefront/src/lib/api/api-client.ts#L192>)<br>[apps/storefront/src/lib/viewmodels/useConversationViewModel.ts:350](<../../../../../apps/storefront/src/lib/viewmodels/useConversationViewModel.ts#L350>)<br>[apps/storefront/src/lib/cart-store.tsx:192](<../../../../../apps/storefront/src/lib/cart-store.tsx#L192>)<br>[apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:281](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L281>) |
| ISSUE | Carrinho mistura alterações locais e chamadas incompletas |
| EVIDENCE | cartApi.updateItem ignora _merchantId, não envia query obrigatória e usa DELETE para quantidade zero; backend tem PATCH que exige merchantId e aceita zero. CartProvider.updateItemQuantity altera apenas estado local. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Tela pode mostrar quantidade/remover item que não foi persistido; requisição PATCH retorna 400 e DELETE não corresponde ao handler. Pagamento pode usar carrinho divergente. |
| ROOT CAUSE | Múltiplas fontes de estado e erro de contrato na sincronização. |
| RECOMMENDED FIX | Centralizar mutação em client tipado, usar resposta autoritativa e rollback/erro visível; invalidar frete/oferta/intent após mudança. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Aumentar/reduzir/remover item, recarregar e pagar mantém quantidades e total do servidor. Falha de rede não aparenta sucesso. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="sf-003"></a>

## SF-003 — Heurísticas de centavos alteram preços legítimos

| Campo | Registro |
| --- | --- |
| ID | SF-003 |
| SEVERITY | P1 |
| MODULE | storefront |
| FILE(S) | [apps/storefront/src/lib/cart-store.tsx:159](<../../../../../apps/storefront/src/lib/cart-store.tsx#L159>)<br>[apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:265](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L265>) |
| ISSUE | Heurísticas de centavos alteram preços legítimos |
| EVIDENCE | subtotal > 1000 é dividido por 100 e total > 10000 também; o endpoint entrega price/subtotal/total em reais. Portanto subtotal de R$1500 pode virar R$15 e total de R$15000 pode virar R$150. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Comprador vê valor diferente do cobrado, sobretudo em tickets altos. |
| ROOT CAUSE | Unidade monetária inferida pela magnitude em vez de definida no DTO. |
| RECOMMENDED FIX | Escolher centavos inteiros ou money tipado no contrato e fazer uma conversão explícita na apresentação, sem thresholds. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Casos R$0,01, R$999,99, R$1000, R$1500 e R$15000 mantêm valor exato no card, carrinho e pagamento. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="sf-004"></a>

## SF-004 — Busca marketplace envia query e interpreta envelope errados

| Campo | Registro |
| --- | --- |
| ID | SF-004 |
| SEVERITY | P1 |
| MODULE | storefront |
| FILE(S) | [apps/storefront/src/lib/api/api-client.ts:121](<../../../../../apps/storefront/src/lib/api/api-client.ts#L121>)<br>[apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:309](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L309>) |
| ISSUE | Busca marketplace envia query e interpreta envelope errados |
| EVIDENCE | Front envia q e lê result.items; endpoint exige query e merchantId e retorna products. list faz GET marketplace/items, enquanto controller declara POST para inclusão. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Busca pode parecer sem resultados mesmo com catálogo disponível; list retorna 404. |
| ROOT CAUSE | Uso de interface presumida em lugar do contrato real do marketplace. |
| RECOMMENDED FIX | Alinhar query/tenant/paginação/envelope e distinguir pesquisa de inserção; tratar erro como falha de serviço em vez de lista vazia. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Busca por produto indexado retorna o item correto para host autorizado; ausência real e erro HTTP têm estados distintos. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="sf-005"></a>

## SF-005 — Devolução do comprador chama controller não montado

| Campo | Registro |
| --- | --- |
| ID | SF-005 |
| SEVERITY | P1 |
| MODULE | storefront |
| FILE(S) | [apps/storefront/src/components/ReturnRequestForm.tsx:57](<../../../../../apps/storefront/src/components/ReturnRequestForm.tsx#L57>)<br>[apps/api/src/modules/returns/presentation/http/buyer-returns.controller.ts:1](<../../../../../apps/api/src/modules/returns/presentation/http/buyer-returns.controller.ts#L1>) |
| ISSUE | Devolução do comprador chama controller não montado |
| EVIDENCE | BuyerReturnsController declara /buyer/returns/request, mas não está em controllers da composição. Form envia variantId="all" e lê zyon_buyer_token, diferente do armazenamento de sessão usado por BuyerHub/registro. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Comprador não abre devolução válida; simplesmente montar o controller ainda exige corrigir identificação de item e principal buyer. |
| ROOT CAUSE | Fluxo de pós-venda não foi integrado de ponta a ponta. |
| RECOMMENDED FIX | Unificar sessão buyer e contrato de return com itens reais do pedido; montar controller somente após autorização de order ownership e ajuste de guard. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Buyer autenticado seleciona item comprado e abre devolução; outro buyer não acessa pedido; token expirado e pedido inexistente são tratados. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="sf-006"></a>

## SF-006 — Proxy /api/v1 troca credenciais de buyer/embed por chave de serviço

| Campo | Registro |
| --- | --- |
| ID | SF-006 |
| SEVERITY | P1 |
| MODULE | storefront |
| FILE(S) | [apps/storefront/src/app/api/v1/[...path]/route.ts:65](<../../../../../apps/storefront/src/app/api/v1/[...path]/route.ts#L65>) |
| ISSUE | Proxy /api/v1 troca credenciais de buyer/embed por chave de serviço |
| EVIDENCE | Proxy permite prefixos buyer/embed, mas descarta Authorization/Cookie/Origin recebidos e envia AACP_SERVICE_API_KEY como Bearer. Também não devolve Set-Cookie. |
| VERIFICATION | CONFIRMED_STATIC; uso efetivo do proxy UNVERIFIED |
| PRODUCTION IMPACT | Consumidores desse proxy não conseguem manter autenticação buyer/embed conforme o contrato; chave de um merchant não pode representar compradores de múltiplas lojas. |
| ROOT CAUSE | Proxy mistura identidade de serviço e sessão de usuário. Clientes principais ainda chamam API diretamente; alcance efetivo deste proxy deve ser medido. |
| RECOMMENDED FIX | Definir BFF com rotas explícitas, propagar credenciais/origem aprovadas ou executar fluxo de serviço específico por tenant; não usar uma chave global como identidade buyer. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | No proxy, buyer A e embed B preservam escopo correto; refresh/cookies e origem funcionam sem expor chave de serviço. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="sf-007"></a>

## SF-007 — Adapter de orçamento descarta dados e abre conversa

| Campo | Registro |
| --- | --- |
| ID | SF-007 |
| SEVERITY | P2 |
| MODULE | storefront |
| FILE(S) | [apps/storefront/src/lib/storefront-api.ts:8](<../../../../../apps/storefront/src/lib/storefront-api.ts#L8>)<br>[apps/storefront/src/lib/api/api-client.ts:147](<../../../../../apps/storefront/src/lib/api/api-client.ts#L147>)<br>[apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:365](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L365>) |
| ISSUE | Adapter de orçamento descarta dados e abre conversa |
| EVIDENCE | postStorefrontBudgetRequest encaminha somente merchantId/items para checkoutApi.create (POST conversations), descartando nome/email/telefone/total/note. A rota real é budget-requests. Não foi encontrado consumidor ativo desse wrapper no src. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Se usado, o formulário não gera orçamento e perde contato do interessado. É lacuna latente, não prova de falha de uma tela ativa. |
| ROOT CAUSE | Adapter renomeado sem preservar semântica do comando. |
| RECOMMENDED FIX | Implementar contrato de orçamento autorizado, validar itens/contato e remover wrapper morto se a funcionalidade não for suportada. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | NO |
| CRITÉRIO DE ACEITE | Teste do consumidor comprova criação e consulta de orçamento com campos corretos; nenhuma conversa substitui silenciosamente o orçamento. |

Decisão: registrar correção priorizada e acompanhar o risco residual. Correção ainda não implementada nesta auditoria.


## Dependências para produção

As correções de segurança e dinheiro da API precedem o aceite dos fronts. Não há prova de E2E browser, providers reais ou deployment; os resultados de tipo/teste e reproduções estão em [Validação](<../VALIDACAO.md>).
