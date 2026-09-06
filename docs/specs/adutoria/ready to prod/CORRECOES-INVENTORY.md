# Estoque após venda — API-017

Terceiro lote da API. Implementação local e evidência de banco; produção continua NO-GO.

## Comportamento

`InventoryOnOrderCompletedHandler` usa o símbolo obrigatório `CHECKOUT_SESSION_REPOSITORY`, exportado por `CheckoutPersistenceModule`. Composição Nest verifica a resolução do repositório real. Falhas de sessão, payload, estoque ou persistência chegam ao outbox e mantêm a entrega elegível para retry; itens ausentes não são contados como baixa realizada.

Eventos novos `order.completed` contêm `inventory_sale.version = 1`, com itens e dados da venda capturados durante a conclusão do pedido. O consumidor usa esse snapshot, preservando identidade de merchant/pedido do envelope. Eventos legados sem snapshot consultam a sessão pelo par merchant/session e falham se ela estiver ausente ou pertencer a outro tenant. Como um carrinho legado pode ter mudado, conciliar esses eventos antes de liberar o processamento em produção.

A baixa cria um recibo único por merchant/pedido. Seu hash cobre itens normalizados, quantidade, localização explícita quando fornecida e valor da venda. Repetir a mesma venda devolve o recibo sem outra baixa. Alterar uma quantidade com o mesmo pedido gera conflito. IDs de pedido iguais em merchants distintos permanecem independentes. Perfil do comprador e timestamp de redelivery não autorizam outra baixa.

Uma transação serializa vendas por merchant, bloqueia os itens e grava baixa, movimentação EXIT, alerta aplicável, recibo e três mensagens de integração. Falha em qualquer uma dessas gravações desfaz todas. A disponibilidade respeita `quantity - reserved`; saldo reservado não é consumido por essa projeção. Sem localização explícita, é obrigatório existir exatamente um depósito padrão ativo da loja. O código não assume um ID literal `default`, não escolhe arbitrariamente entre depósitos e verifica o vínculo do depósito ao tenant. SKUs repetidos na mesma alocação são somados antes da baixa.

Inventory permanece uma projeção operacional independente de `ProductStock`/`StockReservation`, preservados neste lote. Isso não estabelece uma fonte única de estoque entre catálogo, inventory e ERP. Ajustes manuais, transferências e importações do restante do módulo não foram reescritos; conciliar e validar esses escritores continua obrigatório. O lock por merchant simplifica conservação e pode limitar throughput de uma loja; carga real permanece pendente.

## Integrações independentes

Cada recibo produz `inventory.sale.erp_sync_requested`, `inventory.sale.crm_sync_requested` e `inventory.sale.webhook_requested`, schema 1, producer `inventory`. Os handlers carregam o recibo pelo tenant e não chamam novamente a baixa. Erro de uma integração não impede a entrega das outras nem altera o estoque já confirmado.

ERP recebe quantidade absoluta pós-baixa, depósito e chave idempotente estável por recibo/item. Não existe adapter ERP conectado à porta na composição atual: o job falha com `inventory_erp_adapter_unavailable`, em vez de declarar sucesso. Um adapter futuro deve respeitar idempotência e ordenação/versionamento, pois snapshots de vendas diferentes podem ser entregues fora de ordem. O teste demonstra retry isolado com double, não sincronização em ERP real.

CRM exige uma conexão ativa e credenciais; ausência, ambiguidade, provider desconhecido e falhas de transporte/HTTP são propagadas. Os adapters existentes recebem timeout e não absorvem mais erro como sucesso. Chamadas externas permanecem ao menos uma vez: uma queda após criar um negócio e antes de confirmar o job pode duplicar o negócio no CRM. Deduplicação/reconciliação por pedido no provedor continua gate de produção. Não houve teste com credenciais ou tráfego real.

O handler de webhook persiste deliveries apenas para endpoints ativos da loja inscritos em `inventory.item.decremented`. IDs de evento/delivery são determinísticos; retry concorrente preserva uma delivery por endpoint/item. Essa confirmação significa **persistência na fila**, não envio HTTP. O dispatcher externo e seus achados originais continuam fora deste patch. Merchant sem assinatura desse evento não gera delivery; a verificação das assinaturas foi concluída sem destinatários.

Jobs ERP/CRM de capacidades sem configuração continuarão falhando até a política de retries/dead-letter do outbox. Configurar ou definir explicitamente quais integrações habilitar por merchant antes do rollout; não interpretar recibo de estoque como entrega dos provedores.

## Migração, rollout e evidência

Adicionar `20260906012000_inventory_sale_receipts` ao diretório ativo da versão integrada, depois da baseline. A tabela conserva recibos/idempotência; não apagá-la durante replay ou rollback. Drenar os handlers antigos antes da troca, pois eles não consultam recibos e podem repetir baixas. Conciliar movimentações antigas `sale_completed` antes de reenfileirar eventos anteriores à migração: elas não possuem recibo confiável e não são adotadas automaticamente.

Regressões novas: 10 testes PostgreSQL, 6 testes unitários/composição e 1 teste SQL da migração. Cobrem 20 entregas concorrentes em duas instâncias, disputa do último saldo livre, rollback de várias linhas e de erro no outbox, alteração de payload no replay, múltiplos depósitos, tenant, vínculos de depósito corrompidos, falta/ambiguidade de padrão, quantidades inválidas, IDs iguais entre lojas e 10 gravações concorrentes da mesma delivery. Os 19 testes anteriores do módulo também foram executados; seus doubles não substituem os testes reais novos. Typecheck isolado da API passou. Resultados consolidados ficam no registro do terceiro lote.
