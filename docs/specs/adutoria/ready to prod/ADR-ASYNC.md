# ADR — arquitetura assíncrona

Data: 2026-09-05. Status: decisão recomendada pela auditoria, implementação posterior. **KEEP BULLMQ. Não migrar para RabbitMQ neste ciclo.**

## Arquitetura atual

Outbox persistido em PostgreSQL, dispatcher por timer e registro de execução por handler; domain event bus em processo; BullMQ para marketplace-catalog-sync; outros jobs usam timers e alguns canais usam void Promise. BullMQ não é hoje o transporte durável de todo o sistema.

O scheduler do catálogo configura três tentativas, backoff exponencial de 1s, retenção de 100 completados e 500 falhos. Há close de fila/worker. O payload não inclui eventId/version e o enqueue não usa jobId. Sem REDIS_URL o código escolhe processamento em processo; isso difere de queda de um Redis já configurado. Fonte: `apps/api/src/modules/marketplace/application/handlers/marketplace-catalog-sync.handler.ts:83`.

## Dores observadas

[API-016](<api/ADR-api-shared.md#api-016>) claim sem lease durável; [API-037](<api/ADR-api-shared.md#api-037>) shutdown incompleto; [API-040](<api/ADR-api-marketplace.md#api-040>) identidade/ordering da fila; [API-017](<api/ADR-api-inventory.md#api-017>) consumidor absorve erro; [API-024](<api/ADR-api-notifications.md#api-024>) canal pode fingir sucesso; [API-026](<api/ADR-api-whatsapp-channel.md#api-026>) acknowledgment sem inbox. Essas são garantias de aplicação/persistência que precisam correção com qualquer broker.

## Requisitos e trade-offs

| Aspecto | Requisito/decisão |
| --- | --- |
| Tráfego esperado | Sem medição de produção ou SLO fornecido. 10.000 usuários é cenário de carga a validar, não dimensionamento de jobs/s. |
| Entrega | At-least-once com efeito idempotente, auditável e conciliável. Não prometer exactly-once para DB+HTTP sem protocolo do provedor. |
| Ordering | Por payment intent, pedido, estoque/reserva e produto/version; não há justificativa para ordem global. |
| Routing | Jobs de aplicação em monólito; nenhuma exigência comprovada de routing complexo entre serviços independentes. |
| Retries | Classificar transient/permanent/ambiguous, deadline, backoff+jitter e limites. Não repetir POST financeiro sem idempotência. |
| Failure isolation | Filas/concurrency separados para AI, catálogo, notificações e integrações; tenant barulhento não deve bloquear pagamento. |
| Dead-letter | Retenção suficiente, owner, alertas, replay por evento/tenant e auditoria. Replay não deve exigir editar status manualmente. |
| Redis failure | Definir durabilidade/persistência/eviction/TLS e política de indisponibilidade; não silenciosamente perder dados financeiros. |
| Complexidade operacional | Redis/BullMQ já presentes. RabbitMQ adiciona cluster, conexões, permissions, monitoração, DLX/routing e migração sem fechar as falhas de negócio. |
| Limitações BullMQ atingidas | Nenhum limite de throughput/routing documentado ou medido nesta auditoria. |
| Vantagens RabbitMQ necessárias | UNVERIFIED: não há requisito atual comprovado que obrigue a migração. |
| Custo de migração | Reescrever produtores/consumidores, contratos, deploy e observabilidade; operação paralela e reconciliação elevam risco no caminho financeiro. |

## Plano incremental

1. Corrigir claim transacional SQL e persistir inbox/outbox com IDs/versão/correlation/tenant.
2. Tornar consumers idempotentes e remover captura de erro que vira sucesso.
3. Encapsular jobs em portas próprias e padronizar retries/dead-letter.
4. Configurar Redis com durabilidade e TLS, validar concorrência/ordering e shutdown.
5. Medir backlog/oldest age/p95/erro antes de avaliar outro broker.

Jobs precisam ser desenhados para repetir com o mesmo resultado de negócio, conforme a [documentação de jobs idempotentes do BullMQ](https://docs.bullmq.io/patterns/idempotent-jobs). A correção de dispatcher HTTP deve respeitar a interface de [custom dispatcher do fetch do Node](https://nodejs.org/api/globals.html#custom-dispatcher); Agent HTTP nativo não satisfaz essa interface.

FOR UPDATE SKIP LOCKED pode ajudar consumidores de fila, mas precisa ser combinado com transação/claim que preserve exclusividade no modelo da aplicação; ver [PostgreSQL SELECT e locking](https://www.postgresql.org/docs/current/sql-select.html). Aqui o SELECT isolado não mantém ownership durante o handler.

## Critérios de reconsideração

Reabrir ADR somente se houver requisito comprovado de comunicação entre serviços independentes, routing/isolamento não atendido, ou limite medido de operação que justifique custo. A alternativa rejeitada neste ciclo é migrar broker antes de corrigir consistência. O resultado esperado é monólito com trabalho durável e contrato explícito.
