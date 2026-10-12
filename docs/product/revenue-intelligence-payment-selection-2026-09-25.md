# Revenue Intelligence — continuidade do pagamento no checkout

Décima sétima entrega local, no worktree `AACP-revenue-intelligence`, branch `feat/revenue-intelligence-weekly`. Remove um bloqueio entre a comunicação experimental e a escolha de pagamento. Sem implantação, ativação de flags, chamadas pagas de IA, pagamentos ou mensagens externas.

## Comportamento implementado

A sessão atribuída a uma estratégia agora consegue continuar para a escolha de PIX, cartão, boleto ou cripto pelo percurso normal de pagamento. A escolha e o par de mensagens são gravados juntos, em uma transação, antes de preparar a intenção de pagamento. Uma nova leitura pelo repositório preserva a escolha. O servidor confere a etapa salva antes de aceitar a seleção; o chamador não pode declarar arbitrariamente que a sessão está pronta para pagar.

Selecionar um método e acompanhar um pagamento pendente não chama a LLM, o adaptador experimental ou ferramentas do chat. Esses turnos recebem respostas determinísticas. A pausa de uma estratégia de comunicação não impede esse percurso de pagamento. Controle e tratamento preservam sua atribuição depois da mensagem experimental.

Tanto a resposta do chat quanto sua experiência retornam `payment_pending`. Escolher um método, dizer “já paguei” ou acrescentar um campo não tipado `paymentConfirmed` ao snapshot não confirma a compra. A confirmação continua dependendo do percurso financeiro autoritativo; esta entrega não acrescenta sua projeção ao chat.

No protocolo durável, a preparação usa a chave `chat:<requestId>`. Repetir a mesma mensagem retorna seu recibo/conflito, sem preparar outro pagamento. Enquanto uma requisição está em processamento ou incerta, mensagens com outras chaves também não entram no fluxo. Depois de concluir a requisição, a sessão pendente não seleciona um segundo método por texto.

Se a preparação de pagamento falha, a requisição protegida fica incerta e não é concluída apenas porque seu texto foi salvo. A recuperação de texto experimental não pode liberar esse caso. A conciliação financeira e a recuperação dos dados de pagamento são trabalho pendente; o comprador não recebe tarefa técnica de verificar conversa.

## Persistência e compatibilidade

- Migration aditiva `20260925010000_checkout_payment_selection`: coluna nullable `checkout_sessions.payment_method`, com restrição aos quatro métodos. Sem inferir ou preencher escolhas em sessões antigas.
- Mapeamento Prisma e repositório em memória preservam o método. Um reset explícito do snapshot, como na atualização do carrinho, grava `NULL`.
- A seleção usa o bloqueio de linha da gravação da conversa. Falha da transação desfaz mensagens e escolha. As provas e proteções existentes do protocolo durável continuam aplicadas.
- O baseline revisado inclui `paymentRouting: checkout-payment-routing-v1`. Propostas anteriores não herdam silenciosamente o novo comportamento; seu baseline antigo é recusado. Não há reescrita de propostas históricas.
- A escolha deixa de usar uma segunda gravação integral da sessão após publicar as mensagens. Isso não elimina as outras gravações integrais existentes nem conclui a proteção contra todo snapshot desatualizado de outros canais.

A coluna e o cliente Prisma atualizado são necessários antes de executar este código, inclusive nos caminhos legados que usam o repositório. A migration foi aplicada somente ao banco descartável `revenue_recovery_final_0924`, na porta local 5557. O cliente foi gerado em `apps/api/.audit/revenue-weekly/client`; dependências compartilhadas não foram regeneradas. O diff Prisma entre esse banco e o schema isolado ficou vazio. Flags de estratégia permanecem desabilitadas por padrão.

## Validação local

| Verificação | Resultado |
| --- | --- |
| Revenue Manager e experimentos, sem as suites PostgreSQL | 349/349 |
| Execução, publicação, recuperação e seleção de pagamento em PostgreSQL | 114/114: suite completa de 112 mais dois novos cenários de concorrência/etapa |
| Identidade, requisições duráveis em PostgreSQL e controller embed | 45/45 |
| Seleção, baseline, repositório, correção de cadastro e confirmação de endereço | 26/26 |
| Caso de uso de preparação de pagamento, com provedores controlados | 17/17 |
| Extração de cadastro/etapas | 11/12; a mesma falha ocorre no commit anterior `5451a58` |
| TypeScript da API com cliente isolado; diff do schema; `git diff --check` | Aprovados |

São 562 testes distintos aprovados e uma falha preexistente. O teste antigo `missingFieldsForStage lists user-facing labels for each stage in order` espera e-mail antes de telefone; o código anterior e o atual retornam telefone primeiro. A comparação carregou os arquivos de produção alterados diretamente de `5451a58`, sem modificar o worktree. Essa falha não foi ocultada nem contabilizada como aprovação.

Os novos cenários incluem os quatro métodos, pausa antes do pagamento, continuidade após os dois braços de comunicação, seis mensagens concorrentes com chaves diferentes, método persistido antes da chamada, timeout com recibo incerto, rollback, isolamento entre lojas, reset e rejeição da etapa inválida. Nenhuma seleção produz pedido concluído. O teste preexistente de preservação do histórico foi atualizado para preparar cadastro/frete válidos antes de declarar a etapa de pagamento.

Os cenários de chat usam o caso de uso e o builder reais, banco PostgreSQL real e uma implementação controlada da preparação de pagamento; cadastro/frete estão previamente preparados. Os 17 testes financeiros exercitam separadamente o caso de uso real com repositórios/provedores de teste. Isso não demonstra aquisição financeira real, compra completa em navegador, webhook ou conciliação. Não houve alteração de interface nesta entrega.

Logs locais: `.audit/revenue-weekly/payment-{revenue-regression,strategy-full,concurrency,chat-regression,focused,use-case,extraction-head,typecheck,migration,schema-diff}.log`. Artefatos de auditoria e dependências não entram no commit.

## Trabalho restante para o primeiro ciclo

RI-09 continua parcial. Para fechar a comunicação experimental, ainda é necessário concluir a paridade do controle e das ferramentas, tratar os resultados financeiros e sua recuperação, comprovar entrega/exposição, ligar os resultados econômicos e as regras de parada, e conectar a aprovação pública à ativação durável. A API de aprovação continua bloqueada enquanto esses requisitos não estiverem demonstrados.

A proteção aqui comprovada cobre a admissão de mensagens no chat durável. Não é prova de deduplicação entre todos os canais de pagamento, nem de comparação de versão em todas as gravações de sessão. Métodos indisponíveis ou falhas financeiras no percurso protegido permanecem bloqueados até tratamento específico; não há troca de método por mensagem durante o estado pendente.

Não há evidência de revenue lift, piloto concluído, cupons/descontos experimentais ativos ou aprendizado compartilhado entre lojas. Esses itens mantêm a sequência e os critérios do plano técnico.
