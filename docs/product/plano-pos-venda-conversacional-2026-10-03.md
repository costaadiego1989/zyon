# Plano de refatoração do pós-venda conversacional

Data: 03/10/2026. Estado: planejamento para revisão; sem implementação ou publicação desta refatoração.

## Objetivo e referência

Transformar a abertura, o atendimento e a resolução de trocas/devoluções em uma conversa contínua entre cliente, assistente e operador. O pedido, os relatos, as fotos, o andamento e o reembolso devem pertencer ao mesmo caso e aparecer para as duas partes.

Referência do relato: compra em produção de 02/10/2026, no valor informado de R$ 29, identificada pela imagem enviada pelo usuário. A referência visual começa por `pi_3UMCm` e termina em `NEJKW`; conferir a identificação completa nos registros antes de qualquer recuperação. O prefixo sugere um identificador Stripe, mas não confirma sozinho o provedor, o pagamento capturado nem o ambiente da transação.

Escopo: storefront, hub do cliente, atendimento no dashboard, módulos de suporte/devoluções, anexos, notificações e integração com o serviço de reembolso existente. Implementação por loja e cliente, sem regras específicas para a loja de teste, que poderá ser excluída futuramente. Preservar os temas e a identidade visual já aprovados.

## Evidência e limites da análise

Foram inspecionadas as bases usadas nos últimos releases: storefront `c6ea0063`, API `c2d624eb` e dashboard com metadado de produção `fd45f31b`. O dashboard indica publicação com alterações locais (`gitDirty=1`), portanto esse SHA não descreve sozinho todos os arquivos publicados.

Nesta análise foram conferidos o alias atual do storefront (`dpl_2s4p9PquasFsDotBLz7ojS6zu8Un`), o último deployment de produção da API (`bd6b75c2-153b-4bc1-8ba3-f4873da44da6`, SUCCESS) e o dashboard (`dpl_2ywJQpo4S79dZDppJ7wSQsC6Kv1V`, READY). Esses estados identificam as publicações e não comprovam o funcionamento do pós-venda.

A consulta aos registros do pedido não foi concluída: não existe proxy TCP externo para os serviços PostgreSQL em produção e a tentativa de SSH não concluiu. Não foram criados serviços, proxies, chamados, compras ou estornos. As conclusões abaixo são defeitos confirmados no código inspecionado; a associação com os registros exatos do incidente permanece pendente.

| Defeito confirmado no código | Evidência | Consequência |
| --- | --- | --- |
| Duas criações de chamado na mesma abertura | `RequestReturnUseCase.execute` chama `linkSupportTicket`; depois `BuyerReturnsController.createReturnRequest` chama novamente `CreateSupportTicketUseCase` | Uma abertura pode gerar dois chamados. O segundo não recebe o `returnId` nem a mensagem estruturada com fotos. |
| Identificadores descartados pelo cliente | `support.service.ts:72`, `submitReturnRequest(): Promise<void>` não lê a resposta; o formulário chama apenas `onSuccess()` | O cliente perde a ligação com a devolução e o chamado criados. |
| Estado reinicia ao voltar | `SupportPanel.tsx:202` e `:240` limpam `returnDone`, que é estado local | A interface oferece nova abertura em vez de recuperar a solicitação em andamento. |
| Hub de suporte depende da sessão do navegador | `ConversationsTab.tsx:67` lê `sessionStorage`; `/buyer/me/conversations` consulta `BuyerConversation`, sem unificar os tickets de suporte | O chamado não acompanha o cliente em outro navegador/dispositivo, nem forma uma caixa persistente de mensagens e notificações. |
| Conexão do comprador incompatível com autenticação do servidor | `support.handlers.ts:17` abre socket sem credencial; `SupportGateway.handleConnection` exige `ticketToken` para comprador | Conhecer o ID do chamado não permite entrar na conversa. |
| Respostas posteriores seguem o fluxo público de FAQ | `useSupportPanel.sendMessage` chama `sendSupportChat` mesmo após obter um ticket | O cliente não dispõe de um envio confiável para a conversa ativa com o operador. |
| Operador não confirma a gravação da mensagem | `useSupportSocket.sendMessage` emite sem tratar ACK; o drawer acrescenta mensagem temporária imediatamente | Uma falha pode parecer envio concluído. A rota HTTP grava sem publicar o mesmo evento do socket. |
| Encerramento usa sala diferente do gateway | `UpdateSupportTicketStatusUseCase` emite para `ticket:${ticketId}`; gateway usa `realtimeRoom(...)` | O evento de encerramento pode não chegar ao cliente. O frontend ainda apaga o histórico ao recebê-lo. |
| Dados de pedido e relato não são apresentados integralmente | Formulário envia `variantId: "all"`; o use case usa o ID como nome do produto; `ExchangeCard` não exibe o texto completo da mensagem | Faltam os itens reais, valores, quantidades e parte do relato para a análise do operador. |
| Aprovar não executa o estorno | `AcceptMarketplaceReturnUseCase` marca `REFUND_PROCESSING`, mas não chama o reembolso do comprador; a ação financeira fica em outra página | O estado sugere execução financeira antes de ela existir. Não há resolução completa dentro do atendimento. |
| Logística de devolução ainda simulada | `GenerateReturnLabelUseCase.ts:19` gera rastreio fictício e URL `labels.stub.zyon.dev` | Não se pode apresentar isso como etiqueta de postagem real. |

