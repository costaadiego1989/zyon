# API-026 — Inbox durável de BubbleWhats

Implementado localmente em `fix/ready-to-prod-audit`, em 2026-09-05. A decisão resolve autenticação e aceitação durável dos callbacks BubbleWhats; o canal completo continua **NO-GO para produção**. A [auditoria original](api/ADR-api-whatsapp-channel.md) permanece como retrato histórico.

## Contrato de entrada

`POST /webhooks/whatsapp/bubblewhats/messages` e `POST /webhooks/whatsapp/bubblewhats/status` continuam retornando `200 { received: true }`, mas somente depois do commit da inbox. Esse retorno confirma armazenamento, não envio de resposta nem finalização de compra.

- O device precisa mapear exatamente uma configuração BubbleWhats. Mapeamento inexistente ou provedor divergente responde 401; mapeamento ambíguo, canal desligado ou segredo não configurado responde 503.
- `x-webhook-secret` é obrigatório e comparado em tempo constante sobre hashes SHA-256. Segredo ausente/incorreto responde 401. Não há valor padrão nem confiança no merchant informado pelo corpo. O endpoint de ativação também rejeita BubbleWhats sem segredo configurado.
- Grupos e mensagens próprias exigem autenticação e são persistidos como eventos ignorados; não acionam o pipeline.
- Mensagens exigem ID estável do provedor, remetente, tipo, timestamp válido e limites de tamanho. Status aceita de 1 a 100 transições válidas por requisição. Payload inválido responde 400 antes de qualquer insert.
- Mensagens usam identidade `(BUBBLEWHATS, merchant, config, message, provider-id)`. Status usa `(provider-message-id, remoteJid, fromMe, status)` dentro da mesma configuração, independente da ordem ou agrupamento do batch. A identidade é persistida com índice único.
- Reentrega idêntica não sobrescreve payload, tentativas nem conclusão. Mesmo ID com payload normalizado diferente responde 409. Todo batch de status é transacional; falha de persistência responde 503, sem confirmação falsa.

Código: [admissão](../../../../apps/api/src/modules/whatsapp-channel/application/use-cases/accept-bubblewhats-webhook.use-case.ts), [controller](../../../../apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-webhook.controller.ts), [repositório](../../../../apps/api/src/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-webhook-inbox.repository.ts).

## Processamento e falhas

Um worker Nest consulta a inbox PostgreSQL a cada segundo e processa até 20 eventos por rodada. O mecanismo usa o banco existente e não adiciona broker. A decisão BullMQ do projeto continua preservada.

O claim usa `UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED)` na mesma transação, troca um token de posse e incrementa tentativas. Lease de 120 segundos, renovado a cada 30 segundos, permite recuperação após queda do processo. Conclusão, falha e renovação exigem token atual e lease ainda válido; worker antigo não consegue sobrescrever o estado depois de outro claim. Eventos pendentes/em processamento do mesmo comprador bloqueiam mensagens posteriores; compradores distintos podem avançar em paralelo.

Antes de executar, o worker confere novamente merchant, ID da configuração, device, provedor, enablement e existência do segredo. Configuração removida, remapeada ou desligada mantém o evento para retry. Rotacionar um segredo válido não invalida um evento já autenticado e aceito. A verificação ocorre antes da execução; alterações durante uma chamada externa em andamento não cancelam esse envio.

Falhas retornam o evento para `pending`, com backoff de 5 segundos dobrando até o teto de 30 minutos. Na décima tentativa, o estado passa a `dead`; expiração do lease na última tentativa também termina em `dead`. Uma reentrega do provedor não reativa um evento morto. O encerramento do worker interrompe novas rodadas e aguarda a tentativa ativa.

O pipeline de entrada, a persistência da sessão/menu e o envio agora propagam falhas para permitir retry. O envio não fabrica sucesso quando o adapter retorna `failed`; BubbleWhats usa timeout de 15 segundos, rejeita redirects e sua resposta não é encaminhada primeiro para Twilio. Não se envia mensagem alternativa de erro após uma tentativa falha. Logs desses caminhos usam códigos/status e identificadores internos, sem texto de mensagem, telefone ou corpo/erro retornado pelo provedor.

