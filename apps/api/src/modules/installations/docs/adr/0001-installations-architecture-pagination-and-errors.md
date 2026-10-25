# ADR 0001 (installations) — Arquitetura do módulo, paginação e mapeamento de erros

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Installations), Plataforma
- **Relacionado (ADRs centrais):** [ADR 0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0024](../../../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md), [ADR 0028](../../../../../../../docs/architecture/adr/0028-merchant-console-integration-api-v1.md).

## Contexto

`installations` gerencia as instalações de widget por merchant (ambiente,
versão, origens permitidas, saúde) consumidas pelo console (ADR 0024/0028).
ADRs vivem ao lado do código.

Responsabilidades e portas:

- **Apresentação:** `installations.controller.ts` — `GET /installations`,
  `POST /installations` (`@Idempotent`), `GET/PUT /installations/:id`
  (`If-Match`/ETag), report de saúde. Sob `TenantCredentialGuard` +
  `TenantAccessGuard` com escopos de serviço.
- **Aplicação:** `installation.use-cases.ts` (`List`, `Get`, `Create`,
  `Update`, `ReportHealth`).
- **Domínio:** porta `installation-repository.port.ts`, DTOs em
  `installation.dto.ts`.
- **Infra:** `prisma-installation.repository.ts` — usa corretamente
  `updateMany({where:{id,merchantId,updatedAt}})` + `count===1` para
  concorrência otimista (padrão de referência que o repo de `integrations`
  deveria espelhar).

Invariantes que o módulo deve sustentar:
- `merchant_id` do contexto, nunca do body (ADR 0005/0009); todo where é
  escopado por `merchantId`;
- concorrência otimista por `If-Match`/`updatedAt`;
- contrato de paginação honesto (`next_cursor`/`has_more` refletem o estado
  real).

## Decisão

Manter a arquitetura e o padrão de update por `updateMany`+count; **corrigir o
contrato de paginação** da listagem e **desambiguar o mapeamento de erro**
entre linha ausente e conflito de concorrência.

## Melhorias para produção

### Persistência & Consistência

**[P3 — update/health reporta linha ausente como conflito de concorrência] —
sem ADR de contrato.** `update()` e `reportHealth()` lançam
`OptimisticConcurrencyError` sempre que `updateMany count!==1`, conflatando
"linha deletada entre o `get()` do use-case e o update" (deveria ser `404
not_found`) com um mismatch genuíno de `If-Match`/`updatedAt`.
- **Impacto:** clientes recebem `409`/erro de pré-condição para uma instalação
  deletada em vez de `404`; obscurece a causa real em logs e provoca retry
  indevido no cliente.
- **Remediação decidida:** após `count!==1`, re-checar existência
  (`findFirst` por `id`+`merchantId`): se ausente, lançar `NotFoundException`;
  caso contrário, lançar `OptimisticConcurrencyError`.

### Otimização & Escala

**[P3 — listagem ilimitada com `has_more=false` fixo] — sem ADR de contrato.**
`ListInstallationsUseCase` → `repository.list()` faz `findMany` sem
`take`/`cursor`; o controller sempre retorna `next_cursor:null`,
`has_more:false`.
- **Impacto:** conjunto de resultados ilimitado para merchants com muitas
  instalações (memória/latência) e contrato de paginação que nunca avança, então
  clientes não conseguem paginar mesmo havendo mais linhas.
- **Remediação decidida:** adicionar `take` (limite) + `cursor` ao `list()` e
  popular `next_cursor`/`has_more` a partir da query.

### Segurança
- `merchant_id` do contexto e where sempre escopado por tenant já estão corretos
  (ADR 0009); manter.

### Desacoplamento
- Manter porta de repositório; nenhuma dependência cruzada de Prisma.

### Observabilidade
- Log com `correlation_id` + `merchant_id` nas mutações; métrica de saúde de
  instalação por ambiente.

### Features faltantes
- Paginação real exposta no contrato do console (ADR 0028); filtros por
  ambiente/status.

## Alternativas consideradas
- **Manter `has_more=false` fixo (status quo).** Rejeitado: contrato mente e não
  escala.
- **Tratar todo `count!==1` como conflito.** Rejeitado: mascara `404` e gera
  retry incorreto.

## Consequências
**Positivas:** paginação honesta e escalável; erros corretos (`404` vs `409`)
que orientam logs e retries do cliente.
**Negativas/riscos:** introduzir cursor é mudança de contrato de listagem —
clientes existentes que ignoravam `next_cursor` continuam funcionando, mas o
novo cursor precisa de contract test.

**Barra de aceite:** teste de listagem paginando com cursor/`has_more` reais;
teste de update/health retornando `404` para linha deletada e `409` para
mismatch de `If-Match`.
