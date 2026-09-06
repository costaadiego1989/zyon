# Arquitetura real e decisão do monólito modular

**Decisão: manter o monólito modular e corrigir fronteiras em incrementos.** Não há evidência de que microserviços ou RabbitMQ resolvam os bloqueadores observados.

## Mapa

API NestJS/TypeScript; persistência Prisma/PostgreSQL; Redis para cache/limites e BullMQ em sincronização do marketplace; outbox SQL com polling; integrações externas de pagamento, frete, comércio, mensagens e AI. Dashboard React/Vite; storefront Next/React; widget_v2 React/Vite/Zustand. Há tipos/pacotes compartilhados, mas os clients ainda mantêm vários contratos manuais.

`AppModule` alcança 54 classes de módulo. Grafo de composição e declarações HTTP são estáticos: fábricas, guards, credenciais e inicialização completa não foram executados. O caminho de /v1 passa pelo mesmo roteamento após remoção do prefixo.

`public-api` é camada de adapters; `dashboard` é composição parcial; `knowledge-base` não tem implementação TS ativa identificada. CrossSellModule, SelfCheckoutModule e ScrapingAgentModule não entram na raiz. O widget antigo removido não representa o frontend atual.

`checkout` cruza payment, merchant, buyer, experiments, marketplace, notifications, inventory, shipping e outras capacidades. Isso amplia o custo de testar efeitos e corrigir contratos. O manifesto de imports nos ADRs inclui referências de tipo, não apenas chamadas runtime.

## Dez regras do monólito modular

| Regra | Resultado | Evidência e consequência |
| --- | --- | --- |
| 1. Capacidade de negócio por módulo | PARTIAL | Muitos diretórios representam negócio; public-api/dashboard são adapters/composição e payment reúne billing e cobrança de pedidos. Nomear explicitamente esse papel. |
| 2. Boundary explícito | FAIL | Há portas, mas controllers/use cases acessam Prisma e classes concretas de outros domínios; ver checkout, marketplace, support e inventory. |
| 3. Não acessar banco de outro módulo | FAIL | Prisma compartilhado permite consulta intermodular sem barreira; ownership de estoque se divide entre catalog/inventory/ERP e dados de buyer são hidratados pelo checkout. |
| 4. Dependências controladas | FAIL | Ciclos forwardRef e alto fan-out em checkout/payment/commerce/integrations; impor regras automáticas de imports e faixas de dependência. |
| 5. Intenção síncrona/assíncrona clara | FAIL | Outbox, event bus, BullMQ, setInterval e void Promise coexistem com garantias diferentes; API-016/024/026. |
| 6. Transações delimitadas | FAIL | CompleteOrder possui caminho transacional, mas coupon/fulfillment/onboarding/audit e efeitos externos têm lacunas de atomicidade. |
| 7. Dono único do estado | FAIL | MerchantUser versus MerchantTeamMember, carrinho storefront versus checkout, catálogo estoque versus inventory; API-011/017 e W2-001/007. |
| 8. Eventos não expõem implementação | PARTIAL | Envelope comum contém event_id, schema_version, tenant e correlation; fila de catálogo descarta identidade/versão e handlers dependem de reconsultar estado. |
| 9. Entendimento isolado | FAIL | Orquestradores extensos, stores manuais e métodos com 10+ dependências exigem conhecer outros agregados para avaliar efeitos. |
| 10. Continuar monólito | KEEP | Um banco/aplicação ainda serve ao modelo. Isolar políticas/ports/jobs internamente e validar antes de qualquer separação física. |

## Concentração de responsabilidades

