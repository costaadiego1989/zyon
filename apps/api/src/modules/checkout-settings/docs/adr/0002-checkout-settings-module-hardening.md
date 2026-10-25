# ADR 0002 (checkout-settings) — Configuração de checkout: arquitetura e referência de hardening

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Checkout), Segurança, Plataforma
- **Relacionado:** ADR central [0004](../../../../../../../docs/architecture/adr/0004-prisma-isolation-per-context.md) (Prisma), [0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md) (tenant), [0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md) (P0 plataforma), [0016](../../../../../../../docs/architecture/adr/0016-merchant-config-surface-hardening.md) (superfície de config do tenant), [0024](../../../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md) (config do checkout no dashboard), [0028](../../../../../../../docs/architecture/adr/0028-merchant-console-integration-api-v1.md) (Console/Integration API). ADR local: [0001 — Contrato If-Match e leitura do modo](./0001-if-match-contract-and-mode-read.md). ADR irmão: [checkout 0001](../../../checkout/docs/adr/0001-core-checkout-module-hardening.md).

## Contexto

`checkout-settings` é o contexto de **configuração operacional** do agente de
checkout por tenant: modo de operação (`manual_only`/proativo), política de
intervenção (cooldown, máximo por sessão), gatilhos habilitados, regras de
supressão, comportamento do widget e handoff. Não detém estado transacional —
é lido pelo `checkout` (via `CheckoutSettingsPort`/`getContext`) para decidir
se o agente intervém numa sessão.

**Responsabilidades.** Persistir e versionar a `CheckoutSettings` do merchant;
expor um `CheckoutSettingsContext` consumido pelo `checkout` no
`track-checkout-event` (gate de intervenção). Não autoriza desconto nem frete;
apenas governa *quando* o agente age.

**Portas (domain/ports).** `CheckoutSettingsRepository` (`get`/`save`/`delete`)
com `save(settings, expectedUpdatedAt?)` para concorrência otimista. Infra
Prisma: `PrismaCheckoutSettingsRepository`. Use-cases: `Get`/`Update`/`Reset`/
`GetContext`.

**Fluxos-chave.** Console/dashboard → `CheckoutSettingsController`
(`GET`/`PUT`/`POST reset`/`GET context`) → use-cases → repositório Prisma. O
`checkout` consome `GetCheckoutSettingsContextUseCase` por porta (ACL, ADR 0002).

**Invariantes que o módulo deve sustentar.**
1. `merchant_id`/tenant derivado sempre do principal autenticado, nunca do body.
2. Escrita concorrente segura: nenhuma atualização de config sobrescreve outra
   silenciosamente (concorrência otimista por `updatedAt` + `If-Match`/ETag).
3. Persistência só via Prisma (ADR 0004).
4. Default determinístico quando não há linha (`createDefault`).

## Decisão

Manter `checkout-settings` como **a implementação de referência** dos dois
controles que o `checkout` ainda não tem, e que o ADR irmão decide portar:

- **Tenant guard de verdade no controller.** `CheckoutSettingsController` aplica
  `@UseGuards(TenantCredentialGuard, TenantAccessGuard)`, deriva o tenant via
  `currentTenantPrincipal(request).tenantId` e nunca lê `merchant_id` do body —
  exatamente o padrão que o `CheckoutController` legado viola (ver ADR irmão,
  bug P1 do controller). Cada handler exige `serviceScopes`
  (`configuration:read`/`configuration:write`).
- **Concorrência otimista por `updatedAt`.** `save(settings, expectedUpdatedAt)`
  faz `updateMany(where: { merchantId, updatedAt: expected })` e lança
  `OptimisticConcurrencyError` quando `count !== 1`; o controller valida
  `If-Match` via `EntityTagService` antes de escrever. Este é o mecanismo que o
  agregado de sessão do `checkout` deve replicar (ver ADR irmão, bug P1 de
  lost-update), hoje ausente lá (`saveSession` faz upsert last-write-wins).

### Diagnóstico deste módulo

A varredura de bugs do core-checkout não atribuiu defeitos a
`checkout-settings`: o controller já tem guard de tenant, a escrita já usa
concorrência otimista com `If-Match`/ETag e a persistência é Prisma-only com
default determinístico. Nenhuma remediação é necessária aqui — este ADR
**documenta a arquitetura** e fixa o módulo como o padrão de referência para o
hardening do `checkout`.

Pontos de atenção (não-bugs, acompanhar): `Reset`/`Update` sem
`expectedUpdatedAt` caem no caminho `upsert` sem checagem otimista (usado só
quando não há linha prévia) — manter o `If-Match` obrigatório na borda HTTP
para que o caminho com checagem seja sempre o exercido em produção.

## Melhorias para produção

### Segurança
- Manter `TenantCredentialGuard` + `TenantAccessGuard` e derivação por
  principal; nunca aceitar `merchant_id` do payload (invariante 1; ADR 0005/0009).

### Desacoplamento
- Consumo pelo `checkout` só via `CheckoutSettingsPort`/`getContext` (ACL, ADR
  0002); sem acesso direto ao repositório de outro contexto.

### Persistência & Consistência
- Manter concorrência otimista por `updatedAt` em todo caminho de escrita;
  considerar exigir `expectedUpdatedAt` também no `reset`/`update` de linha
  existente para fechar a janela de upsert sem checagem.

### Observabilidade
- Logs estruturados com `correlation_id` + `merchant_id` nas escritas de config;
  métrica de `OptimisticConcurrencyError` para detectar contenção de edição.

### Otimização & Escala
- Leitura por `merchantId` (chave única) já é O(1); sem scans. `getContext`
  cacheável por curto TTL se virar caminho quente do `track-event`.

### Features faltantes
- Trilha de auditoria de mudanças de config (quem/quando) alinhada ao Console
  (ADR 0028); versionamento de histórico de settings se exigido por compliance.

## Alternativas consideradas
- **Fundir `checkout-settings` no `checkout`.** Rejeitado: separa configuração
  (governança/Console) do estado transacional (caminho de compra), mantendo a
  fronteira de contexto (ADR 0001) e o ciclo de release independente.
- **Last-write-wins na config.** Rejeitado: edições concorrentes no Console
  perderiam mudanças; concorrência otimista + `If-Match` é o padrão adotado.

## Consequências
**Positivas:** configuração do agente segura por tenant, com edição concorrente
protegida; serve de referência testada para o hardening do `checkout`.
**Negativas/riscos:** o caminho `upsert` sem `expectedUpdatedAt` permanece para
criação de linha — mitigado por `If-Match` obrigatório na borda HTTP.

**Barra de aceite:** E2E verdes para — leitura/escrita cross-tenant negada;
`PUT`/`reset` com `If-Match` desatualizado retorna conflito
(`OptimisticConcurrencyError`); default determinístico quando não há linha;
`getContext` consumido pelo `checkout` apenas via porta.
