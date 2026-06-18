# ADR 0001 (commerce) — Estados de carregamento de pedidos/envios e formatação de moeda

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Commerce), Produto, Plataforma
- **Relacionado:** [ADR 0013 — Commerce/Shopify sync hardening](../../../../../../../docs/architecture/adr/0013-commerce-shopify-sync-hardening.md), [ADR 0014 — Shipping engine hardening](../../../../../../../docs/architecture/adr/0014-shipping-engine-hardening.md), [ADR 0024 — Dashboard config/preview/onboarding](../../../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md), [ADR 0009 — Platform P0 hardening](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md). Origem: diagnóstico read-only do `apps/dashboard` (orders-shipments-page.tsx) cruzado com `commerce` e `packages/shared-types` (`TenantOrder`).

## Contexto

O módulo `commerce` é dono de pedidos e envios do tenant (`TenantOrder`, com
`total` em minor units). A página de Pedidos/Envios lista esses registros numa
tabela e formata totais e datas.

Portas/fluxos chave consumidos pelo dashboard:
- **listagem de pedidos/envios** — tabela com loading/empty/error.
- **formatMinor** — formata `TenantOrder.total` (minor units) com a moeda do pedido.

Invariantes que o módulo deve sustentar:
- distinguir loading, empty (tenant sem pedidos) e error na render.
- formatação de moeda correta por número de casas decimais da moeda
  (zero-decimal vs duas casas).

## Decisão

Separar loading/empty/error na tabela e corrigir a formatação de moeda:

- adicionar flag `hasLoaded`/`loading`, renderizar linha de loading enquanto busy
  e antes da primeira resposta, e suprimir a linha de empty-state em erro;
- usar metadados de minor-unit de moeda (`Intl` / expoente por moeda) em vez de
  `/100` hardcoded.

## Melhorias para produção

### Segurança
- `merchant_id`/escopo sempre do contexto de tenant (ADR 0005/0009).

### Desacoplamento
- Helper de formatação de moeda compartilhado, ciente de zero-decimal.

### Persistência & Consistência
- N/A direto (leitura); `total` permanece em minor units no contrato.

### Observabilidade
- Em erro, banner distinto; tabela não mostra empty-state que confunde com "sem dados".

### Otimização & Escala
- Paginação da listagem se a contagem crescer.

### Features faltantes
- Suporte multi-moeda correto na UI (zero-decimal: JPY/KRW).

## Bugs diagnosticados e remediação decidida

### BUG-COM-1 (P2, funcional) — `OrdersShipmentsPage` sem estado de loading distinto → empty-state aparece durante o load
- **Arquivo:** `apps/dashboard/src/pages/orders-shipments-page.tsx:16-34`
- **Causa raiz:** `load()` seta `busy` durante o fetch, mas a tabela renderiza a
  linha de empty-state ("Nenhum envio encontrado") durante o load inicial antes
  dos dados chegarem, porque não há flag de loading separada do resultado vazio.
  Em erro, o banner aparece mas a tabela ainda mostra a linha de empty-state,
  confundindo "erro" com "sem dados". (Mesmo padrão em `customers-page.tsx` — ver
  ADR de buyer-purchase-history.)
- **Impacto:** o usuário vê brevemente "nenhum pedido/envio" a cada load e não
  distingue tenant vazio de fetch falho/em andamento.
- **Remediação decidida:** adicionar flag `hasLoaded`/`loading`; renderizar linha
  de loading enquanto busy e antes da primeira resposta, e suprimir a linha de
  empty-state em erro.
- **Contrato/migração:** sem mudança de contrato/migração (correção de cliente).

### BUG-COM-2 (P3, dados) — `formatMinor` assume moeda integer-minor; moedas zero-decimal (JPY/KRW) divididas por 100 erradamente
- **Arquivo:** `apps/dashboard/src/pages/orders-shipments-page.tsx:112-117`
- **Causa raiz:** `formatMinor` divide `value/100` incondicionalmente e formata
  com a moeda do pedido. `TenantOrder.total` é minor units, mas moedas zero-decimal
  (JPY, KRW) não são `/100`, então valores aparecem 100x menores para essas moedas.
- **Impacto:** totais de pedido incorretos para moedas zero-decimal. Provavelmente
  latente (foco em BRL), mas é bug de correção para tenants multi-moeda.
- **Remediação decidida:** usar metadados de minor-unit de moeda do `Intl` (ou um
  expoente por moeda) em vez de `/100` hardcoded.
- **Contrato/migração:** sem mudança de contrato/migração (correção de cliente).

### BUG-COM-3 (P3, validação) — `formatDate` produz "Invalid Date" para datas ausentes/malformadas
- **Arquivo:** `apps/dashboard/src/pages/orders-shipments-page.tsx:119-124` (mesmo padrão em `customers-page.tsx` — ver ADR de buyer-purchase-history)
- **Causa raiz:** `formatDate(value)` faz `new Date(value)` sem checagem de
  validade. Datas vêm direto da API; um valor null/vazio/malformado renderiza
  "Invalid Date".
- **Impacto:** células "Invalid Date" visíveis quando a API omite/malforma timestamps.
- **Remediação decidida:** guardar com `Number.isNaN(date.getTime())` e cair para '-'.
- **Contrato/migração:** sem mudança de contrato/migração (correção de cliente).

## Alternativas consideradas
- **`/100` hardcoded "porque tudo é BRL".** Rejeitado: incorreto para multi-moeda.
- **Manter empty-state durante load.** Rejeitado: confunde tenant vazio com
  loading/erro.

## Consequências
**Positivas:** UI distingue loading/empty/error; totais corretos multi-moeda;
sem "Invalid Date".
**Negativas/riscos:** mínimos; estados de UI adicionais a manter.

**Barra de aceite:** load não mostra empty-state prematuro; totais corretos para
JPY/KRW; datas ausentes caem para '-'.
