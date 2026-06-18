# ADR 0002 (onboarding) — Arquitetura do módulo, leitura não-mutante e ordem de etapas

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Onboarding), Produto, Plataforma
- **Relacionado (ADRs centrais):** [ADR 0003](../../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0015](../../../../../../../docs/architecture/adr/0015-auth-and-tenant-onboarding.md), [ADR 0024](../../../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md). Relacionado local: [ADR 0001 (onboarding) — Feedback de cópia de snippet](./0001-onboarding-copy-snippet-feedback.md).

## Contexto

`onboarding` rastreia o progresso de provisionamento self-serve do tenant
(`account` → `checkout_config` → `embed` → `publish`) e emite eventos de
domínio via outbox durável (ADR 0003) consumidos pelo wizard do dashboard
(ADR 0024). ADRs vivem ao lado do código.

Responsabilidades e portas:

- **Apresentação:** `onboarding.controller.ts` — leitura de estado e
  `completeStep`.
- **Aplicação:** `get-onboarding-state.use-case.ts`,
  `complete-onboarding-step.use-case.ts` (persiste + faz `appendOutbox` só na
  transição real, idempotente).
- **Domínio:** `entities/onboarding-state.entity.ts` (`ONBOARDING_STEP_ORDER`,
  `completeStep`, `isComplete`, `nextStep`), porta
  `onboarding-state.repository.port.ts`.
- **Infra:** `prisma-onboarding-state.repository.ts`,
  `in-memory-onboarding-state.repository.ts`.

Invariantes que o módulo deve sustentar:
- `merchant_id` do contexto, nunca do body (ADR 0005/0009);
- emissão de evento só na transição real (idempotência de re-run — ADR 0003);
- estado coerente: sinais intermediários não devem mentir sobre pré-requisitos.

## Decisão

Manter a arquitetura e o modelo de outbox; **tornar a leitura de estado
não-mutante** e **decidir explicitamente** se a conclusão de etapas é
sequencial ou independente, gateando-a conforme a decisão.

## Melhorias para produção

### Observabilidade

**[P3 — GET com efeito colateral: leitura cria/persiste estado] — sem ADR de
contrato.** `GetOnboardingStateUseCase` cria e salva uma linha de estado
(completando `account`) quando nenhuma existe.
- **Impacto:** GET não-idempotente (risco de cache/retry), criação implícita de
  linha, carga de escrita em tráfego de leitura. Primeiras-leituras concorrentes
  dependem do upsert para não dar erro de chave duplicada (hoje seguro via
  upsert, mas frágil).
- **Remediação decidida:** retornar um estado default **computado sem
  persistir** no GET; persistir preguiçosamente só na primeira escrita
  explícita (`completeStep`). Se a persistência-na-leitura for intencional,
  documentar e garantir upsert-por-único como única escrita. (Compartilhada com
  a ADR de `agent-rules`.)

### Persistência & Consistência

**[P3 — etapas podem ser concluídas fora da ordem canônica] — sem ADR de
contrato.** `completeStep` marca qualquer etapa válida como concluída
independentemente de predecessores. `ONBOARDING_STEP_ORDER` é documentado como
ordem de resume, mas a conclusão é ungated, então `publish` pode ser concluído
com `checkout_config`/`embed` ainda pendentes.
- **Impacto:** estado de onboarding inconsistente;
  `merchant.onboarding.step.completed` emitido para etapas sem pré-requisitos.
  `merchant.onboarding.completed` ainda só dispara quando tudo está completo
  (estado final correto), mas os sinais/eventos intermediários enganam.
- **Remediação decidida:** **se** o provisionamento sequencial for requerido,
  rejeitar concluir uma etapa cujo predecessor esteja pendente
  (`BadRequest onboarding_step_out_of_order`); **caso contrário**, documentar
  que as etapas são independentes e que a ordem é só de resume.

### Segurança
- `merchant_id` do contexto já é a base; manter (ADR 0009).

### Desacoplamento
- Emissão só por outbox durável (ADR 0003); sem escrita cross-context de
  defaults — provisionamento via contratos (ADR 0015/0016).

### Otimização & Escala
- Leitura barata do estado para o wizard (ADR 0024).

### Features faltantes
- Reconciliação de progresso com os módulos de config (checkout-settings/embed)
  para refletir o estado real, não só o flag de etapa.

## Alternativas consideradas
- **Manter GET persistindo (status quo).** Rejeitado: viola idempotência de
  leitura; default computado basta.
- **Deixar conclusão ungated sem documentar.** Rejeitado: ambiguidade gera
  eventos enganosos; a decisão (sequencial vs independente) tem que ser
  explícita.

## Consequências
**Positivas:** GET idempotente; sinais de etapa coerentes com a semântica
escolhida.
**Negativas/riscos:** gatear ordem pode quebrar fluxos de teste/console que
completavam etapas fora de ordem; remover escrita-na-leitura exige checar
consumidores que assumiam linha existente.

**Barra de aceite:** teste de GET não criando linha; teste de `completeStep`
rejeitando (ou aceitando, conforme decisão documentada) etapa fora de ordem; e
não-duplicação de eventos em re-run.
