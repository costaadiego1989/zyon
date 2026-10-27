# ADR 0001 (buyer-purchase-history) — Estados de carregamento de clientes e datas seguras

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Buyer), Produto, Plataforma
- **Relacionado:** [ADR 0018 — Buyer identity e history](../../../../../../../docs/architecture/adr/0018-buyer-identity-and-history.md), [ADR 0024 — Dashboard config/preview/onboarding](../../../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md), [ADR 0009 — Platform P0 hardening](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md). Origem: diagnóstico read-only do `apps/dashboard` (customers-page.tsx) cruzado com `buyer-purchase-history`/`buyer-account` e `packages/shared-types` (`TenantCustomer`).

## Contexto

O módulo `buyer-purchase-history` (com `buyer-account`) é dono do read-model de
clientes do tenant (`TenantCustomer`, cujo `profile` é `Record<string,unknown>` e
cujo `last_seen_at` pode estar ausente). A página de Clientes lista esses
registros e formata datas como `last_seen_at`/`completed_at`.

Portas/fluxos chave consumidos pelo dashboard:
- **listagem de clientes** — tabela com loading/empty/error.
- **formatDate** — formata timestamps possivelmente ausentes/malformados.

Invariantes que o módulo deve sustentar:
- distinguir loading, empty (tenant sem clientes) e error na render.
- timestamps ausentes/malformados degradam para '-', não "Invalid Date".

## Decisão

Separar loading/empty/error na tabela e proteger a formatação de datas:

- adicionar flag `hasLoaded`/`loading`, renderizar linha de loading enquanto busy
  e antes da primeira resposta, e suprimir a linha de empty-state em erro;
- guardar `formatDate` com `Number.isNaN(date.getTime())` e cair para '-'.

## Melhorias para produção

### Segurança
- `merchant_id`/escopo sempre do contexto de tenant (ADR 0005/0009); `profile`
  (`Record<string,unknown>`) tratado como dado não confiável na render.

### Desacoplamento
- Helper de data seguro compartilhado entre Clientes e Pedidos/Envios.

### Persistência & Consistência
- N/A direto (leitura); `last_seen_at` permanece opcional no contrato.

### Observabilidade
- Em erro, banner distinto; tabela não mostra empty-state que confunde com "sem dados".

### Otimização & Escala
- Paginação da listagem se a contagem crescer.

### Features faltantes
- Helper de data seguro como utilitário compartilhado do dashboard.

## Bugs diagnosticados e remediação decidida

### BUG-BPH-1 (P2, funcional) — `CustomersPage` sem estado de loading distinto → empty-state aparece durante o load
- **Arquivo:** `apps/dashboard/src/pages/customers-page.tsx:24-43`
- **Causa raiz:** `load()` seta `busy` durante o fetch, mas a tabela renderiza a
  linha de empty-state durante o load inicial antes dos dados chegarem, porque não
  há flag de loading separada do resultado vazio. Em erro, o banner aparece mas a
  tabela ainda mostra empty-state, confundindo "erro" com "sem dados". (Mesmo padrão
  em `orders-shipments-page.tsx` — ver ADR de commerce.)
- **Impacto:** o usuário vê brevemente "nenhum cliente" a cada load e não distingue
  tenant vazio de fetch falho/em andamento.
- **Remediação decidida:** adicionar flag `hasLoaded`/`loading`; renderizar linha
  de loading enquanto busy e antes da primeira resposta, e suprimir a linha de
  empty-state em erro.
- **Contrato/migração:** sem mudança de contrato/migração (correção de cliente).

### BUG-BPH-2 (P3, validação) — `formatDate` produz "Invalid Date" para `last_seen_at`/`completed_at` ausentes/malformados
- **Arquivo:** `apps/dashboard/src/pages/customers-page.tsx:122-127`
- **Causa raiz:** `formatDate(value)` faz `new Date(value)` sem checagem de
  validade. `last_seen_at`/`completed_at` vêm direto da API; como `TenantCustomer.profile`
  é `Record<string,unknown>` e `last_seen_at` pode estar ausente, um valor
  null/vazio/malformado renderiza "Invalid Date".
- **Impacto:** células "Invalid Date" visíveis quando a API omite/malforma timestamps.
- **Remediação decidida:** guardar com `Number.isNaN(date.getTime())` e cair para '-'.
- **Contrato/migração:** sem mudança de contrato/migração (correção de cliente).

## Alternativas consideradas
- **Manter empty-state durante load.** Rejeitado: confunde tenant vazio com
  loading/erro.
- **Confiar que a API sempre manda data válida.** Rejeitado: `last_seen_at` é
  opcional no contrato; render deve degradar com segurança.

## Consequências
**Positivas:** UI distingue loading/empty/error; sem "Invalid Date".
**Negativas/riscos:** mínimos; estados de UI adicionais a manter.

**Barra de aceite:** load não mostra empty-state prematuro; datas ausentes caem
para '-'.
