# Outbox com lease e encerramento — API-016 / API-037

Branch: `fix/ready-to-prod-audit`. Base da terceira etapa: `ebb954a`. **Produção continua NO-GO.** Este registro complementa o [ADR de infraestrutura compartilhada](api/ADR-api-shared.md) e a [decisão de mensageria](ADR-ASYNC.md).

| Achado | Resultado local | Limite de aceite |
| --- | --- | --- |
| API-016 | Parcial: aquisição durável, recuperação e escritas protegidas pelo lease implementadas e validadas | O dispatcher entrega pelo menos uma vez. Impedir repetição de efeitos exige idempotência de cada consumidor e de cada provedor. |
| API-037 | Implementado e validado localmente para o dispatcher compartilhado | Carga, sinais reais de encerramento em contêiner e comportamento dos demais workers continuam pendentes. |

## Decisão e comportamento

O [repositório PostgreSQL](../../../../apps/api/src/shared/messaging/infrastructure/prisma-outbox.repository.ts) adquire eventos com `SELECT FOR UPDATE SKIP LOCKED` e atualiza estado, token, expiração e tentativa na mesma transação. O lock de consulta passa a produzir um lease persistido; não permanece aberto durante o handler ou chamadas externas. A seleção respeita a próxima tentativa e recupera registros `processing` cujo lease expirou ou está ausente.

O lease dura 120 segundos. O [dispatcher](../../../../apps/api/src/shared/messaging/outbox-dispatcher.service.ts) renova a cada 30 segundos e confirma a posse antes de cada handler. Renovação, confirmação do evento, marca por handler, falha e devolução de trabalho ainda não iniciado exigem `event_id`, token atual, estado `processing` e lease ainda válido. Um trabalhador antigo não pode confirmar ou alterar o resultado de uma nova aquisição. Falha de renovação interrompe os próximos efeitos e confirmações do trabalhador local; um efeito já iniciado pode continuar.

Cada aquisição consome uma tentativa, inclusive quando o processo cai. Após cinco tentativas, o evento vai para `dead`; o próximo polling também encerra uma quinta tentativa que expirou após crash. Falhas de handler voltam a `pending` com atraso exponencial de um segundo e teto de 60 segundos. Um append repetido com o mesmo `event_id` não reativa um evento entregue ou morto. `listPending` é apenas inspeção. Os métodos legados que marcavam entrega ou handler sem token agora rejeitam com `outbox_claim_required` nos adaptadores compartilhados e no adaptador Prisma do checkout.

O evento entregue ao handler inclui `eventId`, `correlationId`, `causationId` e `schemaVersion`. Uma marca persistida por `(event_id, handler_id)` permite retomar a lista depois de uma falha sem repetir handlers já confirmados. Eventos sem handler ou com IDs de handler duplicados falham explicitamente e seguem retry/dead, em vez de serem marcados como entregues. Os IDs devem permanecer estáveis entre réplicas e versões; o fallback posicional do bus continua disponível para compatibilidade e não deve ser usado por novos consumidores duráveis.

O `StrategyFeedbackWorker` passou a assinar o bus compartilhado com ID estável, usando o dispatcher para entrega e retry. O registro da lição usa a proteção transacional própria do consumidor. A [integração entre módulos](../../../../apps/api/tests/stage3-cross-module.integration.test.mjs) disputa 20 gravações de lição por duas instâncias de repositório, exige um único efeito e verifica a rejeição de vínculo entre tenants; sua execução integra a evidência consolidada da etapa. O [tratamento de estoque](CORRECOES-INVENTORY.md) documenta separadamente sua idempotência e os efeitos de integração.

## Concorrência e encerramento

O dispatcher começa após `onApplicationBootstrap`, depois do registro dos handlers. Há uma rodada local por vez, polling a cada 100 ms, até 50 eventos por rodada e concorrência padrão de quatro handlers de eventos. Cada lote adquirido cabe nos slots de execução; não há uma fila local de eventos já adquiridos esperando atrás de um handler lento. A implementação aguarda o lote inteiro antes de buscar outro, de modo que um handler lento reduz o aproveitamento dos demais slots.

`onModuleDestroy` impede novas aquisições, para o polling e aguarda a rodada ativa por até 30 segundos. Claims recebidos durante o encerramento, antes de qualquer handler, são devolvidos sem consumir tentativa quando ainda há tempo para finalizar a devolução. Se o prazo terminar, o dispatcher para os heartbeats e bloqueia confirmações tardias. Não libera antecipadamente um efeito em execução: o lease expira para outra réplica recuperá-lo. O handler em execução não é cancelado automaticamente.

