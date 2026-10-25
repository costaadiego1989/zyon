# ADR 0001 (self-checkout) — Arquitetura do módulo de self-checkout e hardening de IDOR/PCI/carteira

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Growth), Segurança, Plataforma
- **Relacionado:** [ADR 0003](../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0004](../../../../../../docs/architecture/adr/0004-prisma-isolation-per-context.md), [ADR 0005](../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0007](../../../../../../docs/architecture/adr/0007-module-maturity-and-progressive-closure.md), [ADR 0011](../../../../../../docs/architecture/adr/0011-payment-hardening.md), [ADR 0018](../../../../../../docs/architecture/adr/0018-buyer-identity-and-history.md), [ADR 0021](../../../../../../docs/architecture/adr/0021-post-pilot-self-checkout-scraping.md). Baseline: `.specs/maturity/self-checkout.md`.

## Contexto

`self-checkout` é o módulo do contexto **growth** que guarda a carteira do
buyer (endereços e métodos de pagamento salvos), templates de checkout e a
execução de template "1-clique". Está classificado **P4 / L1** (ADR 0021):
expansão pós-piloto, sem estado crítico em produção nem rota externa sem auth
até atingir L3.

### Responsabilidades e camadas

- **Domínio:** `BuyerUserEntity`, `BuyerWalletEntity`,
  `BuyerSavedAddressEntity`, `BuyerSavedPaymentMethodEntity`,
  `BuyerCheckoutTemplateEntity`; políticas `consent.policy`,
  `template-execution.policy`; port `PaymentTokenizerPort`.
- **Ports:** `BuyerUserRepository`, `BuyerWalletRepository`,
  `BuyerTemplateRepository`, `PaymentTokenizerPort`, `OutboxRepository`.
- **Aplicação:** register-buyer, add/remove address, add/delete payment
  method, create/execute/list template, update-consent.
- **Infra:** repos in-memory + `StubPaymentTokenizerAdapter`.
- **Apresentação:** `BuyerMeController` (atrás de `BuyerAuthGuard`).
  Registro/login pertencem ao `BuyerAccountModule` (ADR 0018).

### Fluxos-chave

1. **Create template:** verifica buyer existe → cria/persiste template →
   outbox `buyer.template.created`.
2. **Execute template:** carrega template → carrega wallet do buyer →
   resolve método/endereço → `evaluateTemplateExecution` → outbox
   `buyer.template.executed` → retorna endereço + metadados do método.
3. **Add payment method:** tokeniza cartão via `PaymentTokenizerPort` →
   grava método no wallet.

### Invariantes que o módulo deve sustentar

- **Tenant/owner boundary:** todo acesso a template/wallet escopado pelo
  dono (`buyer_user_id`) e por `merchant_id` (ADR 0005).
- **PCI:** dados de cartão (PAN/CVV) não trafegam pela camada de aplicação;
  tokenização na borda (ADR 0011).
- **Persistência Prisma em runtime** (ADR 0004); save + outbox atômicos
  (ADR 0003); mutações de agregado seguras sob concorrência.

## Decisão

Manter o desenho do módulo e fechar os desvios abaixo antes de qualquer
promoção a L3 (ADR 0021): execução de template passa a exigir prova de
posse (`findById(id, buyer_user_id)` + assert de owner); criação de template
valida que endereço/método pertencem à carteira do buyer; tokenização de
cartão migra para a borda (PAN/CVV nunca cruzam application/domínio); e o
módulo migra para repos Prisma com mutações de carteira sob lock otimista.

## Bugs registrados (root cause + remediação)

