# ADR 0002 (auth) — Sessão do dashboard: refresh, 401 e idempotência de mutações

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Auth), Plataforma, Segurança
- **Relacionado:** [ADR 0015 — Auth e onboarding](../../../../../../../docs/architecture/adr/0015-auth-and-tenant-onboarding.md), [ADR 0005 — Multi-tenant isolation](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009 — Platform P0 hardening](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0024 — Dashboard config/preview/onboarding](../../../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md), [ADR 0028 — Merchant console integration API v1](../../../../../../../docs/architecture/adr/0028-merchant-console-integration-api-v1.md). Origem: diagnóstico read-only do `apps/dashboard` (api-client.ts, main.tsx) cruzado com `auth` controllers e `TenantCredentialGuard`.

## Contexto

O módulo `auth` é o dono do estado de sessão do console tenant-admin. Suas
responsabilidades: emitir/renovar o cookie de sessão, validar credenciais via
`TenantCredentialGuard`, expor `merchantProfile()` como check de sessão no mount
e oferecer o `silentRefresh` que o cliente usa para renovar a sessão de forma
transparente.

Portas/fluxos chave consumidos pelo dashboard:
- **mount check**: `main.tsx` chama `api.merchantProfile()` em `refreshSession()`
  para decidir entre `AuthScreen` e o console.
- **refresh transparente**: `dashboardFetch` (api-client.ts) tenta um retry único
  em `401` via `silentRefresh`, compartilhado por `refreshInFlight` (promise de
  nível de módulo).
- **expiração reativa**: somente `dashboardJson` emite `SESSION_EXPIRED_EVENT`;
  o banner global de expiração assina esse evento.

Invariantes que o módulo deve sustentar:
- `merchant_id` deriva sempre do contexto de tenant/credencial, nunca do body
  (ADR 0005/0009).
- Uma sessão só deve ser considerada encerrada após um refresh **comprovadamente**
  falho com `401`; erros transitórios (`5xx`/rede) não encerram sessão.
- Retentativa idempotente de uma mesma ação de usuário não pode duplicar efeitos
  em endpoints `@Idempotent()`.

## Decisão

Centralizar o ciclo `401 → refresh → expiração` em um único ponto e tornar
`main.tsx` o dono único do estado de sessão:

- todo caminho de leitura/escrita do cliente passa pelo mesmo handler de `401`,
  que emite `SESSION_EXPIRED_EVENT` **somente após** um refresh falho — não em
  qualquer erro;
- distinguir explicitamente "refresh falhou" (→ expirar/login) de "proibido de
  fato" (→ erro de autorização) na segunda resposta;
- chave de idempotência **estável por ação lógica do usuário** (por submit de
  formulário), não por fetch, para que retentativas manuais reusem a mesma chave;
- erros transitórios no mount check preservam a sessão e mostram estado de
  "API indisponível / retry" em vez de derrubar para o `AuthScreen`.

## Melhorias para produção

### Segurança
- `merchant_id`/escopo sempre do `TenantCredentialGuard`; nunca confiar em valores
  do corpo da requisição (ADR 0005/0009). Não logar tokens/cookies de sessão.

### Desacoplamento
- Estado de sessão em um único owner (`main.tsx`) e um único interceptor de `401`;
  páginas não devem implementar tratamento próprio de expiração.

### Persistência & Consistência
- Idempotência derivada da ação do usuário, garantindo dedupe de double-submit
  através de reloads/retentativas em endpoints `@Idempotent()`.

### Observabilidade
- Log estruturado de `refresh attempted/succeeded/failed` com `correlation_id`;
  métrica de taxa de refresh e de bounce-to-login.

### Otimização & Escala
- Coalescer refresh concorrente entre múltiplas instâncias de `createDashboardApi`
  por uma única promise, garantindo que apenas uma re-autenticação ocorra por janela.

### Features faltantes
- Modelo de grace-window/expiração proativa (renovar antes de expirar em vez de
  só reagir no próximo `401`).

## Bugs diagnosticados e remediação decidida

