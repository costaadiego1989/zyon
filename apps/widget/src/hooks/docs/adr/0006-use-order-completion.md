# ADR 0006 (widget/hooks) — `use-order-completion`: efeitos colaterais de conclusão e disclosure via postMessage

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Widget), Segurança
- **Relacionado:** [ADR 0005](../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0012](../../../../../../docs/architecture/adr/0012-embed-security-hardening.md), [ADR 0018](../../../../../../docs/architecture/adr/0018-buyer-identity-and-history.md), [ADR 0022](../../../../../../docs/architecture/adr/0022-widget-transactional-path.md). Módulos irmãos: [`use-checkout-session`](./0002-use-checkout-session.md), [`use-global-auth`](./0003-use-global-auth.md).

## Contexto

`use-order-completion.ts` executa, uma vez por pedido concluído, os efeitos
colaterais de finalização: snapshot de confirmação, reset de carrinho/chat/
painéis/pré-pagamento, limpeza da sessão persistida, emissão do evento
`order_completed` ao shell e ao frame pai, e refresh do buyer-hub.

- **Efeito de conclusão** — dispara quando `checkoutStage === "completed"` e
  `orderCompletionHandled.current` ainda é falso.
- **`window.parent.postMessage`** — notifica o storefront embarcador com
  `{ type: "aacp:order-completed", merchant_id, session_id }`.
- **Login a partir do checkout + refresh do hub** — após 600ms.

**Portas:** `emitCheckoutEvent` (shell), callbacks de reset, `loginFromCheckout`,
`refreshBuyerHub`.

**Invariantes que o módulo deve manter:**

1. Payloads com `merchant_id`/`session_id` só são revelados a origens confiáveis
   (storefront do merchant — ADR 0012).
2. Os efeitos de conclusão rodam **uma vez por pedido**, e re-armam para um
   segundo pedido no mesmo mount.

## Decisão

Restringir o `targetOrigin` do `postMessage` e re-armar o guard de conclusão por
pedido.

### Bugs verificados e remediação

| Severidade | Falha | Causa raiz | Remediação decidida | Contrato/migração |
|---|---|---|---|---|
| **P2** | `postMessage` para origem wildcard vaza identificadores de sessão/tenant (66–75) | `window.parent.postMessage({ merchant_id, session_id }, "*")` usa target origin curinga. O payload de conclusão é entregue a qualquer frame que embarque o widget. | Passar a origem conhecida do storefront do merchant (de `config.storeUrl`) como `targetOrigin` em vez de `"*"`. | Não (usa `storeUrl` já presente na config; ver [`merchant-embed-config`](../../../lib/docs/adr/0001-merchant-embed-config.md)). |
| **P2** | Efeitos de conclusão disparam só uma vez por mount do widget (47–83) | O ref `orderCompletionHandled` é setado `true` e nunca resetado, mesmo com carrinho/chat/sessão resetados para uma possível compra subsequente. Um segundo pedido no mesmo mount de longa duração não roda a conclusão (sem snapshot de confirmação, sem refresh do buyer-hub). | Resetar `orderCompletionHandled` quando `stage` sai de `"completed"` (ou ao iniciar nova sessão), re-armando o guard por pedido. | Não. |

## Melhorias para produção

### Segurança
- `postMessage` com `targetOrigin` igual ao storefront do merchant; nenhum
  identificador entregue a frame arbitrário (ADR 0012).

### Desacoplamento
- Conclusão dirigida por `checkoutStage`; efeitos injetados por callback.

### Persistência & Consistência
- Guard re-armável por pedido; sessão persistida limpa na conclusão.

### Observabilidade
- Evento `order_completed` emitido ao shell e ao pai (origem restrita).

### Otimização & Escala
- Suporta múltiplos pedidos por mount sem recarregar o widget.

### Features faltantes
- Fallback quando `storeUrl` ausente (não emitir ou usar origem do referrer
  validado), evitando regressão de funcionalidade no embarque.

## Alternativas consideradas
- **Manter `"*"` e filtrar no embarcador.** Rejeitado: o vazamento ocorre no
  envio; o controle deve ser na origem (ADR 0012).
- **Desmontar/remontar o widget por pedido.** Rejeitado: custo de UX; re-armar
  o guard é suficiente.

## Consequências
**Positivas:** sem disclosure cross-origin; múltiplos pedidos por mount.
**Negativas/riscos:** depende de `storeUrl` correto na config.

**Barra de aceite:** `postMessage` só entrega ao `storeUrl` do merchant; segundo
pedido no mesmo mount roda snapshot + refresh do hub.
