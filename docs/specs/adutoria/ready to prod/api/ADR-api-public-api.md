# ADR — API / public-api

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Adaptadores HTTP versionados para consumidores externos.

Inventário: 103 arquivos de implementação, 1 arquivos reconhecidos como testes, 10604 linhas de implementação. 110 declarações HTTP; 7 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **agent-rules, audit, catalog, checkout, checkout-settings, commerce, coupons, cross-sell, domains, experiments, fulfillment, installations, integrations, marketplace, notifications, operations, payment, returns, shipping, store-analytics, store-settings, support, team**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `merchantBillingSubscription`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

110 handlers declarados, só sete alcançáveis na composição. Não assumir suporte porque existe SDK/arquivo. Capacidade pública exige contrato único, scopes e versão de depreciação.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 4/10 | 3/10 | 3/10 | 4/10 | 2/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Há DTOs/guards/service credentials em vários controllers; representa interface da aplicação, sem domínio próprio.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| SettingsV1Controller | 248 | 9 | [apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts:59](<../../../../../apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts#L59>) |
| CheckoutsV1Controller | 239 | 8 | [apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts:71](<../../../../../apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts#L71>) |
| CommerceV1Controller | 223 | 4 | [apps/api/src/modules/public-api/commerce/presentation/http/commerce-v1.controller.ts:47](<../../../../../apps/api/src/modules/public-api/commerce/presentation/http/commerce-v1.controller.ts#L47>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-036](<ADR-api-public-api.md#api-036>) (P1): Maioria dos controllers públicos não entra no AppModule.
- [API-038](<ADR-api-shared.md#api-038>) (P1): Gate de release não cobre o widget atual e falha localmente.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Manifesto de rotas montadas versus OpenAPI/SDK; smoke de auth, paginação, erros, idempotência e ETag.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /analytics/dashboard | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/analytics/presentation/http/analytics-v1.controller.ts:56](<../../../../../apps/api/src/modules/public-api/analytics/presentation/http/analytics-v1.controller.ts#L56>) |
| GET /analytics/products | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/analytics/presentation/http/analytics-v1.controller.ts:70](<../../../../../apps/api/src/modules/public-api/analytics/presentation/http/analytics-v1.controller.ts#L70>) |
| GET /analytics/products/:productId | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/analytics/presentation/http/analytics-v1.controller.ts:101](<../../../../../apps/api/src/modules/public-api/analytics/presentation/http/analytics-v1.controller.ts#L101>) |
| GET /analytics/offers/roi | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/analytics/presentation/http/analytics-v1.controller.ts:145](<../../../../../apps/api/src/modules/public-api/analytics/presentation/http/analytics-v1.controller.ts#L145>) |
| GET /analytics/payments | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/analytics/presentation/http/analytics-v1.controller.ts:162](<../../../../../apps/api/src/modules/public-api/analytics/presentation/http/analytics-v1.controller.ts#L162>) |
| GET /analytics/customers | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/analytics/presentation/http/analytics-v1.controller.ts:179](<../../../../../apps/api/src/modules/public-api/analytics/presentation/http/analytics-v1.controller.ts#L179>) |
| GET /audit-events | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/audit/presentation/http/audit-v1.controller.ts:42](<../../../../../apps/api/src/modules/public-api/audit/presentation/http/audit-v1.controller.ts#L42>) |
| GET /billing/plans | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/billing/presentation/http/billing-v1.controller.ts:52](<../../../../../apps/api/src/modules/public-api/billing/presentation/http/billing-v1.controller.ts#L52>) |
| GET /billing/subscription | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/billing/presentation/http/billing-v1.controller.ts:60](<../../../../../apps/api/src/modules/public-api/billing/presentation/http/billing-v1.controller.ts#L60>) |
| POST /billing/subscription/change | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/billing/presentation/http/billing-v1.controller.ts:70](<../../../../../apps/api/src/modules/public-api/billing/presentation/http/billing-v1.controller.ts#L70>) |
| GET /billing/usage | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/billing/presentation/http/billing-v1.controller.ts:82](<../../../../../apps/api/src/modules/public-api/billing/presentation/http/billing-v1.controller.ts#L82>) |
| GET /billing/invoices | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/billing/presentation/http/billing-v1.controller.ts:91](<../../../../../apps/api/src/modules/public-api/billing/presentation/http/billing-v1.controller.ts#L91>) |
| GET /categories | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/categories/presentation/http/categories-v1.controller.ts:57](<../../../../../apps/api/src/modules/public-api/categories/presentation/http/categories-v1.controller.ts#L57>) |
| GET /categories/:categoryId | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/categories/presentation/http/categories-v1.controller.ts:69](<../../../../../apps/api/src/modules/public-api/categories/presentation/http/categories-v1.controller.ts#L69>) |
| POST /categories | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/categories/presentation/http/categories-v1.controller.ts:83](<../../../../../apps/api/src/modules/public-api/categories/presentation/http/categories-v1.controller.ts#L83>) |
| PATCH /categories/:categoryId | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/categories/presentation/http/categories-v1.controller.ts:102](<../../../../../apps/api/src/modules/public-api/categories/presentation/http/categories-v1.controller.ts#L102>) |
| DELETE /categories/:categoryId | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/categories/presentation/http/categories-v1.controller.ts:125](<../../../../../apps/api/src/modules/public-api/categories/presentation/http/categories-v1.controller.ts#L125>) |
| PUT /categories/reorder | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/categories/presentation/http/categories-v1.controller.ts:136](<../../../../../apps/api/src/modules/public-api/categories/presentation/http/categories-v1.controller.ts#L136>) |
| POST /checkouts | Não montada | Idempotent() | [apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts:92](<../../../../../apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts#L92>) |
| GET /checkouts/:checkoutId | Não montada | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts:133](<../../../../../apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts#L133>) |
| POST /checkouts/:checkoutId/events | Não montada | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts:146](<../../../../../apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts#L146>) |
| POST /checkouts/:checkoutId/messages | Não montada | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts:173](<../../../../../apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts#L173>) |
| POST /checkouts/:checkoutId/shipping/evaluate | Não montada | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts:201](<../../../../../apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts#L201>) |
| POST /checkouts/:checkoutId/offers | Não montada | Idempotent() | [apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts:230](<../../../../../apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts#L230>) |
| POST /checkouts/:checkoutId/complete | Não montada | Idempotent() | [apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts:257](<../../../../../apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts#L257>) |
| PATCH /checkouts/:checkoutId/cart | Não montada | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts:288](<../../../../../apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts#L288>) |
| GET /commerce/connections | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/commerce/presentation/http/commerce-v1.controller.ts:61](<../../../../../apps/api/src/modules/public-api/commerce/presentation/http/commerce-v1.controller.ts#L61>) |
| POST /commerce/connections | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/commerce/presentation/http/commerce-v1.controller.ts:76](<../../../../../apps/api/src/modules/public-api/commerce/presentation/http/commerce-v1.controller.ts#L76>) |
| GET /commerce/connections/:id | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/commerce/presentation/http/commerce-v1.controller.ts:97](<../../../../../apps/api/src/modules/public-api/commerce/presentation/http/commerce-v1.controller.ts#L97>) |
| PATCH /commerce/connections/:id | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/commerce/presentation/http/commerce-v1.controller.ts:117](<../../../../../apps/api/src/modules/public-api/commerce/presentation/http/commerce-v1.controller.ts#L117>) |
| DELETE /commerce/connections/:id | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/commerce/presentation/http/commerce-v1.controller.ts:144](<../../../../../apps/api/src/modules/public-api/commerce/presentation/http/commerce-v1.controller.ts#L144>) |
| POST /commerce/connections/:id/sync | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/commerce/presentation/http/commerce-v1.controller.ts:166](<../../../../../apps/api/src/modules/public-api/commerce/presentation/http/commerce-v1.controller.ts#L166>) |
| GET /coupons | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/coupons/presentation/http/coupons-v1.controller.ts:67](<../../../../../apps/api/src/modules/public-api/coupons/presentation/http/coupons-v1.controller.ts#L67>) |
| POST /coupons | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/coupons/presentation/http/coupons-v1.controller.ts:81](<../../../../../apps/api/src/modules/public-api/coupons/presentation/http/coupons-v1.controller.ts#L81>) |
| PATCH /coupons/:id | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/coupons/presentation/http/coupons-v1.controller.ts:113](<../../../../../apps/api/src/modules/public-api/coupons/presentation/http/coupons-v1.controller.ts#L113>) |
| DELETE /coupons/:id | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/coupons/presentation/http/coupons-v1.controller.ts:149](<../../../../../apps/api/src/modules/public-api/coupons/presentation/http/coupons-v1.controller.ts#L149>) |
| POST /coupons/:id/validate | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/coupons/presentation/http/coupons-v1.controller.ts:169](<../../../../../apps/api/src/modules/public-api/coupons/presentation/http/coupons-v1.controller.ts#L169>) |
| GET /cross-sells | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/cross-sell/presentation/http/cross-sell-v1.controller.ts:51](<../../../../../apps/api/src/modules/public-api/cross-sell/presentation/http/cross-sell-v1.controller.ts#L51>) |
| POST /cross-sells | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/cross-sell/presentation/http/cross-sell-v1.controller.ts:63](<../../../../../apps/api/src/modules/public-api/cross-sell/presentation/http/cross-sell-v1.controller.ts#L63>) |
| GET /cross-sells/eligible | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/cross-sell/presentation/http/cross-sell-v1.controller.ts:87](<../../../../../apps/api/src/modules/public-api/cross-sell/presentation/http/cross-sell-v1.controller.ts#L87>) |
| GET /customers | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/customers/presentation/http/customers-v1.controller.ts:49](<../../../../../apps/api/src/modules/public-api/customers/presentation/http/customers-v1.controller.ts#L49>) |
| GET /customers/:customerId | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/customers/presentation/http/customers-v1.controller.ts:80](<../../../../../apps/api/src/modules/public-api/customers/presentation/http/customers-v1.controller.ts#L80>) |
| GET /customers/:customerId/orders | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/customers/presentation/http/customers-v1.controller.ts:96](<../../../../../apps/api/src/modules/public-api/customers/presentation/http/customers-v1.controller.ts#L96>) |
| GET /domains | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/domains/presentation/http/domains-v1.controller.ts:61](<../../../../../apps/api/src/modules/public-api/domains/presentation/http/domains-v1.controller.ts#L61>) |
| POST /domains | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/domains/presentation/http/domains-v1.controller.ts:78](<../../../../../apps/api/src/modules/public-api/domains/presentation/http/domains-v1.controller.ts#L78>) |
| POST /domains/:domainId/verify | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/domains/presentation/http/domains-v1.controller.ts:99](<../../../../../apps/api/src/modules/public-api/domains/presentation/http/domains-v1.controller.ts#L99>) |
| GET /experiments | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts:67](<../../../../../apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts#L67>) |
| POST /experiments | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts:82](<../../../../../apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts#L82>) |
| GET /experiments/:experimentId | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts:110](<../../../../../apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts#L110>) |
| PATCH /experiments/:experimentId | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts:123](<../../../../../apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts#L123>) |
| POST /experiments/:experimentId/start | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts:156](<../../../../../apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts#L156>) |
| POST /experiments/:experimentId/stop | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts:176](<../../../../../apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts#L176>) |
| POST /experiments/:experimentId/archive | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts:196](<../../../../../apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts#L196>) |
| GET /experiments/:experimentId/results | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts:216](<../../../../../apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts#L216>) |
| POST /experiments/:experimentId/promote | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts:229](<../../../../../apps/api/src/modules/public-api/experiments/presentation/http/experiments-v1.controller.ts#L229>) |
| GET /fulfillment/shipments | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/fulfillment/presentation/http/fulfillment-v1.controller.ts:61](<../../../../../apps/api/src/modules/public-api/fulfillment/presentation/http/fulfillment-v1.controller.ts#L61>) |
| POST /fulfillment/shipments | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/fulfillment/presentation/http/fulfillment-v1.controller.ts:103](<../../../../../apps/api/src/modules/public-api/fulfillment/presentation/http/fulfillment-v1.controller.ts#L103>) |
| GET /installations | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/installations/presentation/http/installations-v1.controller.ts:81](<../../../../../apps/api/src/modules/public-api/installations/presentation/http/installations-v1.controller.ts#L81>) |
| GET /installations/:id | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/installations/presentation/http/installations-v1.controller.ts:116](<../../../../../apps/api/src/modules/public-api/installations/presentation/http/installations-v1.controller.ts#L116>) |
| POST /installations | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/installations/presentation/http/installations-v1.controller.ts:146](<../../../../../apps/api/src/modules/public-api/installations/presentation/http/installations-v1.controller.ts#L146>) |
| PATCH /installations/:id | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/installations/presentation/http/installations-v1.controller.ts:175](<../../../../../apps/api/src/modules/public-api/installations/presentation/http/installations-v1.controller.ts#L175>) |
| DELETE /installations/:id | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/installations/presentation/http/installations-v1.controller.ts:226](<../../../../../apps/api/src/modules/public-api/installations/presentation/http/installations-v1.controller.ts#L226>) |
| GET /marketplace/search | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/marketplace/presentation/http/marketplace-v1.controller.ts:60](<../../../../../apps/api/src/modules/public-api/marketplace/presentation/http/marketplace-v1.controller.ts#L60>) |
| GET /marketplace/config | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/marketplace/presentation/http/marketplace-v1.controller.ts:79](<../../../../../apps/api/src/modules/public-api/marketplace/presentation/http/marketplace-v1.controller.ts#L79>) |
| PATCH /marketplace/config | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/marketplace/presentation/http/marketplace-v1.controller.ts:91](<../../../../../apps/api/src/modules/public-api/marketplace/presentation/http/marketplace-v1.controller.ts#L91>) |
| POST /marketplace/items | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/marketplace/presentation/http/marketplace-v1.controller.ts:114](<../../../../../apps/api/src/modules/public-api/marketplace/presentation/http/marketplace-v1.controller.ts#L114>) |
| POST /marketplace/orders | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/marketplace/presentation/http/marketplace-v1.controller.ts:133](<../../../../../apps/api/src/modules/public-api/marketplace/presentation/http/marketplace-v1.controller.ts#L133>) |
| GET /marketplace/orders | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/marketplace/presentation/http/marketplace-v1.controller.ts:156](<../../../../../apps/api/src/modules/public-api/marketplace/presentation/http/marketplace-v1.controller.ts#L156>) |
| POST /marketplace/chargebacks | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/marketplace/presentation/http/marketplace-v1.controller.ts:172](<../../../../../apps/api/src/modules/public-api/marketplace/presentation/http/marketplace-v1.controller.ts#L172>) |
| POST /notifications/order-confirmation | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/notifications/presentation/http/notifications-v1.controller.ts:52](<../../../../../apps/api/src/modules/public-api/notifications/presentation/http/notifications-v1.controller.ts#L52>) |
| POST /notifications/order-shipped | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/notifications/presentation/http/notifications-v1.controller.ts:72](<../../../../../apps/api/src/modules/public-api/notifications/presentation/http/notifications-v1.controller.ts#L72>) |
| POST /notifications/order-delivered | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/notifications/presentation/http/notifications-v1.controller.ts:92](<../../../../../apps/api/src/modules/public-api/notifications/presentation/http/notifications-v1.controller.ts#L92>) |
| POST /notifications/return-approved | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/notifications/presentation/http/notifications-v1.controller.ts:112](<../../../../../apps/api/src/modules/public-api/notifications/presentation/http/notifications-v1.controller.ts#L112>) |
| GET /orders | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/orders/presentation/http/orders-v1.controller.ts:79](<../../../../../apps/api/src/modules/public-api/orders/presentation/http/orders-v1.controller.ts#L79>) |
| GET /orders/:orderId | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/orders/presentation/http/orders-v1.controller.ts:116](<../../../../../apps/api/src/modules/public-api/orders/presentation/http/orders-v1.controller.ts#L116>) |
| POST /orders/:orderId/cancel | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/orders/presentation/http/orders-v1.controller.ts:130](<../../../../../apps/api/src/modules/public-api/orders/presentation/http/orders-v1.controller.ts#L130>) |
| GET /orders/:orderId/tracking | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/orders/presentation/http/orders-v1.controller.ts:154](<../../../../../apps/api/src/modules/public-api/orders/presentation/http/orders-v1.controller.ts#L154>) |
| PATCH /orders/:orderId/tracking | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/orders/presentation/http/orders-v1.controller.ts:168](<../../../../../apps/api/src/modules/public-api/orders/presentation/http/orders-v1.controller.ts#L168>) |
| POST /payments/intents | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/payments/presentation/http/payments-v1.controller.ts:65](<../../../../../apps/api/src/modules/public-api/payments/presentation/http/payments-v1.controller.ts#L65>) |
| GET /payments/intents/:intentId | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/payments/presentation/http/payments-v1.controller.ts:92](<../../../../../apps/api/src/modules/public-api/payments/presentation/http/payments-v1.controller.ts#L92>) |
| POST /payments/intents/:intentId/confirm | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/payments/presentation/http/payments-v1.controller.ts:116](<../../../../../apps/api/src/modules/public-api/payments/presentation/http/payments-v1.controller.ts#L116>) |
| GET /products | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/products/presentation/http/products-v1.controller.ts:79](<../../../../../apps/api/src/modules/public-api/products/presentation/http/products-v1.controller.ts#L79>) |
| GET /products/:productId | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/products/presentation/http/products-v1.controller.ts:118](<../../../../../apps/api/src/modules/public-api/products/presentation/http/products-v1.controller.ts#L118>) |
| POST /products | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/products/presentation/http/products-v1.controller.ts:132](<../../../../../apps/api/src/modules/public-api/products/presentation/http/products-v1.controller.ts#L132>) |
| PATCH /products/:productId | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/products/presentation/http/products-v1.controller.ts:178](<../../../../../apps/api/src/modules/public-api/products/presentation/http/products-v1.controller.ts#L178>) |
| DELETE /products/:productId | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/products/presentation/http/products-v1.controller.ts:214](<../../../../../apps/api/src/modules/public-api/products/presentation/http/products-v1.controller.ts#L214>) |
| GET /returns | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/returns/presentation/http/returns-v1.controller.ts:48](<../../../../../apps/api/src/modules/public-api/returns/presentation/http/returns-v1.controller.ts#L48>) |
| POST /returns | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/returns/presentation/http/returns-v1.controller.ts:84](<../../../../../apps/api/src/modules/public-api/returns/presentation/http/returns-v1.controller.ts#L84>) |
| GET /settings/checkout | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts:82](<../../../../../apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts#L82>) |
| PUT /settings/checkout | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts:104](<../../../../../apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts#L104>) |
| GET /settings/agent-rules | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts:140](<../../../../../apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts#L140>) |
| PUT /settings/agent-rules | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts:162](<../../../../../apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts#L162>) |
| GET /settings/store | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts:197](<../../../../../apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts#L197>) |
| PUT /settings/store | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts:219](<../../../../../apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts#L219>) |
| GET /settings/seo | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts:254](<../../../../../apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts#L254>) |
| PUT /settings/seo | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts:276](<../../../../../apps/api/src/modules/public-api/settings/presentation/http/settings-v1.controller.ts#L276>) |
| POST /shipping/quotes | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/shipping/presentation/http/shipping-v1.controller.ts:51](<../../../../../apps/api/src/modules/public-api/shipping/presentation/http/shipping-v1.controller.ts#L51>) |
| GET /support/settings | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/support/presentation/http/support-v1.controller.ts:39](<../../../../../apps/api/src/modules/public-api/support/presentation/http/support-v1.controller.ts#L39>) |
| GET /support/tickets | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/support/presentation/http/support-v1.controller.ts:50](<../../../../../apps/api/src/modules/public-api/support/presentation/http/support-v1.controller.ts#L50>) |
| GET /team/members | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/team/presentation/http/team-v1.controller.ts:62](<../../../../../apps/api/src/modules/public-api/team/presentation/http/team-v1.controller.ts#L62>) |
| POST /team/invitations | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/team/presentation/http/team-v1.controller.ts:72](<../../../../../apps/api/src/modules/public-api/team/presentation/http/team-v1.controller.ts#L72>) |
| POST /team/invitations/:inviteId/accept | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/team/presentation/http/team-v1.controller.ts:91](<../../../../../apps/api/src/modules/public-api/team/presentation/http/team-v1.controller.ts#L91>) |
| PATCH /team/members/:userId/role | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/team/presentation/http/team-v1.controller.ts:106](<../../../../../apps/api/src/modules/public-api/team/presentation/http/team-v1.controller.ts#L106>) |
| DELETE /team/members/:userId | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/team/presentation/http/team-v1.controller.ts:128](<../../../../../apps/api/src/modules/public-api/team/presentation/http/team-v1.controller.ts#L128>) |
| GET /webhooks | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/webhooks/presentation/http/webhooks-v1.controller.ts:81](<../../../../../apps/api/src/modules/public-api/webhooks/presentation/http/webhooks-v1.controller.ts#L81>) |
| GET /webhooks/:id | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/webhooks/presentation/http/webhooks-v1.controller.ts:110](<../../../../../apps/api/src/modules/public-api/webhooks/presentation/http/webhooks-v1.controller.ts#L110>) |
| POST /webhooks | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent({ redactResponseFields: ["secret_key"] }) | [apps/api/src/modules/public-api/webhooks/presentation/http/webhooks-v1.controller.ts:133](<../../../../../apps/api/src/modules/public-api/webhooks/presentation/http/webhooks-v1.controller.ts#L133>) |
| PUT /webhooks/:id | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/webhooks/presentation/http/webhooks-v1.controller.ts:162](<../../../../../apps/api/src/modules/public-api/webhooks/presentation/http/webhooks-v1.controller.ts#L162>) |
| DELETE /webhooks/:id | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/public-api/webhooks/presentation/http/webhooks-v1.controller.ts:202](<../../../../../apps/api/src/modules/public-api/webhooks/presentation/http/webhooks-v1.controller.ts#L202>) |
| POST /webhooks/:id/test | Não montada | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/public-api/webhooks/presentation/http/webhooks-v1.controller.ts:223](<../../../../../apps/api/src/modules/public-api/webhooks/presentation/http/webhooks-v1.controller.ts#L223>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-036"></a>

## API-036 — Maioria dos controllers públicos não entra no AppModule

| Campo | Registro |
| --- | --- |
| ID | API-036 |
| SEVERITY | P1 |
| MODULE | public-api |
| FILE(S) | [apps/api/src/app.module.ts:1](<../../../../../apps/api/src/app.module.ts#L1>)<br>[apps/api/src/modules/public-api/public-api.module.ts:1](<../../../../../apps/api/src/modules/public-api/public-api.module.ts#L1>)<br>[apps/api/src/modules/dashboard/dashboard-marketplace.module.ts:1](<../../../../../apps/api/src/modules/dashboard/dashboard-marketplace.module.ts#L1>) |
| ISSUE | Maioria dos controllers públicos não entra no AppModule |
| EVIDENCE | Grafo AST de @Module encontra 110 declarações de handlers em public-api, mas só sete alcançáveis via DashboardMarketplaceModule. PublicApiModule está comentado na composição raiz. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Existência de controller/SDK/OpenAPI não implica endpoint em produção; integrações públicas anunciadas podem retornar 404. |
| ROOT CAUSE | Superfície documentada diverge da composição executável. |
| RECOMMENDED FIX | Definir superfície suportada e gerar contrato da aplicação realmente montada; habilitar controllers somente após seus guards/providers serem validados. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Subir AppModule production e executar smoke por método/path das rotas suportadas, com casos 401/403/404 e consumidores reais. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
