# ADR 0001 (agent-rules) — Arquitetura do módulo e validação dos guardrails

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Agent/Config), Segurança, Produto
- **Relacionado (ADRs centrais):** [ADR 0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0016](../../../../../../../docs/architecture/adr/0016-merchant-config-surface-hardening.md), [ADR 0024](../../../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md), [ADR 0025](../../../../../../../docs/architecture/adr/0025-packages-engines-sdk-hardening.md).

## Contexto

`agent-rules` define **identidade, capacidades e guardrails** do agente — a
fonte de verdade dos limites de segurança do CLAUDE.md (ex.:
`forbidUnauthorizedDiscounts`, `machineToMachineNegotiation`). Faz parte da
superfície de configuração do tenant (ADR 0016). ADRs vivem ao lado do código.

Responsabilidades e portas:

- **Apresentação:** `agent-rules.controller.ts` — `GET/PUT /agent-rules`,
  `GET /agent-rules/context`, `GET/PUT /agent-rules/:agentId`,
  `GET /agent-rules/:agentId/context` (sob `AuthGuard`; `merchantId`/`userId`
  de `currentUser`).
- **Aplicação:** `agent-rules.use-cases.ts` (`GetAgentRules`,
  `UpdateAgentRules`, `GetAgentContext`). `GetAgentContext` compõe com
  `checkout-settings` via porta opcional.
- **Domínio:** `entities/agent-rules.entity.ts` (`createDefault`, `rehydrate`,
  `update`, `toContext`), `agent-rules.types.ts` (`AgentRules`,
  `AgentRulesPatch`, `AgentContext`), portas
  `agent-rules-repository.port.ts` e `checkout-settings-context.port.ts`.
- **Infra:** `prisma-agent-rules.repository.ts`,
  `in-memory-agent-rules.repository.ts`, `checkout-settings-context.adapter.ts`.

Invariantes que o módulo deve sustentar (CLAUDE.md / ADR 0016):
- nenhuma config de guardrail pode conceder desconto/frete fora dos engines, nem
  o LLM autorizar oferta;
- `merchant_id` do contexto, nunca do body;
- toggles de segurança são integridade — não devem ser graváveis com tipo errado
  ou sem auditoria.

## Decisão

Manter a arquitetura porta/adaptador e **adicionar validação de runtime no
update**, impedindo que JSON arbitrário seja mesclado em `guardrails`/
`capabilities`. Tornar os caminhos de leitura não-mutantes (ver abaixo;
compartilhado com `onboarding`).

## Melhorias para produção

### Segurança

**[P2 — update sem validação de runtime; JSON arbitrário em guardrails] — sem
ADR de contrato (DTO interno).** `PUT /agent-rules` (e `/:agentId`) faz
`@Body() body: AgentRulesPatch` (tipo só de compilação, sem pipe de validação).
`AgentRulesEntity.update()` espalha `...patch.guardrails` / `...patch.capabilities`
no JSON persistido, então chaves desconhecidas e valores com tipo errado são
gravados verbatim, e toggles de segurança (`forbidUnauthorizedDiscounts`,
`machineToMachineNegotiation`, etc.) podem ser invertidos sem bounds nem
auditoria.
- **Causa-raiz:** ausência de DTO/pipe; merge por spread sem allow-list.
- **Impacto:** o JSON de guardrail armazenado pode ser poluído ou enfraquecido
  por um chamador de console; consumidores a jusante leem guardrails com lixo
  não-tipado. Lacuna de integridade da config de segurança (nenhuma mudança é
  gated/auditada).
- **Remediação decidida:** criar `AgentRulesPatchDto` com `@ValidateNested` +
  `@Type` aninhado e `whitelist: true` / `forbidNonWhitelisted: true`; validar
  campos enum/boolean; **remover chaves desconhecidas** antes de persistir.
  Considerar trilha de auditoria em mudança de toggle de segurança.

### Observabilidade

**[P3 — GET com efeito colateral: caminho de leitura escreve] — sem ADR de
contrato.** `GetAgentRulesUseCase` e `GetAgentContextUseCase` persistem uma
linha default na leitura quando nenhuma existe (`repository.save(...)`). GETs
passam a mutar estado.
- **Impacto:** GETs não-idempotentes (risco de cache/retry), criação implícita
  de linha para qualquer `:agentId` acessado, e carga de escrita em tráfego de
  leitura. Primeiras-leituras concorrentes dependem do upsert para não dar
  erro de chave duplicada (hoje seguro via upsert, mas frágil).
- **Remediação decidida:** retornar um default **computado sem persistir** no
  GET; persistir preguiçosamente só na primeira escrita explícita
  (`updateRules`). Se a persistência-na-leitura for intencional, documentar e
  garantir que upsert-por-único seja a única escrita. (Compartilhada com a ADR
  de `onboarding`.)

### Desacoplamento
- Manter a composição com `checkout-settings` via porta opcional (sem import
  cruzado de Prisma) — alinhado a ADR 0016.

### Otimização & Escala
- Cache de contexto do agente por tenant com invalidação por evento de mudança
  de config (ADR 0016/0024).

### Features faltantes
- Validação de combinações de guardrails (ex.: negociação M2M exige cap de
  desconto coerente); histórico/versionamento (ADR 0016).

## Alternativas consideradas
- **Confiar no tipo `AgentRulesPatch` de compilação.** Rejeitado: não há
  validação em runtime; o body é dado não-confiável.
- **Persistir default na leitura (status quo).** Rejeitado para o GET: viola
  idempotência de leitura; default computado é suficiente.

## Consequências
**Positivas:** guardrails íntegros e tipados; GETs idempotentes; toggles de
segurança gated.
**Negativas/riscos:** o DTO aninhado precisa acompanhar a forma de
`AgentRules`; remover a escrita-na-leitura exige checar consumidores que
assumiam a linha já existir.

**Barra de aceite:** testes rejeitando patch com chave desconhecida/tipo errado
e flip não-autorizado de toggle de segurança; teste de GET não criando linha.