### P0 — IDOR: buyer executa template de checkout de outro buyer (segurança)
- **Onde:** `application/use-cases/execute-checkout-template.use-case.ts:25-26`.
- **Root cause:** `templates.findById(template_id)` não é escopado por
  `buyer_user_id` (`BuyerTemplateRepository.findById` não tem param de dono)
  e o use-case nunca checa `template.buyer_user_id === input.buyer_user_id`.
  O wallet é carregado para o buyer chamador, mas a resposta retorna endereço
  resolvido + método (id, brand, last_four) do template; qualquer buyer
  autenticado passando um `template_id` conhecido/adivinhado dispara execução
  e emissão de evento para um template que não possui.
- **Impacto:** buyer A age sobre o template de B, vazando estado de endereço +
  metadados de pagamento (brand, last_four) e emitindo
  `buyer.template.executed` por outro usuário. Exposição cross-account de PII
  e dado de pagamento.
- **Remediação decidida:** `findById(id, buyer_user_id)` no repo/port e
  assert `template.buyer_user_id === input.buyer_user_id` (404 caso
  contrário); resolver endereço/pagamento estritamente do wallet do chamador.
  **Precisa de mudança de contrato** (assinatura do port).

### P1 — CreateCheckoutTemplate não verifica que endereço/método são do buyer (validação)
- **Onde:** `application/use-cases/create-checkout-template.use-case.ts:25-38`.
- **Root cause:** o use-case checa que o buyer existe, mas nunca carrega o
  wallet para confirmar que `saved_address_id` e `saved_payment_method_id`
  pertencem a ele. Quaisquer ids são gravados no template.
- **Impacto:** buyer cria template referenciando ids de wallet que não
  possui; combinado com o IDOR de execução, amplia o raio de exposição
  cross-account. Mesmo sem o IDOR, ids estranhos causam NotFound na execução.
- **Remediação decidida:** carregar o wallet do buyer e assertar que ambos os
  ids existem em `saved_addresses`/`saved_payment_methods` antes de persistir.
  **Sem mudança de contrato.**

### P1 — State + outbox sem transação compartilhada (dados)
- **Onde:** register-buyer, add-payment-method, update-consent,
  create/execute template (padrão do contexto).
- **Root cause:** `save(...)` e `appendOutbox(...)` são dois `await`
  separados sem transação.
- **Impacto:** estado sem evento ou evento duplicado no retry — quebra o
  at-least-once do outbox.
- **Remediação decidida:** transactional outbox (ADR 0003). **Bloqueado até
  repos Prisma** — amarrado ao ADR de persistência do contexto.

### P2 — Lookup de email case-sensitive e registro TOCTOU (dados)
- **Onde:** `application/use-cases/register-buyer-user.use-case.ts:26-39`;
  `infrastructure/repositories/in-memory-buyer-user.repository.ts:16`.
- **Root cause:** `findByEmail` compara string exata, então `User@x.com` e
  `user@x.com` são contas distintas; login idem. O check-then-save é
  não-atômico, sem unique constraint.
- **Impacto:** contas duplicadas para o mesmo email real (casing diferente) e
  corrida onde dois registros concorrentes passam no check e inserem ambos.
  Superfície de confusão/takeover e falha de login ao mudar casing.
- **Remediação decidida:** normalizar email para lowercase em write e lookup;
  unique index em email e confiar nele para o conflito. **Depende da migração
  Prisma.**

### P2 — Mutações de wallet com read-modify-write sem lock otimista (concorrência)
- **Onde:** `application/use-cases/add-saved-payment-method.use-case.ts:27-48`
  (e add/remove address).
- **Root cause:** carregam o wallet inteiro, mutam cópia e `save()` o agregado
  todo. Operações concorrentes leem o mesmo wallet base e o save posterior
  sobrescreve a alteração anterior.
- **Impacto:** lost updates de endereços/métodos sob concorrência — um cartão
  ou endereço some silenciosamente.
- **Remediação decidida:** coluna de versão/`updated_at` para lock otimista e
  rejeição de save obsoleto, ou inserts/deletes de child row em vez de
  overwrite do agregado. **Depende da migração Prisma.**