Código: [worker](../../../../apps/api/src/modules/whatsapp-channel/application/services/whatsapp-webhook-worker.service.ts), [pipeline](../../../../apps/api/src/modules/whatsapp-channel/application/use-cases/handle-incoming-message.use-case.ts), [envio](../../../../apps/api/src/modules/whatsapp-channel/application/use-cases/send-whatsapp-response.use-case.ts).

## Migração, operação e limites

Aplicar a [migração aditiva](../../../../apps/api/prisma/migrations/20260905230000_whatsapp_webhook_inbox/migration.sql) antes de subir os novos handlers/workers. Esta branch usa `prisma/migrations`; integrar a migração ao diretório ativo da branch de destino, depois do baseline completo, sem reaplicar ou substituir esse baseline. O rollback do código antigo reabre a autenticação opcional e o reconhecimento anterior ao commit.

A tabela contém texto de mensagens, números e URLs de mídia. Não há expurgo automático neste lote. Definir acesso restrito, retenção de payload, backup e limpeza auditável antes da liberação. Preservar a chave de deduplicação por todo o horizonte de reentrega/replay contratado com o provedor; remover o registro cedo permite novo processamento. Depois do prazo de retenção do conteúdo, um mecanismo futuro poderá remover o payload mantendo a identidade de deduplicação. Não executar limpeza global nem apagar eventos pendentes/mortos para liberar espaço.

Monitorar quantidade/idade de `pending`, leases expirados, tentativas e `dead`. Eventos mortos exigem conciliação e reprocessamento administrativo auditado; este lote não oferece botão público de replay. Reprocessar apenas depois de verificar efeitos anteriores e corrigir a causa; o operador precisa considerar mensagens que foram enviadas apesar de uma resposta HTTP perdida.

Não há garantia de envio externo exatamente uma vez. Queda após aceite do provedor e antes de `processed`, perda de conexão/lease durante envio ou retry depois de alteração de menu pode repetir resposta e efeitos do pipeline. O token de lease protege a inbox; não desfaz uma operação externa já em andamento. É necessário contratar/validar idempotência do provedor ou implementar outbox de resposta com referência verificável para fechar esse risco.

O `callEngine` do canal continua retornando respostas determinísticas locais; não foi conectado ao fluxo completo de compra. Os callbacks de status ficam preservados na inbox, mas ainda não alimentam projeção de analytics. Provisionamento e envio real em BubbleWhats, contrato dos IDs/batches, retenção/retry do provedor e testes HTTP de ponta a ponta permanecem gates.

Twilio não foi migrado para esta inbox. Seu handler passou a aguardar o pipeline para não gerar rejeição de Promise não tratada após a propagação de erros. Autenticação opcional, dedup em memória antes da validação e ausência de aceitação durável de Twilio continuam pendentes; esta correção não declara o webhook Twilio seguro ou recuperável.

## Evidência executada

**13 testes unitários e 9 integrações PostgreSQL passaram.** Nenhuma chamada externa foi realizada; o adapter de envio é substituído por double nos testes do pipeline e o adapter HTTP real usa `fetch` simulado para verificar timeout, bloqueio de redirects e ausência de segredos/PII nos logs.

Os testes verificam segredos ausentes/incorretos, grupos/self, configuração inválida, espera pelo commit no controller, 400/401/409/503, batch normalizado e tenant derivado. O pipeline de entrada/envio real propaga falha do adapter, e erro ao persistir sessão/menu impede sucesso aparente. Shutdown aguarda processamento ativo.

No PostgreSQL 16 descartável, 40 entregas simultâneas geram um registro e 20 workers produzem um claim. Foram executados colisão/rollback de batch, dedup por tenant e status, recuperação após lease expirado com bloqueio do worker antigo, ordem por comprador, backoff/dead-letter, queda na última tentativa e recuperação de falha real do pipeline em novo worker. A migração SQL foi aplicada em schema exclusivo e suas constraints verificadas.

Fontes: [testes unitários](../../../../apps/api/src/modules/whatsapp-channel/application/use-cases/bubblewhats-inbox.spec.ts), [integrações e migração](../../../../apps/api/src/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-webhook-inbox.integration.spec.ts).
