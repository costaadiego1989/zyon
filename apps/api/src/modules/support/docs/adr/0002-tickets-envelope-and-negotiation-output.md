# ADR 0002 (support) — Contrato envelopado de tickets e saída do simulador de negociação

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Support/Negotiation), Produto, Plataforma
- **Relacionado:** [ADR 0019 — Negotiation e support](../../../../../../../docs/architecture/adr/0019-negotiation-and-support.md), [ADR 0003 — Event bus e outbox](../../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0009 — Platform P0 hardening](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0024 — Dashboard config/preview/onboarding](../../../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md), [ADR 0028 — Merchant console integration API v1](../../../../../../../docs/architecture/adr/0028-merchant-console-integration-api-v1.md). Origem: diagnóstico read-only do `apps/dashboard` cruzado com `support` controller e `packages/shared-types`.

## Contexto

O módulo `support` expõe a listagem de tickets do tenant; o controller vivo
**sempre** retorna o envelope `{data, next_cursor, has_more}`. A página de Support
e a contagem de tickets na Overview consomem esse contrato. A página de
Negotiation é um simulador técnico que avalia uma negociação e mostra o resultado.

Portas/fluxos chave consumidos pelo dashboard:
- **getSupportTickets** — lista de tickets; contrato envelopado paginado.
- **simulador de negociação** — avalia uma proposta e renderiza o resultado.

Invariantes que o módulo deve sustentar:
- contrato de leitura **único e documentado** (envelope), sem ambiguidade de forma.
- um corpo 200 malformado deve virar erro tratado, não `TypeError` de render.
- resultado de avaliação de negociação deve ser visualmente distinto de erro.

## Decisão

Fixar o contrato envelopado de `support` no cliente e separar sucesso de erro no
simulador de negociação:

- `getSupportTickets` ancora na forma documentada `{data,...}`, valida com guard
  e trata `.data` ausente como erro com mensagem clara, em vez de retornar
  `undefined`;
- o simulador rastreia sucesso vs erro separadamente e renderiza com estilos
  distintos (panel-info vs panel-warn), mantendo o último bom resultado visível
  quando um novo run falha.

## Melhorias para produção

### Segurança
- `merchant_id`/escopo sempre do contexto de tenant (ADR 0005/0009).

### Desacoplamento
- Guard de contrato isolado no cliente; páginas não reinterpretam a forma da resposta.

### Persistência & Consistência
- Forma de resposta única (envelope) elimina o branch de bare-array não testado.

### Observabilidade
- Distinção visual sucesso/erro no simulador; um 500 não pode parecer resultado válido.

### Otimização & Escala
- Paginação por cursor já presente no envelope; cliente respeita `next_cursor`/`has_more`.

### Features faltantes
- Tipagem compartilhada (`packages/shared-types`) do envelope para travar o contrato.

## Bugs diagnosticados e remediação decidida

### BUG-SUP-1 (P2, contrato) — `getSupportTickets` assume `response.data` quando não-array, pode lançar em respostas não-envelopadas
- **Arquivo:** `apps/dashboard/src/api-client.ts:336-342`
- **Causa raiz:** o retorno é `Array.isArray(response) ? response : response.data`.
  O controller vivo sempre retorna `{data,next_cursor,has_more}`, mas o cliente
  também aceita um array puro e, para qualquer não-array sem `.data` (ex.: envelope
  de erro que passou como 200, ou mudança futura de forma), `response.data` é
  `undefined` e o `.filter`/`.map` a jusante lança. O contrato de forma dupla é
  ambíguo e não testado no branch de bare-array.
- **Impacto:** frágil a drift de forma da API; um corpo 200 malformado vira
  `TypeError` em vez de erro tratado. Support e contagem de tickets na Overview
  podem quebrar o caminho de render.
- **Remediação decidida:** fixar na forma envelopada documentada, validar com
  guard e tratar `.data` ausente como erro com mensagem clara, em vez de retornar
  `undefined`.
- **Contrato/migração:** **endurecimento de contrato no cliente** (remove o branch
  de bare-array). Sem migração de dados; o servidor já entrega o envelope.

### BUG-NEG-1 (P2, observabilidade) — `NegotiationPage` mistura erros HTTP com resultados de sucesso na mesma caixa de saída
- **Arquivo:** `apps/dashboard/src/pages/negotiation-page.tsx:30-44`
- **Causa raiz:** tanto o caminho de sucesso (`JSON.stringify(res)`) quanto todos
  os de erro (SyntaxError, DashboardHttpError, genérico) escrevem na mesma string
  `pretty` renderizada num único `<pre>`. Não há distinção visual entre resultado
  válido e mensagem de erro, nem state/estilo de erro separado.
- **Impacto:** o operador não distingue uma avaliação real de negociação de um
  dump de erro; um HTTP 500 parece resultado. Ruim para um simulador técnico cujo
  foco é correção.
- **Remediação decidida:** rastrear sucesso vs erro separadamente e renderizar com
  estilos distintos (panel-info vs panel-warn); manter o último bom resultado
  visível quando um novo run falha.
- **Contrato/migração:** sem mudança de contrato/migração (correção de cliente).

## Alternativas consideradas
- **Manter o contrato de forma dupla (array ou envelope).** Rejeitado: branch não
  testado e propenso a `TypeError`; o servidor já padroniza no envelope.
- **Mostrar erro e sucesso na mesma caixa.** Rejeitado: ambíguo num simulador de
  correção.

## Consequências
**Positivas:** contrato de tickets robusto a drift; simulador legível e confiável.
**Negativas/riscos:** travar a forma exige tipo compartilhado e guard mantidos.

**Barra de aceite:** corpo 200 malformado em tickets vira erro tratado (sem
`TypeError`); resultado de negociação e erro renderizam com estilos distintos.