### P2 — CVV trafega pela camada de aplicação até o tokenizer (segurança/PCI)
- **Onde:** `domain/ports/payment-tokenizer.port.ts:3-9`;
  `AddSavedPaymentMethodUseCase`.
- **Root cause:** `TokenizeCardInput` inclui `cvv` e o use-case passa PAN +
  CVV crus pela aplicação até o tokenizer. O stub não persiste, mas rotear
  dado completo de cartão + CVV por código de app (e potencialmente logs)
  amplia escopo PCI e tangencia o guardrail "never request CVV".
- **Impacto:** escopo/risco PCI-DSS ampliado e risco de PAN/CVV em logs/dumps
  dentro da fronteira da aplicação. Deveria ser tokenizado na borda.
- **Remediação decidida:** tokenizar na borda (presentation/gateway) e passar
  só um token de uso único ao use-case; PAN/CVV nunca cruzam
  application/domínio. **Precisa de mudança de contrato** (`TokenizeCardInput`
  sai do domínio; use-case recebe token). Alinhar com ADR 0011.

### P3 — Expiração do método parseada de data não zero-padded (dados)
- **Onde:** `infrastructure/adapters/stub-payment-tokenizer.adapter.ts:10`.
- **Root cause:** `expires_at = new Date(\`20${year}-${month}-01\`)` assume
  mês já zero-padded e ano de 2 dígitos. Mês `'3'` gera `'20YY-3-01'`
  (inválido em parsers estritos); ano de 4 dígitos gera `'20YYYY-...'`.
- **Impacto:** Invalid Date gravado como expiração para certos inputs →
  checagem de cartão expirado imprevisível. Baixa frequência, determinístico
  no input malformado.
- **Remediação decidida:** validar/zero-pad mês, normalizar ano e construir a
  data explicitamente (`new Date(Date.UTC(fullYear, monthIndex, 1))`). **Sem
  mudança de contrato.**

## Melhorias para produção

### Segurança
- Owner scoping em template (findById por dono + assert); validação de
  ownership de endereço/método no create; tokenização na borda (sem PAN/CVV
  no app, ADR 0011); `merchant_id`/`buyer_user_id` sempre do contexto.

### Desacoplamento
- `PaymentTokenizerPort` recebendo token, não cartão; comunicação por
  evento/porta (ADR 0003).

### Persistência & Consistência
- Repos Prisma (ADR 0004); save + outbox atômicos; unique index de email;
  lock otimista em wallet; data de expiração robusta.

### Observabilidade
- Métricas de templates criados/executados, métodos adicionados, falhas de
  policy; logs com `correlation_id` + `buyer_user_id` + `merchant_id` (sem
  PAN/CVV/last_four em claro além do necessário).

### Otimização & Escala
- Índices por `buyer_user_id` e `merchant_id`; child-row writes em vez de
  overwrite de agregado.

### Features faltantes
- Especificação completa do self-checkout antes de promover a L3 (ADR 0021);
  fluxo de tokenização na borda integrado ao payment (ADR 0011).

## Alternativas consideradas
- **Confiar no `template_id` sem owner scoping.** Rejeitado: IDOR.
- **Tokenizar dentro do use-case.** Rejeitado: amplia escopo PCI.
- **Manter repos in-memory em produção.** Rejeitado pela DoD L3 e ADR 0021
  (sem estado crítico em produção até L3).

## Consequências
**Positivas:** carteira e templates com isolamento por dono; escopo PCI
reduzido; estado durável e seguro sob concorrência.
**Negativas/riscos:** mudança de contrato do tokenizer e do port de template;
módulo pós-piloto — esforço não deve atrasar P0/P1 (ADR 0021).

**Barra de aceite:** DoD L3 do ADR 0007 + E2E de: execução de template de
outro buyer negada (404), create com ids fora do wallet rejeitado,
tokenização sem PAN/CVV no app, registro concorrente idempotente e
save+outbox atômicos verdes.
