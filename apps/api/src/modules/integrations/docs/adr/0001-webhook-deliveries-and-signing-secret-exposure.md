# ADR 0001 (integrations) — Log de entregas de webhook e exposição do signing secret

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Integrations), Segurança, Plataforma
- **Relacionado:** [ADR 0017 — Integrations: API keys e webhooks](../../../../../../../docs/architecture/adr/0017-integrations-api-keys-webhooks.md), [ADR 0002 — ACL cross-context](../../../../../../../docs/architecture/adr/0002-acl-pattern-cross-context.md), [ADR 0003 — Event bus e outbox](../../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0009 — Platform P0 hardening](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0024 — Dashboard config/preview/onboarding](../../../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md), [ADR 0028 — Merchant console integration API v1](../../../../../../../docs/architecture/adr/0028-merchant-console-integration-api-v1.md). Origem: diagnóstico read-only do `apps/dashboard` (api-client.ts, integrations-page.tsx) cruzado com `integrations` controllers.

## Contexto

O módulo `integrations` é dono de API keys e webhooks de saída do tenant. A página
de Integrações lista endpoints de webhook, mostra o log de entregas e cria
endpoints (gerando um `signingSecret` HMAC). API keys já seguem o padrão de
revelação única (`secret-box`: "mostrado uma vez / guarde no secret manager").

Portas/fluxos chave consumidos pelo dashboard:
- **getWebhookDeliveries** — lista endpoints e depois busca entregas por endpoint.
- **createWebhook** — cria endpoint e retorna o `signingSecret` uma única vez.
- **updateWebhookEndpoint** — referência correta de uso de `If-Match`.

Invariantes que o módulo deve sustentar:
- segredos (HMAC signing secret, API key) só via UI de revelação única, nunca em
  canal de mensagem genérico que pode ser logado/printado.
- falha parcial de um endpoint não pode derrubar a leitura dos demais.
- `merchant_id`/escopo sempre do contexto de tenant (ADR 0005/0009).

## Decisão

Tornar a leitura de entregas resiliente a falha parcial e tratar o signing secret
com o mesmo rigor das API keys:

- preferir um endpoint **agregado server-side** de entregas; na ausência dele,
  usar `Promise.allSettled`, expor resultados parciais e aplicar limite global
  com sort+slice após o merge;
- renderizar o `signingSecret` **apenas** via o `secret-box` de revelação única
  (copiar + aviso "não será mostrado de novo"), nunca interpolado em mensagem
  genérica.

## Melhorias para produção

### Segurança
- Signing secret e API key só no `secret-box`; nunca em string de banner que
  possa cair em log/telemetria/screenshot.

### Desacoplamento
- Agregação de entregas no servidor evita fan-out O(N) acoplado à contagem de
  endpoints no cliente.

### Persistência & Consistência
- Limite global aplicado pós-merge garante semântica de paginação previsível.

### Observabilidade
- `Promise.allSettled` permite reportar quais endpoints falharam sem derrubar a
  página inteira.

### Otimização & Escala
- Endpoint agregado reduz N requisições a 1; latência dominada por endpoint lento
  desaparece.

### Features faltantes
- Endpoint server-side de entregas agregadas com cursor/limite global.

## Bugs diagnosticados e remediação decidida

### BUG-INT-1 (P1, performance) — `getWebhookDeliveries` faz fan-out de 1 requisição por endpoint sem tratamento de falha parcial
- **Arquivo:** `apps/dashboard/src/api-client.ts:416-439`
- **Causa raiz:** `getWebhookDeliveries` lista todos os endpoints e depois faz
  `Promise.all` de uma requisição de entregas por endpoint. `Promise.all` rejeita
  na primeira falha, e o `limit` por endpoint é aplicado a cada um (não um teto
  global), então o total pode ser N*limit enquanto um único 500 falha a chamada
  toda.
- **Impacto:** log de entregas da página de Integrações: O(N) requisições escalando
  com a contagem de endpoints; um endpoint lento/falho faz o log inteiro falhar
  (`apiReachable` vira false, página inteira mostra erro) mesmo com os demais sãos.
- **Remediação decidida:** preferir endpoint agregado server-side se disponível;
  caso contrário usar `Promise.allSettled`, expor resultados parciais e aplicar
  limite global (sort+slice) após o merge.
- **Contrato/migração:** correção de cliente imediata; o endpoint agregado é uma
  **nova rota de API (mudança de contrato)** recomendada, sem migração de dados.

### BUG-INT-2 (P2, segurança) — `createWebhook` expõe o signing secret numa string de mensagem da UI
- **Arquivo:** `apps/dashboard/src/pages/integrations-page.tsx:166-169`
- **Causa raiz:** na criação do webhook o código faz
  `message = \`Webhook criado. Segredo ${created.signingSecret}\`` — embutindo o
  signing secret HMAC num banner de info genérico que pode ser logado, printado ou
  persistido em paths de erro/telemetria, mostrado inline em vez do padrão de
  revelação única usado para API keys (`secret-box`).
- **Impacto:** signing secret sensível renderizado num canal de mensagem transitório
  sem os guardrails de "mostrado uma vez / guarde no secret manager" aplicados às
  API keys; superfície de exposição maior.
- **Remediação decidida:** renderizar o signing secret só via o `secret-box` de
  revelação única com copiar + aviso "não será mostrado de novo", consistente com
  o tratamento de API keys; nunca interpolar em mensagem genérica.
- **Contrato/migração:** sem mudança de contrato/migração (correção de UI no cliente).

## Alternativas consideradas
- **Manter `Promise.all` com limite por endpoint.** Rejeitado: falha parcial
  derruba tudo e o total de linhas não é limitado globalmente.
- **Mostrar o secret inline "por conveniência".** Rejeitado: viola o padrão de
  revelação única já aplicado a API keys.

## Consequências
**Positivas:** log de entregas resiliente; segredo tratado com guardrails
consistentes.
**Negativas/riscos:** endpoint agregado exige trabalho de backend; `allSettled`
requer UI de resultado parcial.

**Barra de aceite:** um endpoint falho não derruba o log inteiro (resultados
parciais visíveis); signing secret só aparece no `secret-box` de revelação única.
