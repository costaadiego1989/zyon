# ADR 0002 (merchant) — Arquitetura do módulo e validação das regras configuráveis

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Merchant/Config), Produto, Plataforma
- **Relacionado (ADRs centrais):** [ADR 0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0016](../../../../../../../docs/architecture/adr/0016-merchant-config-surface-hardening.md), [ADR 0024](../../../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md), [ADR 0025](../../../../../../../docs/architecture/adr/0025-packages-engines-sdk-hardening.md), [ADR 0027](../../../../../../../docs/architecture/adr/0027-payment-crypto-evm.md). Relacionado local: [ADR 0001 (merchant) — Rules, theme e read-model de overview](./0001-merchant-rules-theme-and-overview-readmodel.md).

## Contexto

`merchant` é parte da **superfície de configuração do tenant** (ADR 0016). É a
fonte autoritativa das regras de negócio configuráveis que o `rules-engine` e o
`shipping-engine` leem para a matemática de oferta. ADRs vivem ao lado do
código (decisão do usuário).

Responsabilidades e portas:

- **Apresentação:** `merchant.controller.ts` — `GET/PUT /merchants/me/rules`,
  `GET/PUT /merchants/me/theme`, `GET /merchants/me` (todas sob `AuthGuard`,
  `merchant_id` derivado de `currentUser`, nunca do body).
- **Aplicação:** `merchant.use-cases.ts` (`GetMerchantProfile`,
  `GetMerchantRules`, `UpdateMerchantRules`), `get-merchant-theme.use-case.ts`,
  `update-merchant-theme.use-case.ts`.
- **Domínio:** `merchant.types.ts`, `services/merchant-crypto.validation.ts`
  (`normalizeMerchantCryptoPayments`, valida endereço EVM/USDC — ADR 0027).
- **Infra:** `prisma-merchant.repository.ts`, `in-memory-merchant.repository.ts`,
  porta `merchant-repository.port.ts` / `merchant-rules.repository.port.ts`.

Invariantes que o módulo deve sustentar (CLAUDE.md / ADR 0016):
- `merchant_id` sempre do contexto, nunca do body;
- a config **não pode permitir que o agente burle os engines** — `maxDiscountPercent`,
  `minimumMarginPercent`, `maxShippingSubsidy` etc. são os caps duros que os
  engines respeitam;
- matemática de oferta **determinística** — valores fora de faixa ou não-numéricos
  quebram essa garantia na fronteira de configuração.

## Decisão

Manter a arquitetura porta/adaptador e **adicionar validação de domínio e DTO
nas mutações de regras**, fechando a brecha em que valores arbitrários chegam
ao Prisma sem checagem. Saldar também a normalização incompleta de crypto
desabilitado.

## Melhorias para produção

### Segurança

**[P1 — regras de merchant aceitam valores arbitrários sem validação] — sem
ADR de contrato (DTO interno).** `PUT /merchants/me/rules` faz
`@Body() body: Partial<MerchantRules>` sem DTO `class-validator` e sem checagem
de limites de domínio. Só `cryptoPayments` é normalizado. `maxDiscountPercent`,
`minimumMarginPercent`, `maxShippingSubsidy`, `freeShippingMinCartValue`,
`maxPartialShippingDiscount`, `offerExpirationMinutes`, `blockedRegions` e
`brandVoice` são gravados no Prisma sem checagem.
- **Causa-raiz:** binding por tipo de compilação (`Partial<MerchantRules>`) não
  valida em runtime; nenhum guard de bounds no use-case.
- **Impacto:** um merchant (ou sessão de console comprometida) pode setar
  `maxDiscountPercent=100` / `minimumMarginPercent=0` / valores negativos.
  Como esses são os caps autoritativos lidos pelo rules-engine e shipping-engine,
  valores fora de faixa ou não-numéricos quebram a matemática determinística e
  podem autorizar descontos/subsídios não-lucrativos ou descontrolados —
  violação direta das invariantes do CLAUDE.md na fronteira de configuração.
- **Remediação decidida:** criar `UpdateMerchantRulesDto` com `class-validator`
  (`@IsInt`/`@Min`/`@Max`/`@IsBoolean`/`@IsIn` para `brandVoice`; percentuais
  `0–maxAllowed`; piso de margem; tetos de subsídio) e **rejeitar chaves
  desconhecidas** (`whitelist: true`, `forbidNonWhitelisted: true`). Aplicar as
  invariantes também no use-case (ex.: `minimumMarginPercent ≥ floor`) como
  defesa em profundidade.

### Persistência & Consistência

**[P3 — config de crypto desabilitada persiste campos não-validados] — sem
ADR de contrato.** `normalizeMerchantCryptoPayments` retorna
`{ ...input, enabled:false }` quando desabilitado, passando adiante
`treasuryAddress`/`brlPerUsdc`/`chain`/`network`/`token` arbitrários sem
validar nem remover.
- **Impacto:** campos de crypto inválidos podem ser gravados enquanto desabilitado;
  se depois ligado por patch parcial que não reenvia os campos, o comportamento
  depende da ordem de merge e pode aflorar valores velhos/inválidos.
- **Remediação decidida:** ao desabilitar, retornar objeto mínimo normalizado
  (`{ enabled:false }`) descartando os campos de pagamento não-validados; ou
  validar-então-gravar independentemente do flag `enabled`.

### Observabilidade
- Log com `correlation_id` + `merchant_id` nas mutações de config; métrica de
  mudanças por tenant (ADR 0016).

### Otimização & Escala
- Cache de config por tenant com invalidação por evento para a leitura quente do
  widget (ADR 0016/0024).

### Features faltantes
- Versionamento/histórico de config; auditoria de quem alterou o quê (ADR 0016).

## Alternativas consideradas
- **Validar só no rules-engine/shipping-engine (a jusante).** Rejeitado: deixa
  dados inválidos persistidos e move a invariante para longe da fronteira; a
  config é o ponto autoritativo.
- **Permitir override de engine via config.** Rejeitado: viola invariante do
  CLAUDE.md (ADR 0016).

## Consequências
**Positivas:** caps de oferta confiáveis e dentro de faixa; matemática de oferta
determinística garantida na fronteira; config de crypto sem lixo persistido.
**Negativas/riscos:** o DTO precisa acompanhar a evolução de `MerchantRules`
para não rejeitar campos novos legítimos.

**Barra de aceite:** testes de validação rejeitando `maxDiscountPercent>cap`,
margem negativa, `brandVoice` inválido e chaves desconhecidas; teste de crypto
desabilitado não persistindo campos não-validados.
