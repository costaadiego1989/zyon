# Observability Stack — AACP

## Alertas locais — preparação operacional em 17/10/2026

Cinco regras locais de contrato, resultado incerto, erro de turno, latência e
scrape usam apenas métricas já existentes. Sem novos exporters, labels de cliente,
flags, destinos ou entrega de notificações. Thresholds provisórios, não SLOs.
Ver [runbook operacional](OPERATIONS.md) para sinais, triagem, testes promtool,
retenção/acesso atuais e decisões pendentes antes de coleta/alertas externos.
Não houve startup da stack operacional ou publicação por essa mudança.

## Estado local da instrumentação — atualização em 17/10/2026, etapas 14–15

Esta documentação descreve a infraestrutura proposta; não comprova que os serviços,
dashboards, correlação de logs ou auto-instrumentação estejam ativos em produção.
Não usar o compose de desenvolvimento como configuração de produção: ele expõe
serviços locais e inclui acesso de demonstração. Coleta real não foi ativada.

### Homologação sintética isolada — etapa 15

`test:observability-integration` inicia exclusivamente serviços descartáveis,
não o Compose operacional. Requer Docker Linux, Playwright/Chromium já instalados
e estas imagens previamente em cache (não faz pull implícito):

```powershell
docker pull grafana/grafana:11.6-ubuntu
docker pull prom/prometheus:v3.4.0
docker pull grafana/loki:3.4.3
docker pull grafana/tempo:2.7.2
docker pull grafana/alloy:v1.20.1
docker pull node:24-bookworm-slim
pnpm --filter @zyon/api test:observability-integration
```

- Rede Docker `--internal`, filesystem read-only, armazenamento somente tmpfs,
  limites de recursos e nomes/labels únicos por execução. Nenhum container publica
  portas, lê socket Docker, recebe label de coleta ou usa volume existente.
- O Docker local não publicou portas na rede interna. A ponte de teste usa
  stdin/stdout de `docker exec` no container de fixtures e listeners HTTP do
  harness somente em `127.0.0.1`, com portas aleatórias. Destinos internos têm
  allowlist fixa; redirects não são seguidos. Não há suporte a WebSocket/live.
- A ponte preserva múltiplos Set-Cookie e mapeia apenas sua origem loopback exata
  para a origem interna. Origem estranha não é promovida a confiável; CSRF não
  é desativado. O navegador só pode solicitar o próprio Grafana local.
- Prometheus raspa somente `fixture:8080`, sem API real, credenciais de produção,
  host gateway ou configuração de scrape operacional. Contadores/histograma são
  fixtures dependentes do tempo, não métricas do negócio.
- Alloy recebe fixtures por HTTP de teste, aplica `alloy/managed.alloy` real e
  envia ao Loki local. Isso homologa projeção/transporte/ingestão, não descoberta
  Docker nem leitura de stdout real. Traces são OTLP sintético, não auto-instrumentação.
- O teste simula um datasource Prometheus com UID legado em banco novo e recarrega
  o provisioning real. Não migra instalações existentes, dashboards antigos ou
  alertas que ainda referenciem outro UID.
- Artefatos de evidência (`result.json`, screenshots e, em falha, diagnóstico UI)
  ficam em `zyon-obsv-evidence-*` no diretório temporário do usuário; o caminho é
  impresso no resultado. Não contêm credenciais de produção ou estado de login.
- Cleanup confere ownership label antes de remover apenas containers/rede próprios;
  resolve o caminho mkdtemp antes de remover sua configuração gerada. Não usa
  prune, não remove imagens, volumes de serviço, arquivos do projeto ou pastas antigas.

