# ADR 0028: Merchant Console e Integration API V1

- **Status:** accepted
- **Data:** 2026-06-14
- **Decisores:** Engenharia, Produto, Plataforma e Seguranca
- **Relacionado:** ADRs 0015, 0016, 0017, 0024, 0025 e 0026

## Contexto

A AACP precisa atender dois perfis sem criar produtos divergentes:

1. tenants que operam visualmente pelo Merchant Console;
2. tenants que integram ERP, e-commerce ou backend proprio por HTTP REST.

O dashboard atual ainda consome rotas especiais, possui contratos duplicados e
usa dados demonstrativos em partes importantes. A API existente tambem mistura
rotas de widget, callbacks de provedores, operacao humana e integracao externa
sem uma superficie publica versionada.

## Decisao

O Merchant Console sera um cliente da mesma Integration API publica usada por
integradores externos. A superficie estavel comeca em `/v1`, usa JSON em
`snake_case` e deriva o tenant exclusivamente da credencial.

Durante o cutover, `/v1/*` e um alias das rotas selecionadas existentes. Rotas
sem versao continuam funcionando temporariamente e recebem o header
`Deprecation: true`. Nenhuma rota entra na documentacao publica por descoberta
acidental: o OpenAPI usa uma allowlist por operacao.

### Contrato HTTP

- datas em ISO 8601 UTC;
- dinheiro em minor units;
- paginacao por cursor com `data`, `next_cursor` e `has_more`;
- erros RFC 7807 com `code`, `fields` e `correlation_id`;
- `Idempotency-Key` em mutacoes externas;
- `ETag` e `If-Match` em configuracoes;
- `RateLimit-*` e `Retry-After` em throttling;
- breaking changes apenas em nova versao principal.

### Autenticacao

- sessoes humanas usam cookie `HttpOnly` curto e refresh opaco rotativo;
- integracoes usam `Authorization: Bearer aacp_live_*` ou `aacp_test_*`;
- `x-aacp-api-key` permanece somente durante a janela de compatibilidade;
- chaves sao armazenadas por hash, exibidas uma vez e vinculadas a tenant,
  ambiente, expiracao, escopos e CIDRs opcionais;
- equipe, MFA, billing e gestao de chaves exigem `OWNER` ou `ADMIN`.

### Superficies publicas

A API V1 converge para:

- `/v1/me` e `/v1/onboarding`;
- `/v1/commerce/connections` e `/v1/catalog`;
- `/v1/checkout/configuration/*`;
- `/v1/embed/sessions` e `/v1/installations`;
- `/v1/orders` e `/v1/orders/{id}/tracking`;
- `/v1/customers`, `/v1/payments` e `/v1/support/tickets`;
- `/v1/webhook-endpoints` e `/v1/audit-events`.

OAuth, Account Links e onboarding documental podem emitir URLs curtas e de uso
unico, mas a etapa interativa continua no navegador autenticado.

### OpenAPI e Scalar

- documento machine-readable em `/openapi.json`;
- referencia Scalar publica em `/docs`;
- servidores de sandbox e producao;
- schemes para Bearer, cookie e header legado;
- callbacks de provedores, rotas de teste e endpoints internos excluidos;
- exemplos e clientes derivados do contrato, nunca mantidos manualmente em
  paralelo.

### Arquitetura compartilhada

- `TenantPrincipal` representa sessao humana e chave de servico;
- guards de escopo sao declarativos;
- controllers do console e de integracao chamam os mesmos casos de uso;
- `merchant_id` enviado por clientes autenticados e rejeitado;
- contratos runtime ficam em um package dedicado e alimentam API, console,
  SDK e validacao do OpenAPI.

### Merchant Console

O console usa React Router, TanStack Query, React Hook Form e schemas runtime.
Cada feature segue MVVM e oferece estados de loading, empty, error, retry,
success e conflito. O sistema visual segue o AACP Continuum: light mineral,
dark carbono mineral, acento restrito, responsividade mobile-first e WCAG 2.2
AA.

### Remocao de mocks

Producao falha no startup quando adapters fake, repositorios em memoria ou seed
E2E estiverem ativos. Sandbox usa contas reais de teste dos provedores e marca
recursos como `test`.

## Entrega incremental

1. fundacao REST V1, OpenAPI, Scalar e convencoes;
2. principal unificado, chaves, ambientes e escopos;
3. problemas HTTP, idempotencia, paginacao e concorrencia;
4. identidade, sessoes, RBAC e onboarding;
5. comercio, catalogo, configuracao e pagamentos;
6. embed sessions, instalacoes e preview;
7. operacao, webhooks, auditoria e remocao de mocks;
8. Merchant Console consumindo exclusivamente `/v1`;
9. portal do desenvolvedor, exemplos e contratos gerados;
10. hardening, migracao e cutover.

Cada contexto deve ser testado e commitado isoladamente.

## Consequencias

### Positivas

- paridade real entre console e integracao HTTP;
- menor duplicacao de regras e contratos;
- documentacao executavel e segura por padrao;
- caminho explicito para remover mocks e rotas de dashboard.

### Custos e riscos

- o alias temporario exige disciplina para nao eternizar rotas legadas;
- DTOs atuais precisam migrar de interfaces para schemas concretos;
- autenticacao e persistencia exigem migrations coordenadas;
- a allowlist do OpenAPI precisa acompanhar cada nova operacao publica.

## Criterios de aceite

- console e integrador externo concluem o onboarding pela mesma API;
- chave sem escopo recebe `403` e chave revogada recebe `401`;
- mutacoes criticas sao idempotentes;
- nenhum identificador fornecido permite acesso cross-tenant;
- OpenAPI, DTOs, cliente TypeScript e comportamento HTTP divergem apenas se o
  CI falhar;
- nenhum adapter fake pode ser carregado em producao.
