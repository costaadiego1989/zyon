# ADR 0001 (widget/lib) — `merchant-embed-config`: leitura de configuração de embed e tokens de tenant

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Widget), Segurança, Plataforma
- **Relacionado:** [ADR 0012](../../../../../../docs/architecture/adr/0012-embed-security-hardening.md), [ADR 0005](../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0023](../../../../../../docs/architecture/adr/0023-widget-shell-identity-experience.md). Módulos irmãos: [`use-checkout-session`](../../../hooks/docs/adr/0002-use-checkout-session.md).

## Contexto

`merchant-embed-config.ts` lê as opções de embarque do widget a partir de três
fontes, nesta ordem de precedência: **query string** → **`data-*` do elemento**
→ **defaults**. Produz `HybridCheckoutOptions` com `merchantId`, `apiBaseUrl`,
`productApiBaseUrl`, `cart`, `customer`, `shipping`, `embedSessionToken` e
`storeUrl`.

- **`firstQueryValue(params, names)`** — primeiro valor não-vazio entre aliases.
- **`readMerchantEmbedOptions(el)`** — monta as opções; lê `merchantId` e
  `embedSessionToken` de `window.location.search` quando presentes.

**Invariantes que o módulo deve manter:**

1. Tokens de tenant/embed não devem vazar por canais que persistem URL
   (referrer, histórico, logs) — ADR 0012.
2. Em modo embed, a ausência de `embedSessionToken` deve produzir erro de setup
   claro, não falha opaca downstream (ver [`use-checkout-session`](../../../hooks/docs/adr/0002-use-checkout-session.md)).

## Decisão

Preferir canais que não persistem o token (dataset/postMessage) e, se a query
string for suportada, removê-la da URL após a leitura.

### Bugs verificados e remediação

| Severidade | Falha | Causa raiz | Remediação decidida | Contrato/migração |
|---|---|---|---|---|
| **P3** | Token de tenant/embed aceito via query string (82–92) | `merchantId` e `embedToken` são lidos de `window.location.search` via `firstQueryValue`. Tokens de sessão/embed em URLs vazam por headers de referrer, histórico do navegador e logs de servidor. | Preferir atributos `data-*` / handshake por `postMessage` para tokens; se a query string precisar ser suportada, removê-la da URL após a leitura (`history.replaceState`). | Não (mudança de fonte de configuração; compat retida via dataset). |

> Relacionado: a asserção não-nula `config.embedSessionToken!` em
> [`use-checkout-session`](../../../hooks/docs/adr/0002-use-checkout-session.md)
> deve virar validação explícita no parse desta config (P3).

## Melhorias para produção

### Segurança
- Tokens preferencialmente via `data-*`/`postMessage`; query string saneada com
  `history.replaceState` (ADR 0012).

### Desacoplamento
- Precedência de fontes explícita (query → dataset → default).

### Persistência & Consistência
- Validação de `embedSessionToken` em modo embed no parse, com erro claro.

### Observabilidade
- Log de setup quando token ausente em embed (sem vazar o valor do token).

### Otimização & Escala
- N/A.

### Features faltantes
- Handshake `postMessage` para entrega de token sem URL; validação de
  `mode==='embed'` ⇒ token presente.

## Alternativas consideradas
- **Manter token só na query string.** Rejeitado: vaza por referrer/histórico/
  logs (ADR 0012).
- **Aceitar token sem saneamento de URL.** Rejeitado pelo mesmo motivo.

## Consequências
**Positivas:** menor superfície de vazamento de token; erro de setup claro.
**Negativas/riscos:** embarques que dependiam da query string precisam migrar
para `data-*`/postMessage.

**Barra de aceite:** token não permanece na URL após carga; embed sem
`embedSessionToken` falha com erro de setup, não 401 opaco; dataset/postMessage
suportados como fonte primária.
