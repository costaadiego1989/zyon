# Aprovação humana ligada ao teste de comunicação

Data: 29/09/2026. Implementação local para o piloto de comunicação no checkout.

## Comportamento

O detalhe da estratégia passa a informar se a versão pode ser aprovada. Quando disponível, o lojista abre uma confirmação com versão, duração e divisão dos participantes. “Aprovar e iniciar teste” registra a decisão e inicia exatamente o experimento apresentado. Recusa e pedido de alternativa continuam disponíveis conforme o estado da proposta.

A API confirma, na mesma transação, decisão humana, experimento, variantes, plano de medição, execução, evento de ativação, atualização da hipótese de origem e notificação. Uma falha na última gravação desfaz tudo. Aprovar não chama a LLM nem envia mensagens a compradores.

## Autoridade e concorrência

- Loja e ator vêm da autenticação. A decisão exige versão atual, hash íntegro, validade e estado pendente. O backend copia o pedido antes de aguardar operações.
- A configuração atual da loja e o baseline precisam corresponder à versão revisada. O planejamento armazenado do ciclo e a política atual de medição devem coincidir. O ciclo semanal deve estar concluído.
- Somente um experimento pode ocupar a loja; uma execução pausada também impede outro início. A aprovação concorre com recusa e revisão com um único vencedor.
- Aprovação, recusa e publicação da revisão adotam a ordem de bloqueios de configuração antes da estratégia, compatível com a execução existente.
- O recibo imutável da decisão mantém o estado interno de autorização `activation_pending`, usado pelo registrador. O comprovante HTTP acrescenta a execução iniciada, seus identificadores e datas após o commit. Reenvios retornam esse mesmo comprovante histórico, inclusive depois de uma parada, sem reiniciar o teste. O estado atual é consultado separadamente.
- Novas sessões elegíveis entram no experimento existente; sessões históricas não são inscritas retroativamente. As métricas usam a execução e a versão exatas. A interface recarrega o painel de resultados após a mudança de estado.

## Configuração do piloto

`REVENUE_STRATEGY_APPROVAL_ENABLED` nasce como `false`. A leitura e a decisão conferem também a lista explícita de lojas de execução, elegibilidade comercial, planejamento, conversa principal, despacho, publicação, recuperação de conversa/pagamento, recuperação de resposta bloqueada e configuração do monitor. `*` não substitui os identificadores de lojas nas listas de execução e recuperação.

O monitor exige flag, tamanho válido de lote e configuração Redis habilitada. A aprovação verifica a configuração, não a saúde do worker. A disponibilidade real de Redis, do agendador e do provedor precisa ser validada no piloto antes da liberação.

Os limites positivos de IA, moeda, capacidade reservada para revisões, preço vigente do provedor/modelo e capacidade teórica para uma reserva são verificados. Isso não reserva dinheiro na aprovação nem garante saldo futuro. Cada despacho continua reservando e conciliando seu consumo sob os tetos compartilhados, preservando valores incertos. Nenhum preço, limite financeiro ou loja real foi configurado nesta entrega.

A proposta continua restrita à comunicação. Não autoriza cupom, desconto, frete subsidiado, alteração de margem ou promoção automática de vencedor. Contextos não atendidos pelo teste mantêm a saída para o checkout habitual, preservando atribuição e métricas.

## Validação local

Passaram 53 testes PostgreSQL de revisão (19 novos), cinco regressões do registro de execução/inscrição, três testes de controladores e 14 de modelo/transporte do dashboard: 75 testes. Passaram também TypeScript da API e do dashboard. Evidências: `.audit/revenue-weekly/approval-pg-config-final.log`, `approval-ledger-pg.log`, `approval-api-unit.log`, `approval-dashboard-unit.log`, `approval-api-types-final.log` e `approval-dashboard-types.log`.

A validação de banco usa PostgreSQL nativo descartável em UTC, com os clientes isolados existentes. A cadeia atual de migrations foi aplicada a um banco novo de revisão; esta entrega não adiciona migration. O cenário antigo que exige Redis real foi excluído explicitamente da execução final porque o serviço local está indisponível; a primeira execução foi interrompida quando esse cenário tentou conectá-lo. A configuração Redis nas fixtures novas não abre conexão. A suíte integral de execução de checkout não foi repetida nesta entrega.

O navegador usa a aplicação real com respostas HTTP controladas em 1440 e 390 px. Exercita aprovação da versão atual, confirmação, resposta perdida, reenvio idempotente, estado ativo após reload e regressões de alternativa, recusa, expiração, permissões, navegação e métricas. Isso não comprova comunicação com provedor real ou resultado comercial.

As duas jornadas passaram em `approval-browser-final.log`; imagens de confirmação foram conferidas em `approval-browser/`. O servidor de teste usou o carregador nativo de configuração do Vite para preservar a resolução das dependências compartilhadas, sem alterar ou reinstalar os pacotes.

## Pendências preservadas

O código conecta o ciclo de aprovação ao experimento de comunicação, mas não representa ativação em produção. Permanecem a validação operacional do piloto e provedores reais, a economia integral, os demais escritores comerciais e a transição completa ao pagamento, incentivos inteligentes, aprendizado validado entre lojas e os demais canais. Esta entrega não comprova aumento de conversão ou lucro.