| Classe | Linhas | Parâmetros de construtor | Fonte |
| --- | --- | --- | --- |
| StorefrontConversationAdapter | 892 | 7 | `apps/api/src/modules/storefront/infrastructure/adapters/storefront-conversation.adapter.ts:27` |
| StorefrontLangGraphAgent | 727 | 1 | `apps/api/src/modules/storefront/infrastructure/agents/store-langgraph-agent.ts:101` |
| PrismaCheckoutRepository | 491 | 1 | `apps/api/src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts:28` |
| SendChatMessageUseCase | 464 | 15 | `apps/api/src/modules/checkout/application/use-cases/send-chat-message.use-case.ts:43` |
| M2mController | 406 | 13 | `apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts:36` |
| StoreBuilderCatalogController | 395 | 15 | `apps/api/src/modules/catalog/presentation/http/catalog.controller.ts:22` |
| ConfigureWhatsAppUseCase | 394 | 1 | `apps/api/src/modules/whatsapp-channel/application/use-cases/configure-whatsapp.use-case.ts:42` |
| StorefrontController | 371 | 12 | `apps/api/src/modules/storefront/presentation/http/storefront.controller.ts:29` |
| ErpOAuthController | 307 | 1 | `apps/api/src/modules/inventory/presentation/http/erp-oauth.controller.ts:13` |
| OrdersController | 307 | 6 | `apps/api/src/modules/operations/presentation/http/operations.controller.ts:59` |
| IntegrationsController | 306 | 10 | `apps/api/src/modules/integrations/presentation/http/integrations.controller.ts:25` |
| PrismaAnalyticsRepository | 304 | 1 | `apps/api/src/modules/store-analytics/infrastructure/repositories/prisma-analytics.repository.ts:54` |

Limiares de 300 linhas/10 dependências são apenas triagem. Para cada candidato: extrair boundary/facade, mover uma política por vez, substituir acesso intermodular direto e adicionar teste de comportamento crítico. Não repartir classes só para reduzir número.

## SOLID, KISS, DRY e domínio

SRP: controllers e adapters extensos coordenam transportes, consultas e decisões comerciais; priorizar StorefrontConversationAdapter, SendChatMessageUseCase e M2mController. DIP: interfaces existem, mas há dependência concreta e DI opcional mascarando requisito essencial (API-017). ISP: portas amplas de checkout e repositories combinam múltiplos agregados. OCP: seleção de capacidades de pagamento/frete no widget é codificada manualmente e não acompanha os métodos da API. LSP: assinatura igual não assegura mesma garantia; repo in-memory substituindo persistência perde durabilidade e adapters que absorvem erros violam expectativa de entrega.

DRY: preço, frete, identificação do buyer, enums de estado, clients marketplace e canais de notificação têm fontes concorrentes. Centralizar política e DTO; evitar “utilitário universal” que concentre todos os domínios. KISS: um caminho de sessão/carrinho e um contrato de shipping/select reduzem complexidade com impacto direto. Object calisthenics é apoio de legibilidade, não gate para produção.

Agregados prioritários: PaymentIntent, checkout/order, reservation/stock, coupon/redemption, settlement/debt e return/refund. Definir chave de negócio, versão/CAS, dono de transação e idempotência externa. Valores monetários devem manter unidade inequívoca, não heurística de magnitude.

## Ownership proposto para correção

| Estado | Dono proposto | Consumidores por contrato |
| --- | --- | --- |
| Preço/SKU/catálogo | catalog ou adapter commerce autoritativo, com prioridade definida | checkout/storefront/widget recebem snapshot versionado |
| Estoque/reservas | inventory como saldo operacional, com facade de catalog | checkout/returns/ERP não decrementam diretamente |
| Sessão/carrinho pagável | checkout | storefront/widget mutam a mesma revisão |
| Captura/reembolso | payment e ledger financeiro | returns/marketplace solicitam comando e aguardam confirmação |
| Membership/roles | auth/team por fonte única de associação | Todos os guards consultam principal atual/revogável |
| Buyer autenticado | buyer-account | checkout usa token/OTP comprovado; reconhecimento é outro conceito |
| Entrega externa | notifications/integrations por canal | Outbox entrega comando idempotente, sem void com sucesso implícito |

Isto é proposta de boundary para discussão na correção, não mudança já aplicada. Não mover estoque/refund no mesmo refactor de UI.

## Fitness functions propostas

- Regra de imports impede domínio importar controller/repositório de outro módulo; exceções explícitas em arquitetura.
- Teste de composição valida providers obrigatórios e unicidade de método/path com guards.
- Contrato gerado da aplicação montada confronta client e OpenAPI.
- Testes de duas lojas cobrem recursos indiretos por ID e salas WebSocket.
- Invariantes financeiras/conservação de estoque rodam sob concorrência em PostgreSQL.
- Replay/crash prova idempotência de cada handler com efeito externo.

As notas por módulo estão em [api/README.md](api/README.md). Nenhuma nota substitui os gates de segurança, dinheiro e recuperação.
