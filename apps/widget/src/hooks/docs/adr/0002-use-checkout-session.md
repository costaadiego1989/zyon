# ADR 0002 (widget/hooks) — `use-checkout-session`: ciclo de sessão, persistência e isolamento de tenant

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Widget), Segurança, Plataforma
- **Relacionado:** [ADR 0005](../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0012](../../../../../../docs/architecture/adr/0012-embed-security-hardening.md), [ADR 0022](../../../../../../docs/architecture/adr/0022-widget-transactional-path.md), [ADR 0023](../../../../../../docs/architecture/adr/0023-widget-shell-identity-experience.md). Módulos irmãos: [`use-global-auth`](./0003-use-global-auth.md), [`merchant-embed-config`](../../../lib/docs/adr/0001-merchant-embed-config.md).

## Contexto

`use-checkout-session.ts` inicia e mantém a sessão de checkout do widget:

- **`startCheckout()`** — resolve o carrinho (via product API opcional), POST
  `start` com `session_id` salvo opcional, persiste `aacp_global_user_id` e
  `aacp_session_id` em `localStorage`, sincroniza a experiência inicial.
- **`track` / `updateCart`** — telemetria best-effort e mutação de carrinho.
- **`syncExperience`** — fonte única do `CheckoutExperienceSnapshot` ativo.
- **`clearPersistedSession` / `resetSessionAfterOrder`** — limpeza pós-pedido.
- **`embedOpts`** — injeta `embedToken` em modo embed.

**Portas:** `embed-client` (paths embed/legacy, `normalizeApiBase`), schemas Zod
de resposta, `WidgetConfig`.

**Invariantes que o módulo deve manter:**

1. Estado de sessão/identidade de um merchant **nunca** é reutilizado por outro
   merchant na mesma origem (isolamento de tenant — ADR 0005).
2. `session_id` replayado em `startCheckout` deve pertencer ao merchant ativo.
3. Token de embed válido obrigatório em modo embed (ADR 0012).
4. Telemetria nunca interrompe a tarefa de checkout.

## Decisão

Namespacing por tenant em toda chave persistida e validação de pertencimento
antes do replay, fechando o vazamento cross-tenant.

### Bugs verificados e remediação

| Severidade | Falha | Causa raiz | Remediação decidida | Contrato/migração |
|---|---|---|---|---|
| **P1** | Vazamento cross-tenant de sessão e identidade via `localStorage` compartilhado (linhas 59–92) | As chaves `aacp_session_id`, `aacp_global_user_id`, `aacp_global_auth_session`, `aacp_global_device_id` são **globais** (também em `use-global-auth.ts:13-14`). `startCheckout` replaya `savedSessionId` independentemente do `merchantId`, e `loginFromCheckoutSession` retorna `true` sempre que qualquer token existe, mesmo de outro merchant. Dois merchants embarcados na mesma origem compartilham estado de sessão/auth → `session_id`/token do merchant A pode ser enviado aos endpoints do merchant B, vazando identidade e corrompendo sessões. | Namespacear todas as chaves persistidas por `merchantId` (ex.: `aacp_session_id:<merchantId>`); validar `session.merchant_id` armazenado contra o merchant ativo antes de reusar em `startCheckout` e `loginFromCheckoutSession`. | **Sim** — mudança de formato de chave em `localStorage`. Requer migração leve: ler chaves legadas uma vez, reescrever namespaceadas, descartar globais. |
| **P3** | Asserção não-nula em `embedSessionToken` esconde falha de token ausente (linha 39) | `config.embedSessionToken!` assume presença em embed; se ausente, `embedOpts.embedToken` fica `undefined`, `checkoutJson` omite o header de auth e o resultado é um 401 opaco em vez de erro de validação claro. | Validar presença de `embedSessionToken` quando `mode==='embed'` no parse da config e exibir erro de setup preciso. | Não (validação de borda; ver também [`merchant-embed-config`](../../../lib/docs/adr/0001-merchant-embed-config.md)). |

## Melhorias para produção

### Segurança
- Chaves de storage namespaceadas por tenant; nenhum estado cruza merchants
  na mesma origem (ADR 0005). Token de embed validado no parse (ADR 0012).

### Desacoplamento
- Respostas validadas por schema Zod; UI consome snapshot tipado (ADR 0025).

### Persistência & Consistência
- `session_id` replayado só após checagem de `merchant_id`; migração de chaves
  legadas idempotente.

### Observabilidade
- Log de replay rejeitado por mismatch de tenant; erro de setup de embed claro.

### Otimização & Escala
- Telemetria best-effort isolada (já não interrompe o fluxo).

### Features faltantes
- Migração one-shot de chaves globais → namespaceadas; teste cross-tenant na
  mesma origem.

## Alternativas consideradas
- **`sessionStorage` por iframe.** Insuficiente quando múltiplos widgets
  compartilham a mesma janela/origem; o namespacing por `merchantId` é explícito.
- **Manter chaves globais e filtrar no servidor.** Rejeitado: o vazamento já
  ocorre no cliente antes da chamada.

## Consequências
**Positivas:** isolamento de tenant garantido no cliente.
**Negativas/riscos:** migração de `localStorage` legado; testar dois merchants
na mesma origem.

**Barra de aceite:** dois merchants na mesma origem não compartilham
`session_id`/token; `startCheckout` rejeita replay de sessão de outro tenant;
embed sem token retorna erro de setup, não 401 opaco.
