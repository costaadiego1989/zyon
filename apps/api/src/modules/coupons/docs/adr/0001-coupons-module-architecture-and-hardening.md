# ADR 0001 (coupons) — Arquitetura do módulo de cupons e hardening de autoridade de desconto

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Growth), Segurança, Plataforma
- **Relacionado:** [ADR 0003](../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0004](../../../../../../docs/architecture/adr/0004-prisma-isolation-per-context.md), [ADR 0005](../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0007](../../../../../../docs/architecture/adr/0007-module-maturity-and-progressive-closure.md), [ADR 0009](../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0020](../../../../../../docs/architecture/adr/0020-growth-cross-sell-coupons-fulfillment.md). Cross-context: ver ADR de cross-sell (stacking de descontos) e o `rules-engine` (autoridade de desconto). Baseline: `.specs/maturity/coupons.md`.

## Contexto

`coupons` é o módulo do contexto **growth** responsável por cupons do
merchant: criação/arquivamento (admin), aplicação no carrinho (widget) e
resgate (no `order.completed`). Está classificado **P3 / L1** (ADR 0020):
estado provavelmente em memória, sem idempotência/persistência exigidas
pela DoD L3. A DoD cita **cupom** como item que não pode existir só em
memória.

### Responsabilidades e camadas

- **Domínio:** `CouponEntity`, `CouponRedemptionEntity`; políticas puras
  `coupon-validity.policy` (validade/elegibilidade), `coupon-limit.policy`
  (`checkCouponLimits`), `coupon-discount-calculator` (math determinística
  do desconto). Eventos em `coupon-domain-event`.
- **Ports:** `CouponRepository` (escopo por `merchant_id`),
  `CouponRedemptionRepository`, `OutboxRepository` (compartilhado).
- **Aplicação:** `CreateCouponUseCase`, `ArchiveCouponUseCase`,
  `ApplyCouponUseCase`, `RedeemCouponUseCase`; handler
  `CouponsOnOrderCompletedHandler` (resgate dirigido por evento, ADR 0003).
- **Infra:** `InMemoryCouponRepository`, `InMemoryCouponRedemptionRepository`.
- **Apresentação:** `WidgetCouponsController` (`embed/coupons`, atrás de
  `EmbedAuthGuard` + `assertSessionBelongsToEmbedMerchant`) e
  `MerchantCouponsController` (admin, hoje só `@NonProductionRoute`).

### Fluxos-chave

1. **Apply (widget):** valida cupom → checa idempotência por sessão →
   checa limites → calcula desconto → persiste `redemption` (status
   `applied`) → outbox `coupon.applied` → controller grava
   `session.cart.currentDiscount`.
2. **Redeem (evento):** em `order.completed`, redemptions `applied` viram
   `redeemed`, `usages_count` do cupom é incrementado, outbox
   `coupon.redeemed`.

### Invariantes que o módulo deve sustentar

- **Desconto só é aprovado pelo `rules-engine`** (`evaluateDiscountOffer`
  aplica hard-cap de `maxDiscountPercent` e rejeita abaixo de
  `minimumMarginPercent`). O módulo **não** é autoridade de desconto.
- **Toda query escopada por `merchant_id`** (ADR 0005).
- **Persistência só por Prisma em runtime** (ADR 0004); in-memory é test double.
- **Math de oferta determinística**; save de agregado + outbox atômicos (ADR 0003).

## Decisão

Manter o desenho hexagonal do módulo (domínio puro, ports, use-cases,
controllers de widget atrás de `EmbedAuthGuard`), corrigindo os desvios de
invariante abaixo. Em especial: o desconto do cupom **deixa de ser
autoridade local** e passa a ser submetido ao `rules-engine`
(`evaluateDiscountOffer`) antes de qualquer persistência; o módulo migra
para repositórios Prisma em runtime; e os writes de agregado + outbox
passam a ser atômicos. Cupons e resgates permanecem escopados por
`merchant_id` em todas as portas, sem exceção.

## Bugs registrados (root cause + remediação)

