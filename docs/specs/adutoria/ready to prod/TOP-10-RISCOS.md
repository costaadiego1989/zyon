# Top 10 de riscos por categoria

São cenários de falha priorizados por impacto e evidência, não probabilidades medidas. Itens de performance/concorrência ainda exigem execução com carga/banco real. Alguns cenários compartilham a mesma causa; não são achados adicionais.

## Falhas de produção com 10.000 usuários

| # | Cenário | Referência |
| --- | --- | --- |
| 1 | Checkout cria sessão vazia/desconectada do carrinho exibido | [W2-001](<widget_v2/ADR-widget_v2.md#w2-001>) |
| 2 | PIX sem QR/ID utilizável e polling preso | [W2-002](<widget_v2/ADR-widget_v2.md#w2-002>) / [W2-003](<widget_v2/ADR-widget_v2.md#w2-003>) |
| 3 | Cartão não renderiza ou cobrança aprovada não conclui pedido | [W2-005](<widget_v2/ADR-widget_v2.md#w2-005>) / [API-014](<api/ADR-api-payment.md#api-014>) |
| 4 | Duas compras reservam a mesma última unidade | [API-002](<api/ADR-api-catalog.md#api-002>) |
| 5 | Devolução/repasse informam pagamento que não aconteceu | [API-007](<api/ADR-api-returns.md#api-007>) / [API-008](<api/ADR-api-marketplace.md#api-008>) |
| 6 | Timeout do provedor duplica cobrança ou deixa intenção presa | [API-012](<api/ADR-api-payment.md#api-012>) / [API-013](<api/ADR-api-payment.md#api-013>) |
| 7 | Pedido concluído não baixa estoque | [API-017](<api/ADR-api-inventory.md#api-017>) |
| 8 | Webhooks/notifications falham ou são marcados entregues | [API-018](<api/ADR-api-integrations.md#api-018>) / [API-024](<api/ADR-api-notifications.md#api-024>) |
| 9 | Deploy/baseline de build falha e fronts dependem de APIs indisponíveis | [API-038](<api/ADR-api-shared.md#api-038>) / [API-045](<api/ADR-api-shared.md#api-045>) / [API-036](<api/ADR-api-public-api.md#api-036>) |
| 10 | Redis/worker/restart duplica ou perde processamento | [API-016](<api/ADR-api-shared.md#api-016>) / [API-026](<api/ADR-api-whatsapp-channel.md#api-026>) / [API-040](<api/ADR-api-marketplace.md#api-040>) |

## Segurança

| # | Cenário | Referência |
| --- | --- | --- |
| 1 | Loja A opera variante/mídia da loja B | [API-001](<api/ADR-api-catalog.md#api-001>) |
| 2 | Loja A altera stories de B | [API-003](<api/ADR-api-stories.md#api-003>) |
| 3 | Caller autenticado cria chargeback/dívida em settlement alheio | [API-006](<api/ADR-api-marketplace.md#api-006>) |
| 4 | Socket anônimo ouve conversa | [API-004](<api/ADR-api-storefront.md#api-004>) |
| 5 | Socket anônimo ouve tickets e se passa por merchant | [API-041](<api/ADR-api-support.md#api-041>) |
| 6 | Email conhecido vincula buyer sem prova de posse | [API-042](<api/ADR-api-checkout.md#api-042>) |
| 7 | Token embed público inicializa preço/frete adulterado | [API-043](<api/ADR-api-checkout.md#api-043>) |
| 8 | BFF emite token para tenant/origem arbitrários | [API-044](<api/ADR-api-embed.md#api-044>) |
| 9 | Refresh antigo/removal não revoga acesso efetivo | [API-009](<api/ADR-api-auth.md#api-009>) / [API-011](<api/ADR-api-team.md#api-011>) |
| 10 | Legacy/segredo opcional/OTP logs ampliam exposição | [API-005](<api/ADR-api-storefront.md#api-005>) / [API-025](<api/ADR-api-buyer-account.md#api-025>) / [API-026](<api/ADR-api-whatsapp-channel.md#api-026>) |

## Performance e capacidade — REQUIRES LOAD VALIDATION

| # | Ponto a medir | Base de inspeção / prova necessária |
| --- | --- | --- |
| 1 | Histórico completo por buyer recorrente | [API-032](<api/ADR-api-buyer-purchase-history.md#api-032>); medir linhas/I/O por compra. |
| 2 | Resolução de slug com fallback que percorre merchants | [API-031](<api/ADR-api-store-settings.md#api-031>); query indexada/latência com muitas lojas. |
| 3 | Repetição de outbox entre réplicas | [API-016](<api/ADR-api-shared.md#api-016>); processamento útil versus duplicado. |
| 4 | AI/conversas com chamadas externas e contexto extenso | StorefrontConversationAdapter/SendChatMessage; tokens, timeouts, p95 e orçamento por tenant. |
| 5 | Polling de pagamentos que nunca termina aprovado | [W2-003](<widget_v2/ADR-widget_v2.md#w2-003>); requests simultâneos/intervalos órfãos. |
| 6 | Fila de catálogo sem versão/dedup de job | [API-040](<api/ADR-api-marketplace.md#api-040>); backlog e carga repetida por produto. |
| 7 | Limite global inefetivo | [API-027](<api/ADR-api-shared.md#api-027>); tenant barulhento e requests anônimos. |
| 8 | Labels Prometheus derivados de req.path em 404 | shared/http/metrics.middleware.ts:54; cardinalidade/heap sob paths únicos. |
| 9 | Uploads e parsing de JSON/base64 | Catalog/media/storage; tamanho, memória pico, CPU e concorrência por processo. |
| 10 | Pool PostgreSQL, consultas agregadas e jobs de varredura | EXPLAIN ANALYZE, conexões por réplica, janela/paginação e lock wait. Sem medição não há gargalo quantificado. |

## Concorrência

| # | Race / interleaving | Referência |
| --- | --- | --- |
| 1 | Duas reservas sobre reserved antigo | [API-002](<api/ADR-api-catalog.md#api-002>) |
| 2 | Confirmação compete com expiração/segunda confirmação de reserva | [API-002](<api/ADR-api-catalog.md#api-002>) |
| 3 | Dois workers processam evento pending | [API-016](<api/ADR-api-shared.md#api-016>) |
| 4 | Dois eventos distintos sobrescrevem estado de pagamento | [API-015](<api/ADR-api-payment.md#api-015>) |
| 5 | Criação financeira repetida após resultado ambíguo | [API-012](<api/ADR-api-payment.md#api-012>) / [API-013](<api/ADR-api-payment.md#api-013>) |
| 6 | Duas sessões consomem última cota do cupom | [API-021](<api/ADR-api-coupons.md#api-021>) |
| 7 | Refresh paralelo consome mesmo token expirado | [API-009](<api/ADR-api-auth.md#api-009>) |
| 8 | Duas lojas assumem mesmo slug | [API-031](<api/ADR-api-store-settings.md#api-031>) |
| 9 | Duas abas sobrescrevem settings com ETag recarregado | [DASH-005](<dashboard/ADR-dashboard.md#dash-005>) |
| 10 | Delete/upsert de catálogo processados fora de ordem | [API-040](<api/ADR-api-marketplace.md#api-040>) |

## Dívidas arquiteturais

| # | Dívida | Consequência / primeira ação |
| --- | --- | --- |
| 1 | Dois carrinhos sem revisão comum | Unificar contrato de sessão pagável; W2-001/007. |
| 2 | Dono do estoque entre catalog/inventory/ERP | Definir facade e invariantes por depósito; API-002/017. |
| 3 | Identidade reconhecida versus autenticada | Separar buyer proof de personalização; API-042. |
| 4 | Estado financeiro final sem provedor | Payment/ledger como fonte de confirmação; API-007/008. |
| 5 | Orquestradores com alto fan-out | Extrair política/ports gradualmente, sem quebrar módulo por tamanho. |
| 6 | Transporte assíncrono com garantias heterogêneas | Documentar inbox/outbox/job, ID/versão e ack; ADR-ASYNC. |
| 7 | Client types manuais divergentes | Gerar/validar DTO contra composição real; W2-002/004/008. |
| 8 | Superfície declarada difere da aplicação montada | Manifesto e smoke production; API-036. |
| 9 | Configuração/consentimento persistidos em memória | Persistência obrigatória e teste multi-réplica; API-019/020. |
| 10 | CI e deployment de workspaces antigos | Atualizar matriz/artifacts e congelar lockfile; API-038/045. |