A integração encontrou um comportamento ausente dos testes de arquivo: Loki
adicionava `service_name` automaticamente. `limits_config.discover_service_name: []`
agora mantém a allowlist dos quatro labels indexados gerenciados, conforme a
[configuração oficial do Loki](https://grafana.com/docs/loki/latest/configure/).
Isso pode afetar recursos de exploração que dependam especificamente de
`service_name`; os painéis desta proposta consultam `service` explicitamente.

Resultados finais e limites deste ciclo estão na etapa 15 do
[relatório de continuidade](../../apps/api/tests/storefront-contracts.md).
Ingestão/UI sintéticas não certificam dados reais, retenção, alertas, autenticação
de produção, atualização de versões, segurança ou funcionamento comercial.

### Coleta e painel preparados, não ativados

O painel versionado [Storefront — contratos e LLM](grafana/dashboards/storefront-llm.json)
tem 10 painéis: scrape, turnos, custo estimado USD, P95 por estágio, decisões de
fallback/rejeição, erros de provider/histórico, tokens conhecidos e logs projetados.
As nove consultas PromQL foram aceitas pelo parser real do Prometheus 3.4.0.
O parser sozinho não comprova renderização/ingestão; a etapa 15 adiciona o harness
sintético descrito acima. Operação com dados reais continua pendente.
UIDs fixos/provisionamento precisam ser homologados inclusive
se já houver volumes/datasources antigos. Nenhum volume existente foi alterado.

O coletor preparado é **Alloy 1.20.1**, em perfil Compose `logs`, desligado no
comando padrão. Promtail deixou de ser mantido em 02/03/2026, conforme a
[migração oficial](https://grafana.com/docs/alloy/latest/set-up/migrate/from-promtail/).
Seu arquivo permanece só como referência legada, fora da composição atual.
Nenhuma imagem antiga ou pasta do usuário foi removida.

- Descoberta limitada ao container da API com label
  `zyon_observability=storefront_api`. Não há coleta genérica de todos os containers.
  API rodando diretamente no host não é coletada por esse caminho Docker. O label
  seleciona escopo, não autentica produtores. O acesso ao socket Docker é
  privilegiado: montagem `:ro` não torna sua API somente leitura; produção exige
  isolamento/proxy/permissões próprias.
- A pipeline compartilhada `alloy/managed.alloy` recria a linha com campos
  permitidos e valores enumerados/IDs validados. Não encaminha stdout original,
  mensagens, stack, headers, URLs, prompts, códigos de cupom ou campos extras.
  Eventos desconhecidos, projeção ausente/erro, linhas grandes e timestamp fora
  do formato são descartados. Falha de parse de data no estágio timestamp usa
  horário recebido (`skip`), nunca cria sequência artificial (`fudge`).
- Somente `service`, `environment`, `job` e nível normalizado são labels finais.
  IDs de requisição/turno/operação/trace/span ficam no JSON/structured metadata.
  Não são labels de alta cardinalidade. A projeção não transforma um produtor
  confiável em autoridade comercial nem certifica todos os canais de dados.
- O teste nativo reutiliza a pipeline real do Alloy com sete fixtures: quatro
  eventos aceitos, três descartados; sem canários privados na saída. Conferiu
  timestamp original, níveis numéricos/textuais, aliases, metadata e labels.
  Usa arquivo de fixtures e `loki.echo`, não socket Docker ou endpoint Loki.
- Os links Loki → Tempo reconhecem IDs canônicos/legados; Tempo → Loki consulta
  o campo JSON canônico, sem tratar traceId como label indexado. Links de
  exemplares/service graph não comprovados foram retirados do provisioning.
  A etapa 15 testa correlação com um trace sintético conhecido; isso não homologa
  comportamento de traces reais não amostrados ou indisponíveis.
- O Compose de demonstração agora publica portas somente em `127.0.0.1` e
  desliga acesso anônimo do Grafana. A credencial de demonstração continua
  inadequada para produção; não foram criados segredos nem configurado TLS/RBAC.
  O perfil de logs e a stack operacional não foram iniciados; somente os serviços
  sintéticos descartáveis do harness da etapa 15.

Validação comum, sem Docker:

```powershell
pnpm --filter @zyon/api test:storefront-observability
```

Validação nativa explícita, com Docker Linux já disponível e estas imagens em cache:

```powershell
docker pull grafana/alloy:v1.20.1
docker pull prom/prometheus:v3.4.0
pnpm --filter @zyon/api test:observability-native
```

O script não faz pull implícito, não inicia Compose e não publica portas. Validadores
e a pipeline de fixtures são contêineres descartáveis com `--network none`;
somente o nome único/label de propriedade do harness é encerrado/removido. Imagens
baixadas permanecem no cache; nenhum volume de serviço ou arquivo do host é apagado.
Promtool valida sintaxe das consultas com substituições de variáveis, não avalia
resultados contra séries reais. `promql format` requer `--experimental` nessa versão;
isso é só uma opção do validador, não uma flag habilitada na API ou no Prometheus.

Referências: [processamento Alloy](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.process/),
[validação](https://grafana.com/docs/alloy/latest/reference/cli/validate/),
[echo local](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.echo/),
[provisionamento Grafana](https://grafana.com/docs/grafana/latest/administration/provisioning/),
[trace → logs](https://grafana.com/docs/grafana/latest/datasources/tempo/configure-tempo-data-source/configure-trace-to-logs/).

### Instrumentação da aplicação

- Há um único controller de `GET /metrics`, em `ObservabilityModule`. O serviço
  combina os registros HTTP/domínio legados e as métricas da aplicação/storefront;
  os produtores e nomes existentes foram preservados. Inicializar novamente não
  zera contadores. O caminho antigo do controller é apenas um re-export.
- Em `NODE_ENV=production`, o endpoint exige `OPS_SHARED_SECRET` não vazio e
  `Authorization: Bearer <secret>` ou `X-Ops-Secret: <secret>`. Ausência/erro retorna
  401. Basic e segredo em query não são aceitos. A resposta usa `Cache-Control:
  no-store`. Desenvolvimento mantém a política anterior de acesso sem segredo.
- Para um scraper de produção, configurar o segredo por arquivo montado, nunca
  versionar o valor. O exemplo comentado usa `authorization.type: Bearer` com
  `authorization.credentials_file`; o arquivo contém o valor do segredo sem o
  prefixo Bearer. Usar HTTPS ou transporte privado protegido; a comparação no
  servidor não protege credenciais em trânsito. Nenhum segredo/mount foi criado.
  Consulte a [configuração oficial do Prometheus](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#http_config).
- `STOREFRONT_LLM_OBSERVABILITY=enabled` habilita somente a instrumentação nova
  dos casos de uso de mensagem/nudge e adaptador/agente: turnos, validações, persistência,
  classificador, provider, ferramentas e copy. Ela
  permanece opt-in/desligada por padrão, independente do roteamento estruturado.
  A instrumentação não cria exportador nem ativa coleta externa.
- `SendStoreMessageUseCase` abre o turno antes de validar o input. Uma porta do
  domínio, com implementação na infraestrutura e fallback no-op, cobre input,
  contexto, envelope/escopo, resposta pública e cada gravação de histórico.
  O adaptador entra no mesmo turno; não existe contagem dupla de turnos/tokens.
  `boundary` é enum fechado nos logs/spans, nunca label de métrica. Decisões
  rejeitadas/fallback têm evento próprio: operação de validação `ok` significa
  que a checagem retornou, não que o dado foi aceito.
- `GenerateNudgeUseCase` usa a mesma porta: input, fallback seguro, contexto,
  geração pelo adaptador, política de saída e resposta pública compartilham o
  turno. `generation` mede a chamada ao adaptador separadamente da validação;
  `provider` continua sendo a única fonte de tokens/custo. As novas boundaries
  `fallback`/`generation` também são enumeradas e não viram labels de métrica.
  Não há retry, persistência ou ferramenta comercial adicionada ao nudge.
- Fallback seguro não é erro de entrega: rejeições de input/contexto/saída,
  sanitização de fallback e exceções produzem decisões separadas. Uma exceção
  capturada pelo copy service mantém `provider=error`, mas `generation=ok` se
  ele devolveu uma mensagem válida. Não inferimos falha só porque o texto
  retornado é igual ao fallback; nem inventamos uso quando o provider não roda.
- Persistência continua sequencial, aguardada e best-effort. Cada chamada ao
  repositório emite uma operação; a primeira exceção interrompe as seguintes,
  sem retry, e não impede a resposta segura. `error` significa que a chamada
  lançou exceção, não que a transação foi revertida ou que nada foi gravado.
  `turn=ok` significa resposta retornada, não confirmação de persistência.
- O caso de uso não adiciona IDs de comprador/loja/sessão, nomes de experimentos,
  mensagens brutas de exceção ou header de correlação aos seus novos metadados.
  Logs de decisão recebem `traceId`/`spanId` quando há contexto válido, além dos
  IDs técnicos do turno/operação. Isso não garante encontrar no backend um trace
  não amostrado. O enriquecimento Pino/filtros foi ajustado na etapa 13, ainda
  sem publicação, coleta externa ou certificação de todos os logs/pipelines.
- A configuração ativa do `AppModule` e o wrapper compartilhado agora usam a
  mesma factory Pino, avaliada pelo Nest depois do ambiente. O bootstrap conecta
  o logger Nest ao Pino com buffering. Não foi importado um segundo módulo de
  logger nem ativado Sentry. O middleware HTTP efetivamente registrado também
  passa a preencher AsyncLocalStorage, reutilizando a implementação testada.
- O header público `x-correlation-id` mantém sua aceitação/normalização e retorno.
  Logs gerenciados usam `requestId`/`reqId` UUID gerados por requisição, não o
  conteúdo recebido do cliente. Os campos legados explícitos `correlationId` e
  `correlation_id` são censurados na configuração Pino, sem mudar o payload HTTP.
- Com contexto válido, Pino emite `traceId`/`spanId` e `trace_id`/`span_id`. Um
  evento de observação com IDs explícitos válidos preserva o span filho nos dois
  aliases, mesmo se o contexto ambiente já retornou ao pai. Sem contexto válido
  não inventa IDs. Identificadores não devem virar labels Loki/Prometheus.
- Projeções automáticas de HTTP preservam somente método e status, sem URL,
  query, headers, corpo, IP ou detalhes de exceção. O roteamento não é alterado.
  Interceptor e filtros usam categoria/status enumerados, sem mensagem/código
  arbitrário, stack ou URL; logger com falha não reexecuta o handler nem impede
  a resposta. O interceptor mede uma conclusão/erro, não cada item do stream;
  cancelamento sem conclusão não é anunciado como sucesso.
- `toProblemDetails` e seus detalhes públicos permanecem compatíveis; isso não
  certifica que cada origem de HttpException esteja livre de dados sensíveis.
  Os testes exercitam também retry-after e contratos existentes de chat/pagamentos.
  Logs textuais/arbitrários, console, bibliotecas e campos fora das projeções
  continuam exigindo inventário; não existe redaction semântica universal.
- O filtro Sentry envia à sua interface SDK uma exceção normalizada sem stack
  original, tags de método/status/categoria e IDs técnicos. Ele não está registrado
  no `AppModule`; a suíte usa fake SDK, sem init/exportação externa. Integrações,
  breadcrumbs, request/context/user/attachments, beforeSend e outros canais do
  SDK continuam sem política de coleta homologada. Não habilitar Sentry com base
  apenas na proteção deste filtro. Seu lifecycle/configuração seguem fora dessa
  homologação; não foram unificados com o bootstrap OTel.
- Métricas `storefront_llm_*` distinguem operação concluída de decisão de contrato,
  fallback e resultado incerto. Tokens precisam de uso válido informado pelo
  provider; custo é estimado somente para modelos tabelados, não é faturamento.
  Logs/spans novos não carregam prompts, histórico, argumentos/resultados ou PII.
- Os scripts `start`, Dockerfile e CI pesquisados continuam usando `dist/main.js`.
  Esse entrypoint agora carrega os dois `.env` na precedência anterior (ambiente do
  processo prevalece), inicializa tracing e só então importa
  `application-bootstrap.js`. A aplicação/Nest não é importada estaticamente por
  `main.ts`. `src/tracing.ts` é uma fachada sem inicialização automática de SDK.
- Sem endpoint, com `OTEL_SDK_DISABLED=true` ou `OTEL_TRACES_EXPORTER=none`, não se
  cria SDK/exportador. Exportadores configurados diferentes de `otlp` são recusados.
  Endpoint genérico recebe `/v1/traces` uma única vez; o endpoint específico
  `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` tem precedência e é tratado como URL completa.
  URLs com credenciais/query/fragmento ou protocolo diferente de HTTP(S) são
  recusadas, sem imprimir seus valores. Para produção, exigir transporte/acesso
  apropriados; HTTP existe para receptores locais/privados, não é garantia de sigilo.
- Amostragem explícita padrão: `parentbased_traceidratio`, root ratio `0.1`.
  Configurar `OTEL_TRACES_SAMPLER_ARG` entre 0 e 1; configurações inválidas desligam
  tracing. Também são aceitos `traceidratio`, `always_on`, `always_off`,
  `parentbased_always_on` e `parentbased_always_off`. Parent-based preserva decisões
  do pai: não é um limite global rígido de 10% nem uma proteção contra abuso.
- Instrumentação automática fica desligada por padrão; spans manuais continuam
  disponíveis com o SDK ativo. `OTEL_AUTO_INSTRUMENTATION=enabled` é um opt-in
  separado, ainda não habilitado/homologado. OTel documenta requisitos de loader
  hook para bibliotecas ESM: inicializar antes dos imports não prova cobertura
  automática de Express/Prisma/fetch. Não adicionar preload/hook externo sem
  verificar compatibilidade e impedir SDK concorrente.
- O exporter projeta atributos por allowlist: dados estruturados de operação,
  ferramentas conhecidas, IDs opacos e tokens/custo limitados. Remove prompts,
  conteúdo, URL, SQL, exceções, links, traceState, resource/process metadata e
  nomes de spans desconhecidos. Nomes não reconhecidos viram `application.operation`.
  Isso reduz detalhes de spans automáticos deliberadamente; não homologamos
  painéis para esse formato. Os exporters de logs/métricas e resource detectors
  do NodeSDK são explicitamente desabilitados, evitando exportação incidental.
- `TracingRuntime` inicializa uma vez, não repete em falha e não registra handlers
  concorrentes de SIGTERM/SIGINT. O lifecycle do Nest aguarda flush e shutdown com
  timeout de 2,5 s por fase. Falhas de telemetria não repetem operações nem param
  a inicialização comercial. SIGKILL/crash não garantem flush; o teste não simulou
  encerramento real do container/Railway.
- Logs gerenciados mantêm os dois aliases de trace/span; o derived field histórico
  `trace_id` pode consumir o mesmo ID validado. Confirmar no backend/painéis antes
  de afirmar correlação operacional. O Promtail antigo com campos não permitidos
  está arquivado/desconectado; a nova projeção Alloy não os encaminha.
  `METRICS_ENABLED` no exemplo histórico não é um gate usado pelo controller;
  a proteção de produção depende de `NODE_ENV`/`OPS_SHARED_SECRET`.

Prova atual: composição HTTP Nest/Express local; SDK real com exportador em memória;
um POST OTLP real para receptor TCP em loopback, com canários privados ausentes;
entrypoint ESM em subprocesso com `.env`/SDK/aplicação substituídos por doubles;
shutdown de aplicação Nest isolada. Não houve DB, Redis, LLM, exportação externa,
auto-instrumentação ESM completa ou aplicação/container real de produção.
Também há 28 contratos da fronteira do caso de uso: correlação assíncrona, writes
simulados, integração do entrypoint do adaptador e DI Nest isolada. Não é prova
de gravação/atomicidade no banco real ou de toda a composição `AppModule`.
Somam-se 31 contratos da fronteira de nudge, incluindo o copy service real com
provider simulado, tokens contabilizados uma vez, ofertas preservadas, correlação
paralela e exporter em memória. A etapa 13 adiciona 30 contratos de logging, com
HTTP Pino real e Nest/Pino/SDK em memória, além de contratos legados incorporados.
Há também contratos dos artefatos e validação nativa isolada. Não houve
chamada real a LLM ou validação dos provedores/modelos em produção.
Continuidade e pendências:
[relatório de contratos do storefront](../../apps/api/tests/storefront-contracts.md).

```powershell
pnpm --filter @zyon/api test:storefront-observability
```

## Arquitetura proposta e exemplos históricos — operação ainda não homologada

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│   Widget    │────▶│   API (NestJS)│────▶│ External APIs │
│  (browser)  │     │              │     │ Shopify/Asaas │
└─────────────┘     └──────┬───────┘     └───────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  Tempo   │ │   Loki   │ │Prometheus│
        │ (traces) │ │  (logs)  │ │(metrics) │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │            │            │
             └────────────┼────────────┘
                          ▼
                    ┌──────────┐
                    │ Grafana  │
                    │(unified) │
                    └──────────┘
```

## Data Flow

### Traces (API → Tempo via OTLP)
- Auto-instrumentação proposta, não homologada: HTTP, Prisma, Express middleware
- Custom spans needed: business operations (checkout flow, payment processing)
- Protocol: OTLP HTTP → `http://tempo:4318/v1/traces`
- Propagation: W3C TraceContext (`traceparent` header)

### Logs (API Docker marcada → Alloy opt-in → Loki)
- Format: JSON (Pino structured logs)
- Enrichment gerenciado: `requestId`, `traceId`/`spanId` e aliases `trace_id`/`span_id` quando válidos
- Collection: Docker API opt-in → projeção gerenciada Alloy → Loki
- Correlation: Loki → Tempo via trace_id derived field

### Metrics (API `/metrics` → Prometheus)
- Existing: checkout_started, order_completed, payment_approved, outbox_lag, llm_latency
- New: checkout_duration, payment_webhook_latency, shipping_quote_latency
- Endpoint: `GET /metrics` (Prometheus text format)
- Auth: OPS_SHARED_SECRET in production

## Correlation Strategy

Logs gerenciados incluem IDs de trace/span apenas quando há contexto válido;
nem todo log tem trace, e nem todo trace é amostrado/exportado.
Grafana Loki → Tempo link: derived field regex `"trace_id":"([a-f0-9]+)"`.
Tempo → Prometheus: span metrics generated by Tempo metrics_generator.

## Environment Variables

```env
# Tracing (Tempo)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=zyon-api

# Metrics (Prometheus scrapes /metrics)
METRICS_ENABLED=true
OPS_SHARED_SECRET=<secret for /metrics auth>

# Logging
LOG_LEVEL=info   # debug in dev
NODE_ENV=production  # JSON output (no pino-pretty)
```

## Quick Start

```bash
cd infra/observability
docker compose up -d

# API connects to:
# - Tempo at localhost:4318 (traces)
# - Prometheus scrapes API at localhost:3001/metrics
# - Logs are NOT collected by default. The `logs` profile and API label are required.

# Grafana available at http://localhost:3100
# Credentials: admin/admin
```

## Instrumentation Map (Where to Add Custom Spans)

### Auto-instrumentação pendente — não homologada/ativada
- HTTP inbound requests (Express)
- HTTP outbound requests (fetch/http)
- Prisma database queries

### Needs Manual Spans (business operations)
| Operation | File | Span Name |
|-----------|------|-----------|
| Checkout session start | `start-checkout.use-case.ts` | `checkout.start` |
| Chat message processing | `send-chat-message.use-case.ts` | `checkout.chat` |
| LLM conversation call | `conversation-engine/langgraph-agent.ts` | `llm.conversation` |
| Offer evaluation | `offer-factory.ts` | `checkout.offer.evaluate` |
| Payment intent creation | `create-payment-intent.use-case.ts` | `payment.create_intent` |
| Payment confirmation | `confirm-crypto-payment.use-case.ts` | `payment.confirm_crypto` |
| Webhook processing | `handle-asaas-webhook.use-case.ts` | `payment.webhook.asaas` |
| Webhook processing | `handle-stripe-webhook.use-case.ts` | `payment.webhook.stripe` |
| Commerce order sync | `sync-pending-order.use-case.ts` | `commerce.sync_order` |
| Shopify API call | `tenant-commerce-adapter.factory.ts` | `shopify.api_call` |
| Shipping quote | `evaluate-shipping.use-case.ts` | `shipping.quote` |
| Outbox dispatch | `outbox-dispatcher.service.ts` | `outbox.dispatch_batch` |
| Coupon validation | `validate-coupon.use-case.ts` | `coupon.validate` |

### Backlog de painéis gerais — não entregue por este dashboard storefront

1. **Service Overview** — request rate, error rate, latency P50/P95/P99
2. **Checkout Funnel** — sessions started → offers → orders → payments
3. **Payment Health** — intent creation latency, webhook processing time, failure rate
4. **Commerce Sync** — Shopify webhook lag, order sync success/failure
5. **LLM Performance** — latency, token cost, safety violations
6. **Infrastructure** — DB pool utilization, outbox lag/DLQ depth, Redis health
