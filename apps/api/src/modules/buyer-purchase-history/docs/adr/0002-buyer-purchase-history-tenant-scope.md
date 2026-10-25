# ADR 0002 (buyer-purchase-history) — Histórico de compras por merchant

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Identidade/Personalização), Segurança, Privacidade
- **Relacionado (ADRs centrais):** [ADR 0005](../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0018](../../../../../../docs/architecture/adr/0018-buyer-identity-and-history.md). Este ADR vive ao lado do código (decisão do time).

## Contexto

`buyer-purchase-history` materializa o histórico de compras do buyer **por
merchant**, usado para personalização (contexto de chat, hints de copy) e
metering.

### Responsabilidades
- `RecordCompletedPurchaseUseCase` — registra compra concluída (idempotente),
  emite evento de metering `purchase_history.imported_order`.
- `GetBuyerPurchaseContextUseCase` — devolve contexto seguro por
  `(merchantId, globalUserId)`; registra `purchase_history.context_used`.
- Entidade `BuyerPurchaseHistoryEntity` com `toSafeContext()`.

### Portas / contratos
- `BUYER_PURCHASE_HISTORY_REPOSITORY` (`getByBuyer`, `save`, `recordPurchase`) —
  in-memory e Prisma.
- `PURCHASE_HISTORY_METERING_PORT` (opcional).
- `BUYER_IDENTITY_REPOSITORY` para resolução de identidade.
- Controller `buyer-purchase-history.controller.ts` — protegido por `AuthGuard`
  de merchant; deriva `merchantId` de `currentUser(request)`.

### Invariantes que o módulo deve sustentar
- Acesso **merchant-scoped**: a leitura via controller é sempre filtrada pelo
  `merchant_id` do principal de merchant (CLAUDE.md, ADR 0018).
- `global_user_id` é global; o contexto exposto é por merchant.
- Sem PII desnecessária no contexto (`toSafeContext`).

## Decisão

Manter este módulo como o **guardião da invariante "histórico filtrado por
merchant"** no caminho merchant-scoped. O controller deriva `merchantId`
exclusivamente do `TenantPrincipal` (nunca do path/body), e a porta de
repositório só expõe leitura por `(merchantId, globalUserId)`.

A leitura **cross-merchant do próprio buyer** NÃO mora aqui: ela vive em
`buyer-account` (`GetBuyerPurchasesUseCase`, autenticada por
`BuyerJwtAuthGuard`) e tem política própria documentada no ADR 0001 de
`buyer-account` (B7). Assim a invariante deste módulo permanece estrita.

## Bugs encontrados e remediação decidida

Nenhum bug deste sweep tem origem **dentro** deste módulo. Os achados que
tocam histórico de compras vivem no caminho de `buyer-account`. Registramos
aqui o vínculo e a obrigação de regressão para proteger a invariante.

### B1 (relacionado) — Confusão de audiência de JWT habilita leitura cross-tenant aqui
- **Origem:** `auth/domain/services/jwt.service.ts:36-50` +
  `auth/presentation/auth.guard.ts:26-35` (ADR 0001 de `auth`, B1).
- **Efeito neste módulo:** o controller usa `AuthGuard` + `currentUser`. Com um
  token de buyer aceito pelo `verify` de merchant, `user.merchantId` é
  `undefined`, cai em `where:{ merchantId: undefined }` (descartado pelo Prisma)
  e a leitura de contexto vaza entre merchants.
- **Remediação:** a correção é em `auth` (rejeitar `aud:"buyer"` e exigir
  `merchant_id`). **Defesa local decidida:** asserir `merchantId` string
  não-vazia em `currentUser`/use-case antes de qualquer query, e teste
  cross-tenant pinando o comportamento.
- **Contrato/migração:** sem migração local; depende do contrato de segredo de
  `auth` (B1).

### B2 (relacionado) — Política cross-merchant do buyer (ADR 0018)
- **Origem:** `buyer-account/.../get-buyer-purchases.use-case.ts` (B7).
- **Efeito neste módulo:** a redação da invariante do ADR 0018 ("histórico
  sempre filtrado por merchant") passa a valer explicitamente para o acesso
  **merchant-scoped** deste módulo; o acesso buyer-próprio cross-merchant é
  carve-out documentado em `buyer-account`.
- **Remediação:** manter o filtro obrigatório aqui e adicionar teste que falha
  se o `merchantId` do principal não for aplicado.
- **Contrato/migração:** atualização de documentação de invariante (ADR 0018).

## Melhorias para produção

### Segurança
- Asserção de `merchant_id` não-vazio antes de qualquer query; teste
  cross-tenant negando leitura de histórico de outro merchant (B1).

### Desacoplamento
- Histórico consumido por porta (`BUYER_PURCHASE_HISTORY_REPOSITORY`); emitir
  `customer.upserted` para integrations via evento (ADR 0018).

### Persistência & Consistência
- `recordPurchase` idempotente por chave natural; consistência entre
  `global_user_id` e visão por merchant.

### Observabilidade
- Métricas de `context_used`/`imported_order`; log com `correlation_id` sem PII.

### Otimização & Escala
- Índices por `(merchant_id, global_user_id)`; paginação quando o histórico
  crescer.

### Features faltantes
- Retenção/exclusão de PII; consentimento; export (ADR 0018).

## Alternativas consideradas
- **Mover a leitura cross-merchant para cá.** Rejeitado: misturaria o caminho
  estrito merchant-scoped com a visão buyer-própria, enfraquecendo a invariante.
- **Confiar só no filtro do Prisma sem asserção de principal.** Rejeitado: foi
  exatamente o `merchantId: undefined` que permitiu o vazamento (B1).

## Consequências
**Positivas:** invariante de tenant explícita e testável; superfície pequena e
auditável.
**Negativas/riscos:** depende da correção de audiência de JWT em `auth` para
fechar o vetor cross-tenant.

**Barra de aceite:** E2E verde de leitura de contexto **negada** cross-merchant
e de `recordPurchase` idempotente.