### P0 — Desconto de cupom aplicado sem autorização do `rules-engine` (contrato)
- **Onde:** `application/use-cases/apply-coupon.use-case.ts:52-57`;
  efeito em `presentation/http/widget-coupons.controller.ts:53`.
- **Root cause:** `calculateCouponDiscount()` calcula o desconto dentro do
  módulo e `ApplyCouponUseCase` o persiste direto na redemption e em
  `session.cart.currentDiscount`. O valor nunca passa por
  `evaluateDiscountOffer`. Nenhuma checagem de margem ou de
  `maxDiscountPercent` é aplicada — viola "desconto só pelo `rules-engine`".
- **Impacto:** merchants podem ser forçados a honrar descontos que furam o
  piso de margem e o teto configurados. A math é determinística, mas
  **não autorizada** — o motor de segurança é ignorado.
- **Remediação decidida:** `ApplyCoupon` passa a depender de um **port do
  `rules-engine`**; o desconto calculado é submetido a
  `evaluateDiscountOffer` antes de persistir; rejeita/clampa em violação de
  cap ou margem. **Precisa de mudança de contrato** (nova porta + assinatura
  do use-case).

### P1 — Limite global de uso checa `redeemed`, não `applied` (funcional)
- **Onde:** `apply-coupon.use-case.ts:44-50`;
  `infrastructure/repositories/in-memory-coupon-redemption.repository.ts:27-31`.
- **Root cause:** `countByCoupon` conta só `status==='redeemed'`. Redemptions
  só viram `redeemed` após `order.completed`; no instante do apply a contagem
  é ~0 e `checkCouponLimits` nunca dispara `max_usages`.
- **Impacto:** `max_usages` é inexigível no apply — um cupom limitado pode
  ser aplicado a milhares de carrinhos em voo antes de qualquer settlement,
  estourando o budget. Cap por buyer é igualmente fraco (TOCTOU).
- **Remediação decidida:** contar `applied` + `redeemed` (excluir
  `cancelled`) para o limite global, ou reservar uso atomicamente no apply,
  na mesma transação do insert da redemption. **Sem mudança de contrato.**

### P1 — Idempotência e checagem de limite no apply são TOCTOU (concorrência)
- **Onde:** `apply-coupon.use-case.ts:34-63`.
- **Root cause:** guarda de duplicidade (`findBySession` → check) e limites
  (`countByCoupon`/`countByBuyer`) são read-then-write sem atomicidade nem
  unique constraint. Dois applies concorrentes da mesma sessão/cupom passam
  ambos no check e inserem ambos.
- **Impacto:** cupom dobrado na sessão e resgates acima do limite sob
  concorrência. A `ConflictException` dá falsa sensação de idempotência.
- **Remediação decidida:** unique constraint em
  `(session_id, coupon_id, status='applied')` e reserva de limite dentro de
  transação (`SELECT ... FOR UPDATE` ou contador atômico). **Depende da
  migração Prisma** (ver ADR de persistência do contexto).

### P1 — State + outbox sem transação compartilhada (dados)
- **Onde:** `redeem-coupon.use-case.ts:20-42` e `apply-coupon.use-case.ts`
  (padrão em todo o contexto).
- **Root cause:** `repo.save(...)` e `outbox.appendOutbox(...)` são dois
  `await` separados sem transação. Falha entre eles diverge estado e evento.
- **Impacto:** estado persistido sem evento (analytics de resgate nunca
  notificada) ou evento duplicado no retry — quebra o at-least-once do outbox.
- **Remediação decidida:** envolver save + `appendOutbox` em uma única
  transação (transactional outbox, ADR 0003). **Bloqueado até existirem
  repos Prisma** — amarrado ao ADR de persistência do contexto.

### P2 — `redeem-coupon` incrementa uso via read-modify-write com perda (concorrência)
- **Onde:** `redeem-coupon.use-case.ts:23-26`.
- **Root cause:** carrega o cupom, `incrementUsage()` (count+1), salva a
  entidade inteira. Resgates concorrentes leem o mesmo `usages_count` e
  sobrescrevem, perdendo incrementos.
- **Impacto:** `usages_count` subconta resgates, enfraquecendo ainda mais o
  `max_usages` e corrompendo relatórios.
