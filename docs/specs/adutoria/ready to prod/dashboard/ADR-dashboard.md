# ADR — Dashboard: prontidão e consumo da API

Data: 2026-09-05. Status: auditoria registrada; atualização de implementação em 2026-09-06. Veredito: **FAIL / NO-GO** pelos demais gates abertos.

[Índice geral](<../README.md>) · [API primeiro](<../api/README.md>) · [Validação](<../VALIDACAO.md>)

## Escopo e controles existentes

222 call sites HTTP extraídos, 26 arquivos de endpoints mais cliente compartilhado e chamadas diretas. A revisão cobre operações administrativas e relação com tenant/cookies/roles.

Client central usa cookies include, refresh single-flight e chave idempotente preservada na repetição após 401. Vários adapters convertem snake_case/camelCase; suporte e checkout settings têm tipagem explícita.

Este relatório verifica integração e comportamento implementado, não é uma aprovação visual/acessibilidade do produto em navegador. Layout responsivo, leitores de tela e testes em dispositivos permanecem UNVERIFIED.

## ADRs por módulo do front

| Módulo | Call sites no agrupamento | Achados relacionados |
| --- | --- | --- |
| [agent](<modulos/ADR-dashboard-agent.md>) | 3 | [API-043](<../api/ADR-api-checkout.md#api-043>) |
| [audit](<modulos/ADR-dashboard-audit.md>) | 1 | [API-028](<../api/ADR-api-audit.md#api-028>) |
| [auth](<modulos/ADR-dashboard-auth.md>) | 9 | [DASH-002](<ADR-dashboard.md#dash-002>), [API-009](<../api/ADR-api-auth.md#api-009>), [API-010](<../api/ADR-api-auth.md#api-010>) |
| [billing](<modulos/ADR-dashboard-billing.md>) | 13 | [API-039](<../api/ADR-api-shared.md#api-039>) |
| [cart-recovery](<modulos/ADR-dashboard-cart-recovery.md>) | 6 | [API-019](<../api/ADR-api-cart-recovery.md#api-019>) |
| [catalog](<modulos/ADR-dashboard-catalog.md>) | 15 | [API-001](<../api/ADR-api-catalog.md#api-001>), [API-002](<../api/ADR-api-catalog.md#api-002>) |
| [checkout-settings](<modulos/ADR-dashboard-checkout-settings.md>) | 3 | [DASH-005](<ADR-dashboard.md#dash-005>), [W2-010](<../widget_v2/ADR-widget_v2.md#w2-010>) |
| [customer](<modulos/ADR-dashboard-customer.md>) | 7 | [API-042](<../api/ADR-api-checkout.md#api-042>), [API-032](<../api/ADR-api-buyer-purchase-history.md#api-032>) |
| [experiments](<modulos/ADR-dashboard-experiments.md>) | 9 | [API-034](<../api/ADR-api-revenue-lift.md#api-034>) |
| [funnel](<modulos/ADR-dashboard-funnel.md>) | 4 | [API-005](<../api/ADR-api-storefront.md#api-005>), [W2-008](<../widget_v2/ADR-widget_v2.md#w2-008>) |
| [integration](<modulos/ADR-dashboard-integration.md>) | 18 | [API-018](<../api/ADR-api-integrations.md#api-018>), [API-021](<../api/ADR-api-coupons.md#api-021>) |
| [inventory](<modulos/ADR-dashboard-inventory.md>) | 17 | [API-017](<../api/ADR-api-inventory.md#api-017>), [API-002](<../api/ADR-api-catalog.md#api-002>) |
| [m2m-management](<modulos/ADR-dashboard-m2m-management.md>) | 6 | [API-036](<../api/ADR-api-public-api.md#api-036>) |
| [marketplace-v2](<modulos/ADR-dashboard-marketplace-v2.md>) | 16 | DASH-004 corrigido em 2026-09-06; [API-006](<../api/ADR-api-marketplace.md#api-006>), [API-008](<../api/ADR-api-marketplace.md#api-008>) permanecem bloqueadores |
| [marketplace](<modulos/ADR-dashboard-marketplace.md>) | 6 | DASH-004 corrigido em 2026-09-06; [API-006](<../api/ADR-api-marketplace.md#api-006>), [API-008](<../api/ADR-api-marketplace.md#api-008>) permanecem bloqueadores |
| [merchants](<modulos/ADR-dashboard-merchants.md>) | 33 | [API-011](<../api/ADR-api-team.md#api-011>), [API-031](<../api/ADR-api-store-settings.md#api-031>), [API-026](<../api/ADR-api-whatsapp-channel.md#api-026>) |
| [negotiation](<modulos/ADR-dashboard-negotiation.md>) | 5 | [API-043](<../api/ADR-api-checkout.md#api-043>) |
| [onboarding](<modulos/ADR-dashboard-onboarding.md>) | 3 | [DASH-001](<ADR-dashboard.md#dash-001>), [API-030](<../api/ADR-api-onboarding.md#api-030>), [API-044](<../api/ADR-api-embed.md#api-044>) |
| [order](<modulos/ADR-dashboard-order.md>) | 4 | [API-022](<../api/ADR-api-operations.md#api-022>), [API-023](<../api/ADR-api-shipping.md#api-023>) |
| [other](<modulos/ADR-dashboard-other.md>) | 0 | Sem achado específico; conditional |
| [returns](<modulos/ADR-dashboard-returns.md>) | 5 | [DASH-003](<ADR-dashboard.md#dash-003>), [API-007](<../api/ADR-api-returns.md#api-007>) |
| [revenue-lift](<modulos/ADR-dashboard-revenue-lift.md>) | 2 | [API-034](<../api/ADR-api-revenue-lift.md#api-034>) |
| [revenue-manager](<modulos/ADR-dashboard-revenue-manager.md>) | 5 | [API-033](<../api/ADR-api-revenue-manager.md#api-033>) |
| [stories](<modulos/ADR-dashboard-stories.md>) | 11 | [API-003](<../api/ADR-api-stories.md#api-003>) |
| [support](<modulos/ADR-dashboard-support.md>) | 6 | [API-041](<../api/ADR-api-support.md#api-041>), [W2-009](<../widget_v2/ADR-widget_v2.md#w2-009>) |
| [webhook](<modulos/ADR-dashboard-webhook.md>) | 7 | [DASH-005](<ADR-dashboard.md#dash-005>), [API-018](<../api/ADR-api-integrations.md#api-018>) |
| [http-e-shell](<modulos/ADR-dashboard-http-e-shell.md>) | 8 | [API-009](<../api/ADR-api-auth.md#api-009>), [API-041](<../api/ADR-api-support.md#api-041>), [DASH-006](<ADR-dashboard.md#dash-006>) |

Agrupamentos do storefront/widget podem compartilhar o mesmo client, portanto contagens por módulo não devem ser somadas. Inventário único do app: 222 chamadas extraídas.

## Decisão

Login/refresh/logout, onboarding por plano, catálogo, pedidos, devoluções, equipe, marketplace, settings e suporte devem ter testes contra AppModule real.

O contrato deve definir URL/método, principal, tenant/session, DTO, envelope, unidades, estados e idempotência. Manter fixtures derivadas de respostas reais e smoke sobre a composição production, incluindo ENABLE_LEGACY_ROUTES desligado.

<a id="dash-001"></a>

## DASH-001 — Onboarding usa etapas incompatíveis e impede compilação

| Campo | Registro |
| --- | --- |
| ID | DASH-001 |
| SEVERITY | P1 |
| MODULE | dashboard |
| FILE(S) | [apps/dashboard/src/pages/onboarding-wizard/hooks/useStepPayment.ts:52](<../../../../../apps/dashboard/src/pages/onboarding-wizard/hooks/useStepPayment.ts#L52>)<br>[apps/dashboard/src/pages/onboarding-wizard/hooks/useStepApiKey.ts:24](<../../../../../apps/dashboard/src/pages/onboarding-wizard/hooks/useStepApiKey.ts#L24>)<br>[apps/dashboard/src/pages/onboarding-wizard/hooks/useStepReview.ts:18](<../../../../../apps/dashboard/src/pages/onboarding-wizard/hooks/useStepReview.ts#L18>)<br>[apps/api/src/modules/onboarding/application/complete-onboarding-step.use-case.ts:60](<../../../../../apps/api/src/modules/onboarding/application/complete-onboarding-step.use-case.ts#L60>) |
| ISSUE | Onboarding usa etapas incompatíveis e impede compilação |
| EVIDENCE | tsc reportou cinco TS2345 nas etapas embed/publish, ausentes de OnboardingStepId. A API também valida step por isOnboardingStepId antes de concluir. |
| VERIFICATION | EXECUTED_FAILED + CONFIRMED_STATIC |
| PRODUCTION IMPACT | Build do dashboard bloqueado; contornar tipagem não torna as etapas válidas no backend. |
| ROOT CAUSE | Workflow da UI mudou sem alinhar contrato de onboarding. |
| RECOMMENDED FIX | Derivar etapas e transições do contrato compartilhado; atualizar jornada por plano e estado de conclusão apenas após resposta válida. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | tsc/build passam; percorrer STORE_ONLY/CHECKOUT_ONLY/BOTH e retomar onboarding em outra sessão conclui somente etapas reconhecidas. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="dash-002"></a>

## DASH-002 — Configurações de conta chamam endpoints ausentes

| Campo | Registro |
| --- | --- |
| ID | DASH-002 |
| SEVERITY | P1 |
| MODULE | dashboard |
| FILE(S) | [apps/dashboard/src/api/endpoints/auth.ts:46](<../../../../../apps/dashboard/src/api/endpoints/auth.ts#L46>)<br>[apps/dashboard/src/pages/useAccountSettingsPage.ts:65](<../../../../../apps/dashboard/src/pages/useAccountSettingsPage.ts#L65>)<br>[apps/api/src/modules/auth/presentation/auth.controller.ts:26](<../../../../../apps/api/src/modules/auth/presentation/auth.controller.ts#L26>) |
| ISSUE | Configurações de conta chamam endpoints ausentes |
| EVIDENCE | Cliente chama GET/PUT /auth/me e PUT /auth/me/password; o controller auth montado oferece register/login/refresh/logout/forgot/reset/oauth, sem esses handlers. Página de conta usa as funções. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Leitura/edição da conta e troca de senha pela tela falham com 404 na composição auditada. |
| ROOT CAUSE | Cliente implementado contra contrato que não foi exposto na API. |
| RECOMMENDED FIX | Definir DTOs e implementar endpoints autorizados ou apontar para contrato existente equivalente; invalidar sessões após troca de senha. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Teste de contrato monta AppModule e cobre leitura, update e senha atual incorreta/correta; tela só informa sucesso após resposta real. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="dash-003"></a>

## DASH-003 — Ações de devolução usam nomes de rotas divergentes

| Campo | Registro |
| --- | --- |
| ID | DASH-003 |
| SEVERITY | P1 |
| MODULE | dashboard |
| FILE(S) | [apps/dashboard/src/api/endpoints/returns.ts:47](<../../../../../apps/dashboard/src/api/endpoints/returns.ts#L47>)<br>[apps/api/src/modules/returns/presentation/http/returns.controller.ts:75](<../../../../../apps/api/src/modules/returns/presentation/http/returns.controller.ts#L75>) |
| ISSUE | Ações de devolução usam nomes de rotas divergentes |
| EVIDENCE | Dashboard POST /returns/:id/generate-label e /mark-received; backend registra /label e /receive. inspect/refund existem, mas refund possui API-007. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Operador não consegue emitir etiqueta nem registrar recebimento por essas ações; reembolso existente não pode ser considerado pronto. |
| ROOT CAUSE | URLs duplicadas manualmente sem teste consumidor/provedor. |
| RECOMMENDED FIX | Alinhar nomes/DTOs no client e contrato, mantendo bloqueio financeiro até API-007; tratar 409 de estado inválido na tela. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Fluxo real request→label→receive→inspect→refund deve usar contratos montados e exibir tracking/status confirmado. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="dash-004"></a>

## DASH-004 — Envio/entrega de marketplace apontam para rotas não declaradas

| Campo | Registro |
| --- | --- |
| ID | DASH-004 |
| SEVERITY | P1 |
| MODULE | dashboard |
| FILE(S) | [apps/dashboard/src/api/endpoints/marketplace.ts:72](<../../../../../apps/dashboard/src/api/endpoints/marketplace.ts#L72>)<br>[apps/dashboard/src/api/endpoints/marketplace-v2.ts:181](<../../../../../apps/dashboard/src/api/endpoints/marketplace-v2.ts#L181>)<br>[apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts:35](<../../../../../apps/api/src/modules/marketplace/presentation/http/marketplace.controller.ts#L35>) |
| ISSUE | Envio/entrega de marketplace apontavam para rotas não declaradas |
| EVIDENCE | Em 2026-09-06, o client ativo passou a chamar POST /marketplace/dashboard/line-items/:id/ship e /deliver. A API declara os comandos, deriva o seller do principal e usa update condicional por tenant e status. |
| VERIFICATION | API build, dashboard typecheck e verificação direta de tenant, transição e concorrência passaram; PostgreSQL de integração permanece pendente. |
| PRODUCTION IMPACT | Corrigido: a ação não recebe mais 404 por path inexistente e não pode avançar item de outro vendedor. |
| ROOT CAUSE | Evolução do marketplace deixou adaptadores e superfície da API desacoplados. |
| RECOMMENDED FIX | Concluído para o client ativo; manter uma única superfície dashboard e executar o teste PostgreSQL antes do release. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | NO para este achado; API-006 e API-008 ainda bloqueiam marketplace. |
| CRITÉRIO DE ACEITE | Parcialmente atendido em código: vendedor envia/entrega item próprio, item alheio falha e estado concorrente gera conflito. Falta confirmar contra PostgreSQL. |

Decisão: correção implementada; manter a revalidação com PostgreSQL no gate de marketplace.

<a id="dash-005"></a>

## DASH-005 — Salvar configurações busca ETag novo e pode sobrescrever edição concorrente

| Campo | Registro |
| --- | --- |
| ID | DASH-005 |
| SEVERITY | P2 |
| MODULE | dashboard |
| FILE(S) | [apps/dashboard/src/api/endpoints/checkout-settings.ts:11](<../../../../../apps/dashboard/src/api/endpoints/checkout-settings.ts#L11>)<br>[apps/dashboard/src/api/endpoints/webhook.ts:37](<../../../../../apps/dashboard/src/api/endpoints/webhook.ts#L37>) |
| ISSUE | Salvar configurações busca ETag novo e pode sobrescrever edição concorrente |
| EVIDENCE | Checkout settings busca ETag imediatamente antes do PUT, em vez de usar a versão carregada ao editar. Fallback usa If-Match: *. Webhooks enviam * sempre. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Um formulário antigo pode adquirir o ETag mais recente e sobrescrever mudanças alheias sem apresentar conflito ao usuário. |
| ROOT CAUSE | If-Match usado como requisito sintático e não versão da base da edição. |
| RECOMMENDED FIX | Guardar ETag junto aos dados carregados, enviar essa versão e tratar 412/409 com recarregar/mesclar; evitar wildcard em edição concorrente. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | NO |
| CRITÉRIO DE ACEITE | Duas abas editam o mesmo campo a partir de V1: salvar A gera V2 e salvar B deve apresentar conflito sem sobrescrever V2. |

Decisão: registrar correção priorizada e acompanhar o risco residual. Correção ainda não implementada nesta auditoria.

<a id="dash-006"></a>

## DASH-006 — Suíte atual contém 33 falhas e cobertura de contrato insuficiente

| Campo | Registro |
| --- | --- |
| ID | DASH-006 |
| SEVERITY | P2 |
| MODULE | dashboard |
| FILE(S) | [apps/dashboard/vitest.config.ts:1](<../../../../../apps/dashboard/vitest.config.ts#L1>)<br>[apps/dashboard/src/api-client.spec.ts:1](<../../../../../apps/dashboard/src/api-client.spec.ts#L1>) |
| ISSUE | Suíte atual contém 33 falhas e cobertura de contrato insuficiente |
| EVIDENCE | vitest run --configLoader runner executou 448 testes: 415 passaram e 33 falharam em seis arquivos. Há falhas de texto/estrutura de UI, fixtures e filtro de data. Execução padrão foi bloqueada pelo acesso do esbuild à configuração. |
| VERIFICATION | EXECUTED_FAILED |
| PRODUCTION IMPACT | Não há baseline verde para afirmar regressão controlada. Testes de fonte/snapshot que passam não garantem rotas/DTOs da API montada. |
| ROOT CAUSE | Mudanças de UI e contratos não foram acompanhadas de validação integral do consumidor. |
| RECOMMENDED FIX | Triar falhas legítimas versus expectativas obsoletas; priorizar testes comportamentais e contratos reais para conta, onboarding, devoluções, marketplace e pagamentos. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Suíte oficial passa com expectativas justificadas e testes novos detectam os caminhos ausentes registrados nesta auditoria. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Dependências para produção

As correções de segurança e dinheiro da API precedem o aceite dos fronts. Não há prova de E2E browser, providers reais ou deployment; os resultados de tipo/teste e reproduções estão em [Validação](<../VALIDACAO.md>).
