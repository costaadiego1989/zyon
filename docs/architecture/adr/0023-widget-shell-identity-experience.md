# ADR 0023 — Widget: shell/embed, chat, auth-hub, support, tema, acessibilidade e SDK

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia (Widget), Produto, Acessibilidade
- **Relacionado:** [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md), [ADR 0012](./0012-embed-security-hardening.md), [ADR 0016](./0016-merchant-config-surface-hardening.md), [ADR 0018](./0018-buyer-identity-and-history.md), [ADR 0025](./0025-packages-engines-sdk-hardening.md). Baseline: `.specs/maturity/widget-shell-embed.md`, `widget-chat-collection.md`, `widget-auth-buyer-hub.md`, `widget-support.md`, `widget-theme-responsiveness.md`, `widget-accessibility.md`, `widget-contracts-sdk.md`.

## Contexto

Capacidades não-transacionais do widget, em sua maioria **P2**:

- `shell-embed` — **L2**; `chat-collection` — **L2**;
  `support-widget` — **L2**; `theme-responsiveness` — **L2**;
  `contracts-sdk` — **L2**;
- `auth-buyer-hub` — **L1–L2**; `accessibility` — **L1–L2** (os dois mais
  baixos deste grupo).

Requisitos adicionais do widget para L3 (ADR 0007): responsividade,
acessibilidade e estabilidade de embed/reload. O chat deve respeitar as
invariantes (`isSafeGeneratedMessage`, sem promessa de
desconto/frete/estoque/pagamento não autorizado).

## Decisão

- Levar essas capacidades a L3 (widget): shell/embed estável sob reload e
  múltiplos hosts; chat com guardrails e fallback determinístico; auth/buyer
  hub seguro (ADR 0018) e a11y conforme baseline; tema responsivo dirigido
  por `checkout-settings`/tema (ADR 0016); SDK/contratos tipados estáveis
  (`@aacp/shared-types`, ADR 0025).

## Melhorias para produção

### Segurança
- Token de embed válido em todas as chamadas (ADR 0012); sessão de buyer
  segura (ADR 0018); chat nunca afirma oferta não autorizada; sem segredo
  no bundle.

### Desacoplamento
- Toda comunicação via SDK/contratos versionados; UI desacoplada de
  detalhes de transporte.

### Persistência & Consistência
- Estado de sessão de buyer consistente entre reloads; cache de tema/config
  invalidado por evento de config (ADR 0016).

### Observabilidade
- Telemetria de abertura, engajamento de chat, erros de render; sem PII
  sensível.

### Otimização & Escala
- Bundle enxuto; lazy-load; responsividade e a11y (foco, ARIA, contraste,
  teclado) verificadas por testes.

### Features faltantes
- Acessibilidade até o baseline L3; estabilidade de reload do embed;
  cobertura de SDK/contratos.

## Alternativas consideradas
- **Tratar a11y como pós-piloto.** Rejeitado: é requisito L3 do widget no
  ADR 0007.
- **Chat sem validação de mensagem.** Rejeitado: viola invariante.

## Consequências
**Positivas:** experiência estável, acessível e segura do widget.
**Negativas/riscos:** a11y e responsividade ampliam escopo de teste
(Playwright mocked/realapi).

**Barra de aceite:** DoD L3 (widget) + suíte de regressão e a11y verdes.