O backend já contém `RefundPaymentService` e `ProcessRefundUseCase`, com integração de provedores, tentativa persistida e reconciliação. Devem ser aproveitados e corrigidos onde necessário. Um ponto a corrigir é o fallback de reembolso parcial para o valor total quando os itens não conseguem ser precificados; a nova experiência exige itens reais e cálculo verificável.

## Experiência proposta para o cliente

1. No pedido, o cliente escolhe **Trocar ou devolver**. O assistente já conhece o pedido e apresenta seus produtos, data e valor, sem exigir que o cliente copie códigos.
2. A conversa coleta o necessário, uma pergunta por vez: trocar ou devolver; quais itens/quantidades; o que aconteceu; fotos, quando úteis. Texto livre e opções curtas podem ser combinados. A IA pode organizar o relato e sugerir uma classificação, mas não inventa informações nem decide o resultado.
3. O cliente pode anexar fotos na própria conversa. Vê miniaturas, progresso, remoção e erro de envio. O servidor valida tipo, tamanho e acesso; fotos do atendimento não são publicadas como imagens de catálogo. Upload incompleto precisa ser visível, sem descarte silencioso.
4. Antes de enviar à loja, o assistente mostra um resumo editável: pedido, itens, intenção, motivo, relato e anexos. A confirmação cria uma única solicitação e um único chamado, retornando suas referências.
5. A mesma conversa continua disponível para respostas, novas fotos e esclarecimentos. O cliente consegue identificar quando fala com a assistente, com o operador ou quando recebe uma atualização do sistema.
6. A aba **Conversas** do hub mostra o chamado, pedido vinculado, última mensagem, horário, etapa e mensagens não lidas. Respostas e mudanças de etapa geram aviso persistente com acesso direto à conversa.
7. Enquanto o caso estiver ativo, **Trocas e devoluções** mostra **Devolução em andamento — Acompanhar conversa**. Voltar, fechar o painel, recarregar, sair e entrar ou trocar de dispositivo reabre o mesmo caso.
8. A entrada volta a oferecer uma nova solicitação somente após resolução efetiva. O histórico anterior permanece acessível. Um pedido integralmente reembolsado não ganha elegibilidade para outro estorno; após resolução parcial, considerar apenas itens/valores ainda elegíveis. Pedidos diferentes continuam podendo receber ajuda.

Se o cliente interromper a coleta antes da confirmação, recuperar um rascunho, sem apresentar uma devolução como enviada à loja. O servidor é a autoridade para distinguir rascunho, caso ativo e resolução; `sessionStorage` serve no máximo como cache de interface.

## Experiência proposta para o operador

O atendimento terá conversa como área principal e um contexto de pedido sempre acessível. No desktop, o contexto pode ocupar uma coluna lateral; no celular, uma seção expansível junto à conversa.

O contexto mostra número/data do pedido, situação de pagamento e entrega, produtos e variações reais, quantidades, preços, total efetivamente pago, itens solicitados para troca/devolução, motivo, relato integral e fotos ampliáveis. Dados vêm do pedido e do caso; não de um resumo inventado pela IA. Uma atualização de catálogo não pode alterar os valores históricos da compra.

