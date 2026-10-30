# Auditoria durável de criação de cotação e remessa

Diagnóstico de produção somente leitura: deployment `46d1351a-cceb-4d8d-819b-ed1c3dc9eef7`, em 30/10 às 22:48:48 UTC.

| Evento | Criado em UTC | Resultado |
| --- | --- | --- |
| `shipping.quote.created`, `evt_d9f4801d-1afd-49dd-b8e4-2434e0f05403` | 20:50:58 | dead, 5 tentativas, `outbox_handler_missing`, nenhuma execução de handler |
| `shipment.created`, `evt_892a9d0f-870f-4935-aaa0-5f60668b4e63` | 21:03:39 | dead, 5 tentativas, `outbox_handler_missing`, nenhuma execução de handler |

O runtime compilado contém os produtores, mas nenhuma inscrição literal para esses eventos. O dispatcher exige pelo menos um handler e falha antes de qualquer efeito quando a lista está vazia. A causa não é rejeição do pagamento nem falha de estoque.

A cotação já é persistida pelo módulo shipping; a remessa já é criada pelo consumidor de `order.completed`. Esses dois eventos são informativos. O consumidor legítimo adicionado é a auditoria operacional durável da loja, em `merchantAuditEvent`, com action/resource vinculados à cotação ou ao registro de remessa. Não é um handler vazio: a persistência precisa concluir antes de o outbox registrar a execução e a entrega.

- Inscrições estáveis nos módulos proprietários: `shipping.quote-created.audit.v1` e `fulfillment.shipment-created.audit.v1`.
- Envelope versão1, identificadores e escopo da loja validados; payload merchant contraditório é rejeitado.
- Identidade de auditoria deriva de tenant + eventId, com upsert imutável para suportar at-least-once.
- CEP, endereço, quote_key e texto de comprador não são persistidos no audit.
- Nenhuma compra de etiqueta, despacho físico, alteração de pedido/estoque/pagamento, notificação ou cotação adicional é disparada.
- Eventos mortos históricos permanecem intactos; não são reprocessados nem marcados artificialmente como entregues.

Baseline: os seis testes de registro/consumo falharam antes da correção. Gate final: **47/47 PASS**, incluindo módulos reais, OutboxDispatcher, repetição idempotente, tenant, payload inválido e indisponibilidade de auditoria sem ACK, além dos handlers anteriores de pagamento/entrega e entidade de cotação.

Evidências em `.audit/whatsapp-final-acceptance-20261028/`: `production-shipping-outbox-dead-46.json`, `local-shipping-audit-baseline.log`, `local-shipping-audit-final.log`.

Gate de publicação: compilar a API integrada, verificar inicialização/DI e observar somente novas emissões legítimas com audit + handler execution + outbox delivered. Cotação pode ser validada no fluxo real autorizado; criação de remessa deve aguardar um novo pedido real. Não fabricar pedido, replay de pagamento ou evento para satisfazer esse gate. `shipment.created` não comprova despacho e não deve acionar animação de pedido enviado.
