# ADR 0005 (widget/hooks) — `use-checkout-chat`: turnos de chat, ofertas autorizadas e aplicação de oferta

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Widget), Produto
- **Relacionado:** [ADR 0010](../../../../../../docs/architecture/adr/0010-checkout-pilot-path-hardening.md), [ADR 0019](../../../../../../docs/architecture/adr/0019-negotiation-and-support.md), [ADR 0020](../../../../../../docs/architecture/adr/0020-growth-cross-sell-coupons-fulfillment.md), [ADR 0022](../../../../../../docs/architecture/adr/0022-widget-transactional-path.md). Módulos irmãos: [`use-checkout-payment`](./0001-use-checkout-payment.md), [`use-voice-checkout`](./0004-use-voice-checkout.md).

## Contexto

`use-checkout-chat.ts` administra o histórico de turnos do chat, o streaming da
resposta do agente e a aplicação de ofertas autorizadas no caminho de checkout.

- **Envio de mensagem / bootstrap de e-mail** — POST `chat-message`; aplica a
  resposta via `applyTurnResponse`, controla `busy`/`composerLocked`.
- **`applyOfferById(offerId?)`** — aplica a oferta autorizada corrente via
  POST `apply-offer`, sincroniza a experiência e anexa o turno do agente.
- **`appendAgentTurn` / streaming** — superfície usada por outros hooks
  (pagamento, etc.) para inserir falas do agente.

**Portas:** `embed-client`, schemas de resposta de chat/oferta,
`CheckoutSessionState`.

**Invariantes que o módulo deve manter:**

1. O LLM nunca autoriza ofertas; desconto vem do `rules-engine` (CLAUDE.md / ADR 0010).
2. Uma oferta aplicada deve corresponder à `authorized_offer` corrente.
3. Telemetria/erros de rede não travam o chat sem feedback.

## Decisão

Tornar a resolução de oferta por id correta e não-enganosa, validando o
`offerId` contra a `authorized_offer` corrente.

### Bugs verificados e remediação

| Severidade | Falha | Causa raiz | Remediação decidida | Contrato/migração |
|---|---|---|---|---|
| **P3** | `applyOfferById` tem ramo ternário no-op (476–482) | Ambos os ramos da comparação de `offerId` resolvem para `lastChat.authorized_offer`, então a comparação de `offerId` é lógica morta. Um `offerId` que não corresponde à `authorized_offer` corrente é silenciosamente aplicado mesmo assim — código enganoso. | Validar `offerId` contra `lastChat.authorized_offer.id` e abortar (ou buscar a oferta correta) quando não corresponder. | Não. |

## Melhorias para produção

### Segurança
- Oferta aplicada só se autorizada pelo engine; UI não inventa desconto (ADR 0010).

### Desacoplamento
- Resposta de oferta/chat validada por schema (ADR 0025); UI não recalcula
  matemática de oferta.

### Persistência & Consistência
- `offerId` validado contra a oferta autorizada corrente antes do POST.

### Observabilidade
- Erro de rede já seta `setNetworkError`; adicionar log de mismatch de `offerId`.

### Otimização & Escala
- Streaming de turno mantém a UI responsiva.

### Features faltantes
- Lookup de oferta por id quando múltiplas ofertas autorizadas coexistirem.

## Alternativas consideradas
- **Manter o ternário no-op.** Rejeitado: lógica morta que mascara mismatch.

## Consequências
**Positivas:** aplicação de oferta correta e auditável.
**Negativas/riscos:** baixo; mudança local.

**Barra de aceite:** `applyOfferById` com `offerId` divergente da
`authorized_offer` corrente não aplica silenciosamente; happy path verde.