**Iniciar atendimento** registra quem assumiu o caso, atualiza a etapa e produz um aviso na conversa e no hub. Reconectar ao socket ou simplesmente abrir o drawer não deve criar novamente esse aviso.

O operador responde, solicita evidências, consulta o pedido e toma uma decisão na mesma área. Ações são oferecidas conforme etapa e permissão: autorizar devolução física, aprovar reembolso sem retorno quando aplicável, encaminhar troca, recusar com justificativa e concluir após a resolução.

Anotações internas e mensagens visíveis ao cliente precisam ser explicitamente distintas. A IA pode apoiar a análise; a autorização financeira permanece com operador autorizado.

## Resolução e estorno

Separar os estados do chamado, da devolução e do reembolso, mantendo uma apresentação única para o cliente. **Em atendimento** não equivale a **Reembolso solicitado**, e **Reembolso solicitado** não equivale a **Reembolso concluído**.

Fluxo financeiro proposto:

1. O operador escolhe **Aprovar reembolso** no atendimento.
2. O servidor prepara uma prévia com itens, quantidades, moeda, composição do valor, pagamento original, reembolsos anteriores e saldo reembolsável. No caso informado, R$ 29 é referência do relato; o valor permitido depende da captura confirmada.
3. O operador revisa e confirma a ação com o valor explícito. O servidor verifica novamente permissão, etapa, propriedade do pedido e saldo disponível.
4. Registrar uma tentativa única antes de acionar o serviço de reembolso existente, com proteção contra concorrência e chave de idempotência estável. Repetição de clique ou timeout não cria novo estorno.
5. Se o provedor ainda não confirmar o resultado, mostrar **Reembolso em processamento**. Um resultado desconhecido requer consulta/reconciliação, sem novo envio financeiro automático.
6. Só após confirmação efetiva do provedor mostrar **Reembolso concluído**, com valor, data e referência apropriada, na conversa, no pedido e no hub. Falha ou necessidade de tratamento manual permanece visível ao operador e ao cliente com uma próxima ação clara.

Devolução física e troca têm caminhos próprios. Retorno físico pode exigir instruções/etiqueta real, recebimento e inspeção antes da autorização de reembolso. Troca precisa acompanhar reposição e entrega, incluindo diferenças de valor quando existirem. Não marcar uma troca resolvida apenas por aprovar a intenção. Usar políticas configuradas e condições verificadas do pedido, removendo prazos genéricos inconsistentes do formulário/FAQ.

Preservar os mecanismos financeiros e de repasse já existentes para marketplace. O fluxo desta loja deve funcionar sem depender de repasse ou loja parceira, e sem introduzir atalhos específicos do estabelecimento de teste.

## Arquitetura proposta

- **Caso canônico:** pedido real + cliente autenticado + loja + devolução + conversa. Os dois frontends consultam as mesmas mensagens persistidas; a lista de conversas do hub é uma projeção dessa origem, evitando cópias independentes em JSON.
- **Abertura única:** concentrar a criação em um serviço transacional, incluindo devolução, vínculo de ticket e primeira mensagem. Restrição e controle de concorrência por pedido/caso, além de idempotência por solicitação. Uma repetição recupera o caso existente.
- **Validação:** confirmar que pedido, itens, quantidades e cliente pertencem ao escopo permitido. Sem pedido vinculado, tratar ajuda genérica separadamente; não fabricar pedido nem habilitar estorno automático.
- **Mensagens confiáveis:** mesmo serviço para gravação via HTTP e socket, IDs estáveis, confirmação de persistência e estados de envio/erro. Cliente e operador recuperam mensagens perdidas por cursor após reconectar; interface deduplica pelo ID.
- **Acesso:** rotas autenticadas do comprador para listar, abrir e responder aos próprios chamados; emissão/renovação de credencial de realtime com escopo de caso. Manter separação de lojas e clientes.
- **Notificações:** eventos persistidos para abertura, início de atendimento, mensagem, decisão e resultado financeiro; publicação recuperável e idempotente. Última leitura registrada por participante, contador de não lidas e acesso à conversa. O socket acelera a atualização, mas não é a única fonte.
- **Estados:** transições verificadas pelo servidor. Fechar visualmente o chat não resolve o caso; terminar suporte não pode esconder reembolso ainda pendente. Manter histórico após encerramento.
- **Anexos:** referências de arquivos ligados ao caso/mensagem, com acesso autorizado, validação e recuperação de erro. Não armazenar base64 em histórico de browser, notificações ou logs.
- **Migração:** alterações aditivas e compatíveis com registros atuais; preservar o histórico comercial e financeiro existente.

