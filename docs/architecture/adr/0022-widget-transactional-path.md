# ADR 0022 — Widget transacional: cart, card, pix, shipping e confirmation

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia (Widget), Segurança, Produto
- **Relacionado:** [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md), [ADR 0011](./0011-payment-hardening.md), [ADR 0014](./0014-shipping-engine-hardening.md), [ADR 0025](./0025-packages-engines-sdk-hardening.md). Baseline: `.specs/maturity/widget-cart.md`, `widget-card.md`, `widget-pix.md`, `widget-shipping.md`, `widget-confirmation.md`.

## Contexto

Capacidades transacionais do widget no caminho **P1**:

- `cart` — **L1 (critical)**, alvo L3.
- `card` — **L1 (critical)**, alvo L3.
- `pix` — **L2**, alvo L3.
- `shipping-widget` — **L2**, alvo L3.
- `confirmation` — **L2**, alvo L3.

Bloqueio crítico verificado (P0.8): `CardForm`
(`apps/widget/src/components/checkout/CardForm.tsx`) coleta e envia PAN/CVV
ao backend (`cvv` na linha 104, `ccv: cvv` na linha 164), com texto "Dados
transmitidos com criptografia TLS · Checkout transparente via Asaas"
(linha 305). Isso é proibido para produção sem tokenização provider-side.
`cart` e `card` são os dois pontos `(critical)` em L1 — maior risco do
caminho do piloto no widget.

## Decisão

- **Cartão:** substituir o `CardForm` que envia PAN/CVV por **tokenização
  provider-side** (Asaas tokenizado/Stripe Elements), de modo que o widget
  nunca transmita PAN/CVV ao backend AACP (ADR 0011/P0.8). Confirmação só
  por webhook.
- **Cart/shipping/pix/confirmation** a L3: estado de carrinho consistente,
  cotação de frete sincronizada com a validade do `shipping` (ADR 0014),
  pix com tratamento de expiração, confirmação dirigida por estado real do
  pagamento (webhook), não otimista.

## Melhorias para produção

### Segurança
- Sem PAN/CVV no cliente→backend AACP (P0.8); validação de input; token de
  embed válido (ADR 0012); sem segredo no bundle.

### Desacoplamento
- Consumo via SDK/contratos tipados (`@aacp/shared-types`, ADR 0025); UI
  não decide desconto/frete (engines decidem).

### Persistência & Consistência
- Idempotência de submit de pagamento/checkout (evitar dupla cobrança);
  reconciliação de estado de cotação expirada; confirmação consistente com
  webhook.

### Observabilidade
- Telemetria de funil (cart→shipping→payment→confirmation); erros de
  pagamento; sem PII/PAN em telemetria.

### Otimização & Escala
- Estados de carregamento e retry idempotente; degradação graciosa quando
  provider/cotação indisponível.

### Features faltantes
- Integração de tokenização; UX de pix expirado; tela de confirmação
  baseada em estado real.

## Alternativas consideradas
- **Manter checkout transparente com PAN sob TLS.** Rejeitado (P0.8/PCI).
- **Confirmação otimista antes do webhook.** Rejeitado: pode confirmar
  pagamento não capturado.

## Consequências
**Positivas:** caminho de pagamento seguro e confiável no piloto.
**Negativas/riscos:** retrabalho de UI de cartão; dependência da
tokenização (ADR 0011).

**Barra de aceite:** DoD L3 (widget) + E2E realapi de happy path, provider
indisponível, pix expirado e ausência de PAN/CVV no tráfego ao backend.