- **Remediação decidida:** incremento atômico no banco
  (`UPDATE ... SET usages_count = usages_count + 1`). **Sem mudança de
  contrato** (depende dos repos Prisma).

### P2 — `findById` de redemption não escopado por `merchant_id` (segurança)
- **Onde:** `domain/ports/coupon-redemption-repository.port.ts:7` e impl
  in-memory.
- **Root cause:** `findById(id)` não recebe `merchantId`, ao contrário de
  `CouponRepository.findById`. Qualquer caller futuro que resolva redemption
  por id fura o tenant boundary.
- **Impacto:** leitura cross-tenant latente de redemptions. A invariante
  exige toda query escopada por `merchant_id`; esta porta é a exceção.
- **Remediação decidida:** adicionar `merchantId` a `findById` e filtrar por
  ele, espelhando `CouponRepository.findById`. **Mudança de contrato da
  porta** (assinatura), sem migração de dados.

### P3 — Rotas admin de cupom confiam em `merchant_id` do body/query (segurança)
- **Onde:** `presentation/http/merchant-coupons.controller.ts:17-30`.
- **Root cause:** `MerchantCouponsController` aceita `merchant_id` do
  body/query com apenas `@NonProductionRoute()` — sem guard de auth de
  merchant. create/list/archive confiam no id fornecido.
- **Impacto:** em não-produção, agir sobre cupons de qualquer merchant
  passando o id. Gated de prod pelo `@NonProductionRoute` (por isso P3), mas
  normaliza um padrão inseguro; seria P1 se o gate cair.
- **Remediação decidida:** ligar a rota ao JWT de merchant e derivar
  `merchant_id` do principal autenticado; manter o gate não-prod como
  defesa em profundidade. **Sem mudança de contrato de domínio.**

## Melhorias para produção

### Segurança
- `merchant_id` sempre do contexto/claims, nunca do body (ADR 0005/0009).
- `MerchantCouponsController` atrás de JWT de merchant.
- `findById` de redemption escopado por `merchant_id`.

### Desacoplamento
- Introduzir port do `rules-engine` consumido pelo `ApplyCoupon`; o módulo
  deixa de ser autoridade de desconto. Stacking agregado é de competência do
  `rules-engine` (ver ADR de cross-sell).

### Persistência & Consistência
- Repos Prisma como única persistência de runtime (ADR 0004); save de
  agregado + outbox atômicos (ADR 0003); unique constraint de apply e
  reserva de limite transacional; incremento atômico de `usages_count`.

### Observabilidade
- Métricas de cupons aplicados/resgatados/rejeitados por cap/margem;
  logs com `correlation_id` + `merchant_id` + `session_id`.

### Otimização & Escala
- Índices por `merchant_id` e por `(session_id, coupon_id)`; contadores
  de uso materializados em vez de `count` por scan.

### Features faltantes
- Regras de cupom configuráveis por tenant (ADR 0024); reconciliação
  apply↔redeem↔order; contract test contra o `rules-engine`.

## Alternativas consideradas
- **Manter o cálculo de desconto autoritativo no módulo.** Rejeitado: viola
  "desconto só pelo `rules-engine`" e o hard-cap de margem.
- **Continuar com repos in-memory.** Rejeitado pela DoD L3 (cupom não pode
  existir só em memória) e ADR 0004.
- **Enforçar limite só no resgate.** Rejeitado: deixa a janela de apply
  sobreinscrita.

## Consequências
**Positivas:** desconto sempre autorizado e auditável; cupom durável e
idempotente; tenant boundary sem exceções.
**Negativas/riscos:** acoplamento de runtime ao `rules-engine` (mitigado por
port); salto L1→L3 exige repos Prisma + migrações; maior superfície de teste
(idempotência, concorrência, replay de outbox).

**Barra de aceite:** DoD L3 do ADR 0007 + E2E de: desconto rejeitado/clampado
pelo `rules-engine`, apply concorrente idempotente, `max_usages` respeitado
sob carga, cross-tenant negado e save+outbox atômicos verdes.
