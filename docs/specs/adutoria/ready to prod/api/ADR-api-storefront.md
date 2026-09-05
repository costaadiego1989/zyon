# ADR — API / storefront

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Backend de catálogo público, conversa, carrinho, marketplace e orçamento.

Inventário: 30 arquivos de implementação, 1 arquivos reconhecidos como testes, 5967 linhas de implementação. 17 declarações HTTP; 17 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **buyer-account, catalog, checkout, coupons, marketplace, merchant, shipping, support**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `agentRule`, `budgetRequest`, `checkoutEvent`, `checkoutSession`, `checkoutSetting`, `federatedProduct`, `handlers`, `merchant`, `merchantRule`, `productVariant`, `promptExperiment`, `storefrontCart`, `storyCategory`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

StorefrontConversationAdapter tem cerca de 892 linhas e LangGraphAgent 727. Controller mistura público/admin, WebSocket sem autorização e rotas dependentes de legado. Estado público não pode confiar só em merchantId+cartId fornecidos.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 3/10 | 2/10 | 2/10 | 2/10 | 1/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Adaptadores separam parte de conversa/carrinho; tenant é passado a vários repositórios.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| StorefrontConversationAdapter | 892 | 7 | [apps/api/src/modules/storefront/infrastructure/adapters/storefront-conversation.adapter.ts:27](<../../../../../apps/api/src/modules/storefront/infrastructure/adapters/storefront-conversation.adapter.ts#L27>) |
| StorefrontLangGraphAgent | 727 | 1 | [apps/api/src/modules/storefront/infrastructure/agents/store-langgraph-agent.ts:101](<../../../../../apps/api/src/modules/storefront/infrastructure/agents/store-langgraph-agent.ts#L101>) |
| StorefrontController | 371 | 12 | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:29](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L29>) |

Há candidato a concentração de responsabilidades. Separar protocolo HTTP, política de negócio e coordenação de efeitos em etapas pequenas; tamanho é sinal de revisão, não defeito por si só.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-004](<ADR-api-storefront.md#api-004>) (P0): WebSocket aceita salas de conversa sem autenticação ou vínculo.
- [API-005](<ADR-api-storefront.md#api-005>) (P0): Flag de legado expõe consultas e mutações administrativas sem autenticação.
- [API-043](<ADR-api-checkout.md#api-043>) (P0): Preço e frete iniciais podem vir do cliente sem revalidação de catálogo.
- [SF-001](<../storefront/ADR-storefront.md#sf-001>) (P1): Paginação do catálogo público usa endpoint administrativo.
- [SF-002](<../storefront/ADR-storefront.md#sf-002>) (P1): Carrinho mistura alterações locais e chamadas incompletas.
- [SF-004](<../storefront/ADR-storefront.md#sf-004>) (P1): Busca marketplace envia query e interpreta envelope errados.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Identidade da sessão, contrato público estável, autorização de sala, preço autoritativo e compra com flag legacy desativada.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /storefront/index | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:47](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L47>) |
| GET /storefront/:slug/config | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:65](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L65>) |
| GET /storefront/:slug/stories | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:70](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L70>) |
| GET /storefront/:slug/logo | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:93](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L93>) |
| POST /storefront/conversations | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:115](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L115>) |
| POST /storefront/conversations/:conversationId/messages | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:120](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L120>) |
| GET /storefront/conversations/:conversationId | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:134](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L134>) |
| POST /storefront/conversations/:conversationId/events | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:145](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L145>) |
| GET /storefront/funnel/:merchantId | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:224](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L224>) |
| GET /storefront/funnel/:merchantId/sessions | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:234](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L234>) |
| GET /storefront/cart/:cartId | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:258](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L258>) |
| PATCH /storefront/cart/:cartId/items/:variantId | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:281](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L281>) |
| GET /storefront/marketplace/search | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:309](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L309>) |
| POST /storefront/marketplace/items | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:335](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L335>) |
| POST /storefront/budget-requests | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:365](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L365>) |
| GET /storefront/budget-requests | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:386](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L386>) |
| POST /storefront/budget-requests/:id/status | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:392](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L392>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-004"></a>

## API-004 — WebSocket aceita salas de conversa sem autenticação ou vínculo

| Campo | Registro |
| --- | --- |
| ID | API-004 |
| SEVERITY | P0 |
| MODULE | storefront |
| FILE(S) | [apps/api/src/modules/storefront/infrastructure/gateways/conversation.gateway.ts:20](<../../../../../apps/api/src/modules/storefront/infrastructure/gateways/conversation.gateway.ts#L20>)<br>[apps/api/src/modules/storefront/infrastructure/gateways/conversation.gateway.ts:39](<../../../../../apps/api/src/modules/storefront/infrastructure/gateways/conversation.gateway.ts#L39>)<br>[apps/api/src/modules/storefront/infrastructure/gateways/conversation.gateway.ts:57](<../../../../../apps/api/src/modules/storefront/infrastructure/gateways/conversation.gateway.ts#L57>) |
| ISSUE | WebSocket aceita salas de conversa sem autenticação ou vínculo |
| EVIDENCE | O gateway recebe merchantId pelo handshake.query e join por conversationId; entra em conversation:<id> sem validar JWT/embed/buyer nem ownership. As respostas são emitidas para essa sala; CORS aceita qualquer origem. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Um cliente que conheça o ID da conversa pode ouvir mensagens emitidas para ela. O gateway está registrado independentemente do bloqueio HTTP de rotas legadas. |
| ROOT CAUSE | Confiança em identificadores do cliente para autorização de canal. |
| RECOMMENDED FIX | Autenticar handshake, derivar tenant do token, validar buyer/session e autorização em cada join/message; incluir tenant na chave da sala e aplicar quotas. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Cliente anônimo, token de outra loja e buyer diferente não podem entrar nem receber eventos de uma conversa; testar reconexão e expiração. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="api-005"></a>

## API-005 — Flag de legado expõe consultas e mutações administrativas sem autenticação

| Campo | Registro |
| --- | --- |
| ID | API-005 |
| SEVERITY | P0 |
| MODULE | storefront |
| FILE(S) | [apps/api/src/shared/http/non-production-route.guard.ts:15](<../../../../../apps/api/src/shared/http/non-production-route.guard.ts#L15>)<br>[apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:29](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L29>)<br>[apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:386](<../../../../../apps/api/src/modules/storefront/presentation/http/storefront.controller.ts#L386>) |
| ISSUE | Flag de legado expõe consultas e mutações administrativas sem autenticação |
| EVIDENCE | ENABLE_LEGACY_ROUTES=true libera controllers @NonProductionRoute em production. StorefrontController lista budget-requests por merchantId recebido e altera status por id sem AuthGuard/ownership. Sem a flag, carrinho/conversas consumidos pelos fronts ficam bloqueados. |
| VERIFICATION | CONFIRMED_STATIC; exposição condicionada à flag; INFRA VALIDATION REQUIRED |
| PRODUCTION IMPACT | Com a flag ligada: exposição de dados de orçamento e alterações indevidas. Com ela desligada: fluxos dos fronts dependentes retornam 404. Estado real da flag no deploy não foi consultado. |
| ROOT CAUSE | O mesmo controller agrupa operações públicas e administrativas sob uma exceção de ambiente. |
| RECOMMENDED FIX | Separar contratos públicos autenticados por sessão e administração autenticada por tenant; retirar a dependência dos fronts da flag antes de encerrar o legado. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Subir production com a flag desligada: compra deve funcionar; listar/alterar orçamento sem principal deve falhar em qualquer configuração. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
