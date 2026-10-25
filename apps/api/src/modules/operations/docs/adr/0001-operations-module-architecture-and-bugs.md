# ADR 0001 (operations) — Arquitetura do módulo operations e correções de cancelamento/read-model

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Operations), Plataforma, Segurança
- **Relacionado:** [ADR 0003](../../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0010](../../../../../../../docs/architecture/adr/0010-checkout-pilot-path-hardening.md), [ADR 0011](../../../../../../../docs/architecture/adr/0011-payment-hardening.md), [ADR 0013](../../../../../../../docs/architecture/adr/0013-commerce-shopify-sync-hardening.md), [ADR 0017](../../../../../../../docs/architecture/adr/0017-integrations-api-keys-webhooks.md), [ADR 0028](../../../../../../../docs/architecture/adr/0028-merchant-console-integration-api-v1.md). Código: `apps/api/src/modules/operations/**`.

## Contexto

`operations` é o read-model + comandos do console de operações sobre pedidos, clientes e pagamentos. Três controllers (`OrdersController`, `CustomersController`, `PaymentsController`) atrás de `TenantCredentialGuard` + `TenantAccessGuard` com `serviceScopes` (`orders:*`, `customers:read`, `payments:read`, `tracking:*`). Mutações marcadas `@Idempotent()`.

Camadas:
- **Application (read):** `ListOrdersUseCase`, `GetOrderUseCase`, `ListCustomersUseCase`, `GetCustomerUseCase`, `ListPaymentsUseCase`, `GetPaymentUseCase`, com paginação por cursor (`OperationsCursor`).
- **Application (command):** `CancelOrderUseCase` (porta de commerce + `OrderRepository.cancelCompletedOrder` + webhook `order.cancelled`), `CreateOrderFromPaymentUseCase` (delega ao `CompleteOrderUseCase` do checkout — dependência cross-context).
- **Domain:** port `OperationsReadRepository`.
- **Infrastructure:** `PrismaOperationsReadRepository` (queries raw sobre `checkout_sessions`, orders, payments).

**Invariantes:**
1. Toda query/comando escopado por `merchant_id` autenticado (ADR 0005/0009).
2. Efeito colateral em provider externo (commerce) é idempotente e nunca deixa estado local divergente sem compensação (ADR 0003/0013).
3. `firstSeenAt` = primeiro contato do cliente; list e detail devem concordar (contrato do console, ADR 0028).
4. Conclusão de pedido a partir de pagamento é idempotente por `external_order_id` (ADR 0010).

## Decisão

Tornar o cancelamento **local-first + idempotente cross-request** e corrigir a semântica de `firstSeenAt` no read-model. Concretamente:

- `CancelOrderUseCase` commita a cancelação local primeiro (update condicional `status='approved'`) e emite a cancelação no provider como efeito at-least-once via outbox/publisher com chave de idempotência derivada do `order_id` (ADR 0003).
- `listCustomers` calcula `MIN(created_at)` por `global_user_id` para `firstSeenAt`, alinhando com `getCustomer`.

## Bugs encontrados e remediação decidida

### P1 — `CancelOrderUseCase` chama o provider antes do commit local e sem idempotência cross-request
- **Arquivo:** `application/order-command.use-cases.ts:51-76`.
- **Causa raiz:** `this.commerce.cancelOrder` é invocado antes do write local `orders.cancelCompletedOrder`. A única idempotência é o `@Idempotent()` do controller, que chaveia no header `Idempotency-Key` — dois cancels concorrentes (ou retry sem a mesma chave) leem `status 'approved'`, ambos chamam o provider e ambos tentam o cancel local. Se `cancelCompletedOrder` retorna `undefined` após a chamada do provider, lança `NotFoundException` com o provider já cancelado.
- **Impacto:** dupla cancelação no provider e estado inconsistente quando o provider cancela mas o commit local falha (provider cancelado, pedido local ainda `approved`). Sem caminho de compensação. Quebra invariante 2.
- **Remediação:** commitar o cancel local primeiro (transação/outbox) e emitir a cancelação do provider via outbox/webhook com idempotency key por `order_id`; guardar contra concorrência com update condicional (`cancel only if status='approved'`); tratar a chamada do provider como side effect at-least-once com dedup. **Não precisa de mudança de contrato.** Recomenda-se outbox (ADR 0003) — sem migração de schema obrigatória, mas requer chave de dedup no provider.

### P2 — `listCustomers.firstSeenAt` é o `created_at` da sessão mais recente, não a mais antiga
- **Arquivo:** `infrastructure/prisma-operations-read.repository.ts:156-174`.
- **Causa raiz:** a subquery `DISTINCT ON (global_user_id) ... ORDER BY updated_at DESC` retorna a sessão **mais recente** por comprador, e `toCustomerSummary` mapeia o `created_at` dessa linha para `firstSeenAt`. `getCustomer` (detail) consulta o `createdAt` mais antigo separadamente, então list e detail divergem.
- **Impacto:** lista mostra data de primeiro-contato incorreta (data da última sessão, não do primeiro contato); o mesmo cliente reporta `firstSeenAt` diferente em list vs detail — inconsistência de correção de dados/contrato no console de ops. Quebra invariante 3.
- **Remediação:** computar `MIN(created_at)` por `global_user_id` no agregado (subquery agregada ou window function) e mapear para `firstSeenAt`, casando com a semântica do detail. **Não precisa de contrato nem migração** (mudança de query).

## Melhorias para produção

### Segurança
- `merchant_id` sempre do contexto de tenant (ADR 0005/0009); guards e escopos já presentes nos três controllers.

### Desacoplamento
- Cancelação do provider via porta `CommerceOrderPort` emitida por outbox (ADR 0003/0013), não inline no caminho de request; `CreateOrderFromPaymentUseCase` mantém a conclusão dirigida por `CompleteOrderUseCase` (ADR 0010).

### Persistência & Consistência
- Cancel local-first com update condicional `status='approved'`; provider como side effect at-least-once com idempotency key por `order_id`; `firstSeenAt` = `MIN(created_at)`.

### Observabilidade
- Logs com `correlation_id` + `merchant_id` + `order_id`; métricas de cancelamentos, dupla-cancelação evitada e divergência local↔provider.

### Otimização & Escala
- Índices por `merchant_id` nas queries quentes; `firstSeenAt` via agregado para evitar segunda consulta no detail.

### Features faltantes
- Reconciliação pedido↔provider↔pagamento; runbook de compensação de cancel; teste de restart com cancel parcial.

## Alternativas consideradas
- **Confiar só no `@Idempotent()` do header.** Rejeitado: não cobre cancels concorrentes com chaves distintas nem retry sem a mesma chave.
- **Chamar o provider primeiro e reverter no erro local.** Rejeitado: reverter cancel no provider nem sempre é possível; local-first + outbox é mais seguro.

## Consequências
**Positivas:** cancelamento consistente e idempotente; read-model correto e coerente entre list e detail.
**Negativas/riscos:** mudar para local-first + outbox aumenta superfície de teste (dispatcher, dedup do provider) e introduz latência percebida na cancelação (mitigada pelo dispatcher, ADR 0003).

**Barra de aceite:** cancels concorrentes resultam em uma única chamada ao provider e estado local consistente; falha do commit local não deixa provider cancelado órfão; `firstSeenAt` igual em list e detail em banco real.
