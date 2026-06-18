# ADR 0001 (catalog) — Catalog: leitura de catálogo do storefront e add-to-cart

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Catalog), Plataforma
- **Relacionado:** [ADR 0002](../../../../../../../docs/architecture/adr/0002-acl-pattern-cross-context.md), [ADR 0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0010](../../../../../../../docs/architecture/adr/0010-checkout-pilot-path-hardening.md), [ADR 0013](../../../../../../../docs/architecture/adr/0013-commerce-shopify-sync-hardening.md). Invariantes: `CLAUDE.md` (`merchant_id` de tenant; matemática de carrinho determinística; Prisma como única persistência).

## Contexto

O módulo `catalog` expõe leitura de catálogo do storefront e adiciona itens ao
carrinho da sessão de checkout. Responsabilidades atuais:

- **Use-cases:** `SearchStorefrontProductsUseCase` e `AddStorefrontItemUseCase`
  (carrega sessão, resolve produto pelo catálogo ou cross-sell, atualiza o
  carrinho, persiste a sessão e anexa um turn de chat do agente).
- **Porta/adapter:** `STOREFRONT_CATALOG_PORT` →
  `TenantStorefrontCatalogAdapter`, que delega ao `commerce` (ACL, ADR 0002)
  via `COMMERCE_CATALOG_PORT`.
- **Controllers:** `CatalogController` (autenticado por `TenantCredentialGuard`
  + `TenantAccessGuard`, `merchant_id` do principal de tenant) e
  `widget-catalog.controller`.

Invariantes que o módulo deve sustentar: toda leitura/escrita escopada por
`merchant_id` (ADR 0005); matemática de carrinho determinística; persistência
só via Prisma; nenhuma mutação de estado de sessão fora de um write consistente.

## Decisão

Tornar o add-to-cart seguro sob concorrência e atômico:

- a atualização do carrinho usa **version/ETag** (ou update atômico) no
  agregado de sessão, em vez de read-modify-write sem trava;
- itens são construídos como **novos objetos**, sem mutar o item carregado in
  place;
- a escrita do carrinho e a do turn de chat são combinadas num **único write
  transacional**.

## Bugs registrados nesta análise

### P2 — `AddStorefrontItem` é um read-modify-write com mutação de item in place
- **Classificação:** concorrência. **Precisa de ADR:** não (registrado aqui).
- **Arquivos:** `application/add-storefront-item.use-case.ts:29-51,84-86`.
- **Causa-raiz:** `getSession` seguido de `saveSession` sem optimistic
  locking/version check; chamadas concorrentes de add-to-cart sobrescrevem umas
  às outras (lost updates). `addCatalogItem` faz shallow-copy do array de itens
  mas muta o objeto do item existente in place (`existing.quantity += quantity`),
  podendo alterar o objeto de sessão originalmente carregado. `saveSession`
  (carrinho) e `appendChatTurn` também são dois writes separados (não atômicos).
- **Impacto:** adds concorrentes/rápidos perdem atualizações de quantidade; o
  turn de chat e o carrinho podem divergir se um write falhar. Corrupção sutil
  de dados sob carga.
- **Remediação decidida:** usar version/ETag ou update atômico no agregado de
  sessão; construir novos objetos de item em vez de mutar os carregados;
  combinar a persistência de carrinho + chat num único write transacional.

## Melhorias para produção

### Segurança
- `merchant_id` sempre do principal de tenant, nunca do body (ADR 0005/0009);
  leitura de catálogo via ACL `commerce` (ADR 0002/0013).

### Desacoplamento
- Catálogo permanece atrás de `STOREFRONT_CATALOG_PORT`; sem acesso direto ao
  provider.

### Persistência & Consistência
- Optimistic locking na sessão; write atômico de carrinho + chat turn; sem
  mutação in place do agregado carregado.

### Observabilidade
- Logs com `correlation_id` + `merchant_id` + `session_id`; métrica de
  lost-update/conflito de versão.

### Otimização & Escala
- Paginação/limite já presentes na busca (`clampLimit`); cache de catálogo por
  tenant a avaliar.

### Features faltantes
- Teste de concorrência de add-to-cart; reconciliação carrinho↔chat em falha
  parcial.

## Alternativas consideradas
- **Manter read-modify-write sem versão.** Rejeitado: lost updates sob
  concorrência (ADR 0010).
- **Persistir carrinho e chat em dois writes independentes.** Rejeitado:
  divergência em falha parcial.

## Consequências
**Positivas:** add-to-cart consistente sob carga; sessão e chat sempre
coerentes. **Negativas/riscos:** introduz controle de versão no agregado de
sessão (coordenação com `checkout`); possível retry em conflito.

**Barra de aceite:** teste de adds concorrentes sem perda de quantidade;
carrinho + chat turn persistidos atomicamente; nenhuma mutação do objeto de
sessão carregado; cross-tenant negado na leitura de catálogo.