### BUG-AUTH-1 (P1, integração) — Refresh/401 inconsistente pode dessincronizar UI do estado de auth
- **Arquivo:** `apps/dashboard/src/api-client.ts:201-256`
- **Causa raiz:** `dashboardFetch` retenta uma vez no `401` via `silentRefresh`,
  mas só `dashboardJson` emite `SESSION_EXPIRED_EVENT` — callers que leem o
  `Response` direto nunca disparam o evento. O refresh é chaveado por uma única
  `refreshInFlight` de nível de módulo, compartilhada entre todas as instâncias
  de `createDashboardApi` (cada página cria a sua via `useMemo`). Uma segunda
  resposta ainda `401` após refresh é lançada sem distinguir "refresh falhou" de
  "proibido de fato". Não há expiração proativa, só reativa no próximo call.
- **Impacto:** após expiração do cookie, algumas páginas mostram string de erro
  crua em vez de cair no login; o banner global só aparece em chamadas JSON;
  loads concorrentes correndo o mesmo refresh mascaram qual chamada re-autenticou.
- **Remediação decidida:** centralizar `401→refresh→expiração` num único handler;
  emitir `SESSION_EXPIRED` consistentemente após refresh falho; `main.tsx` como
  owner único do estado de sessão; documentar o modelo refresh/grace-window.
- **Contrato/migração:** não exige mudança de contrato de API nem migração de dados
  (correção de cliente + alinhamento de evento).

### BUG-AUTH-2 (P2, integração) — `refreshSession` trata qualquer rejeição de `merchantProfile()` como deslogado
- **Arquivo:** `apps/dashboard/src/main.tsx:204-221`
- **Causa raiz:** o `catch` de `refreshSession` seta `me=null` para **todos** os
  erros de `api.merchantProfile()`, não apenas `401`. Um blip de rede ou `500`
  transitório no mount derruba o usuário para o `AuthScreen` mesmo com cookie válido.
- **Impacto:** API instável/queda breve desloga o operador desnecessariamente;
  combinado com o caminho de refresh-401, gera bounce-to-login confuso.
- **Remediação decidida:** inspecionar o erro — forçar login só em `401` (após
  refresh falho); em outros erros mostrar estado "API indisponível"/retry
  preservando a sessão.
- **Contrato/migração:** sem mudança de contrato/migração.

### BUG-AUTH-3 (P2, concorrência) — `Idempotency-Key` gerada por-chamada anula a idempotência de retry
- **Arquivo:** `apps/dashboard/src/api-client.ts:182-189`
- **Causa raiz:** `dashboardFetch` gera um novo `createIdempotencyKey()` a cada
  requisição mutante. O retry de refresh-401 reusa o mesmo objeto de headers (ok),
  mas retentativas iniciadas pelo usuário (clicar Save de novo após falha) geram
  chave nova a cada vez, então o servidor não consegue deduplicar double-submit
  genuíno. A chave é aleatória, não derivada do payload, sem garantia entre reloads.
- **Impacto:** duplo clique no Save ou retry após timeout pode criar efeitos
  duplicados em endpoints `@Idempotent()` (ex.: webhook endpoints duplicados,
  API keys duplicadas), pois cada tentativa carrega chave distinta.
- **Remediação decidida:** estabilizar/derivar a chave por ação lógica do usuário
  (ex.: por submit de formulário) para que retentativas reusem a chave.
- **Contrato/migração:** sem migração; alinha com o contrato `@Idempotent()`
  existente (apenas muda quem/como gera a chave no cliente).

## Alternativas consideradas
- **Manter tratamento de 401 espalhado por página.** Rejeitado: gera UI
  inconsistente (string crua vs banner) e mascara a re-autenticação real.
- **Chave de idempotência por fetch.** Rejeitado: não dedupe double-submit do usuário.

## Consequências
**Positivas:** estado de sessão previsível; expiração sempre leva ao login;
dedupe real de mutações; menos logout espúrio.
**Negativas/riscos:** refatorar o interceptor central toca todas as páginas;
necessário cuidado para coalescer refresh sem deadlock entre instâncias.

**Barra de aceite:** em expiração de cookie, **toda** chamada (Response cru ou
JSON) leva a `SESSION_EXPIRED` após refresh falho; `5xx`/rede no mount não
desloga; teste de double-submit em endpoint `@Idempotent()` não duplica efeito.