A desconexão do Prisma foi movida para `onApplicationShutdown`, que ocorre depois dos hooks de destruição dos módulos. O teste Nest real demonstrou a sequência handler iniciado → handler concluído → desconexão do Prisma. Isso não demonstra o encerramento de todos os outros recursos da aplicação, nem garante finalização de um handler que exceda o prazo.

O dispatcher emite códigos de falha estáticos, quantidade de eventos pendentes/em processamento/mortos e idade do pendente mais antigo. Há avisos de backlog com idade de pelo menos 60 segundos, eventos mortos e handler com duração de pelo menos 30 segundos. Esses registros não substituem alarmes configurados, métricas exportadas ou teste de capacidade. Erros de infraestrutura introduzem cooldown local de dez segundos.

## Evidências verificadas

| Verificação | Resultado | Escopo comprovado |
| --- | --- | --- |
| [Suíte do dispatcher](../../../../apps/api/src/shared/messaging/outbox-dispatcher.service.spec.ts) | 15 testes passam; zero falhas/skip | Concorrência limitada, retries, retomada por handler, drain, prazo, claim retornando durante shutdown, rejeição de conclusão antiga e rollback de append. |
| [Integração PostgreSQL e Nest](../../../../apps/api/tests/outbox-leases.integration.spec.ts) | Nove testes passam; zero falhas/skip | 16 instâncias de repositório disputam 40 eventos, 20 falhas concorrentes têm uma vencedora, recuperação de lease, bloqueio de token antigo, crash após efeito, esgotamento, rollback, shutdown Nest e SQL real. |

Os testes de disputa usam instâncias de repositório sobre conexões do pool PostgreSQL; não representam 16 processos separados. O teste de crash simula a interrupção após efeito e antes da marca. Ele observa duas invocações do handler e uma mutação de negócio porque o consumidor da fixture usa chave única, demonstrando a necessidade de deduplicação no próprio efeito.

Os logs dirigidos inspecionados estão no worktree em `.audit/verification/outbox-stage3-unit.log` e `.audit/verification/outbox-stage3-pg.log`. A seleção versionada [run-ready-prod-tests.mjs](../../../../apps/api/tests/run-ready-prod-tests.mjs) inclui a suíte compartilhada e, com `--database`, a integração PostgreSQL. A integração exige `READY_PROD_TEST_DATABASE_URL` em loopback com banco `ready_prod_test` e `READY_PROD_TEST_PRISMA_CLIENT` apontando para o cliente Prisma gerado isoladamente. A execução da seleção completa também exige Redis descartável. Os resultados dirigidos não substituem o typecheck, a composição global ou a regressão consolidada da etapa.

## Migração e limites restantes

A [migração aditiva](../../../../apps/api/prisma/migrations/20260906011000_outbox_leases/migration.sql) adiciona `lease_token`, `lease_expires_at` e índice por estado/expiração. O teste executa esse SQL em schema próprio e preserva exemplos históricos `pending` e `delivered`. No rollout, aplicar a migração no diretório ativo após o baseline completo e drenar os workers antigos antes de habilitar os novos: código antigo continua capaz de ignorar a posse persistida. Não usar rollback para o consumidor antigo com processamento ativo.

Continuam pendentes:

- Idempotência comprovada de cada efeito externo e de cada consumidor. Crash entre efeito e marca pode repetir envio; handlers que absorvem falhas ainda impedem retry útil. O achado de notificações API-024, por exemplo, não é encerrado por este patch.
- Ordem por agregado ou tenant: a ordenação da seleção não garante ordem de conclusão entre eventos concorrentes, nem impede que um evento posterior ultrapasse outro em retry.
- Compatibilidade dos IDs e do conjunto de handlers durante mudanças de versão. Um evento entregue não é reaberto automaticamente para um consumidor adicionado depois.
- Reconciliação de registros históricos `failed` ou `dead`, replay autorizado com trilha de auditoria e política de retenção. Não foi criado endpoint de replay nem limpeza automática.
- Monitoramento operacional, capacidade sob provedor lento e banco indisponível, margem do prazo de encerramento no orquestrador, sinais reais e interrupção abrupta do processo.
- Publicações diretas via `DomainEventBus.publish` continuam locais e não passam a ser duráveis apenas porque o dispatcher foi corrigido. A atomicidade entre mutação de domínio e append depende da transação usada por cada produtor.

Nenhum teste com provedor real, deploy, push ou merge foi realizado para esta frente.