## Ordem de implementação

1. **Contrato e recuperação:** localizar os registros exatos do pedido informado; reproduzir em sandbox; fechar o modelo de caso, mensagens, anexos, leitura e estados. Preparar relatório de recuperação dos chamados antigos, sem remover dados nesta etapa.
2. **Base confiável da API:** corrigir a dupla criação; garantir vínculo de cliente/pedido/itens; persistência transacional; recuperação do caso ativo; acesso e envio bidirecional; notificações; ACK e sincronização após desconexão.
3. **Jornada conversacional do storefront:** substituir o formulário pela coleta guiada; confirmação resumida; fotos; reentrada no caso ativo; conversas e avisos persistentes no hub.
4. **Atendimento do operador:** conversa com contexto de pedido, relato e galeria; assumir atendimento com evento único; respostas confirmadas; ações de resolução no próprio chat.
5. **Resolução financeira e operacional:** prévia e confirmação de reembolso; integração ao serviço existente; reconciliação; troca com reposição/entrega; retorno físico com instruções reais; atualizações nas duas pontas.
6. **Validação e publicação:** fluxo completo em sandbox, capturas de cliente e operador no desktop/celular para revisão, publicação coordenada de API/storefront/dashboard e conferência em produção. Tratar os registros antigos com uma recuperação auditável, depois de identificar os vínculos com certeza.

Para chamados antigos duplicados, escolher o caso canônico pelo vínculo real com devolução/pedido, preservar relatos, anexos, autores e horários dos dois, e registrar a relação de duplicidade. Nunca eliminar histórico financeiro ou mensagens para apenas esconder o sintoma. Produzir primeiro uma simulação do que será recuperado.

## Critérios de aceite

- Confirmar uma abertura gera exatamente uma devolução, um chamado e uma mensagem inicial, inclusive com dois cliques/requisições concorrentes.
- Voltar, recarregar, relogar e usar outro dispositivo recuperam o mesmo caso ativo; a entrada só volta ao início após resolução.
- Operador vê pedido real, itens/quantidades, total histórico, intenção, relato completo e fotos; nenhum item fictício `all` chega ao cálculo de estorno.
- Iniciar atendimento produz um aviso persistente único. Resposta do operador chega à conversa e ao hub do cliente; cliente responde e o operador recebe.
- Fotos enviadas inicialmente ou durante o atendimento aparecem para ambas as partes. Falha de envio não perde silenciosamente o arquivo/relato.
- Aviso recebido com hub fechado aparece ao abrir; contador reduz após leitura confirmada. Reentrada e reconexão não duplicam avisos ou mensagens.
- Mensagens têm confirmação de gravação. Se o servidor rejeitar o envio, preservar rascunho e oferecer nova tentativa; não apresentar mensagem como enviada.
- Perda de conexão recupera o histórico ordenado, inclusive além da primeira página, sem lacunas ou duplicatas.
- Outro cliente/loja não consegue consultar pedido, chamado ou anexos. Operador sem permissão financeira não consegue autorizar estorno.
- Reembolso integral e parcial respeitam a captura e os estornos anteriores. Itens desconhecidos/quantidade excessiva não provocam devolução financeira total por fallback.
- Clique repetido, timeout e resposta perdida do provedor não emitem segundo estorno; estados pendente, falha, manual e concluído permanecem distintos.
- Aprovar sem retorno físico e aprovar após recebimento/inspeção seguem os caminhos corretos. Troca só encerra após a resolução operacional real.
- Histórico continua disponível após resolução; pedido totalmente reembolsado não permite novo reembolso, e resolução parcial respeita o saldo/itens restantes.
- Testar dois contextos de browser reais em sandbox, cliente e operador, desktop/mobile, light/dark, anexos, notificações, falhas e reconexão; validar provedor de pagamentos no ambiente apropriado. Testes existentes de devolução não provam esse fluxo entre as duas interfaces e alguns usam rotas antigas.

## Próximo passo

Revisar este plano antes da implementação. A compra informada continua sendo referência para inspeção e recuperação; este planejamento não executa seu estorno. As capturas propostas são da interface implementada em sandbox, para conferir a experiência antes da conclusão/publicação.
