# Cart Recovery e pós-venda: integração de mensagens

Data: 13/09/2026. Projeto: AACP/Zyon. Escopo: código local, contratos da API, persistência e telas do merchant. Nenhuma campanha real, aprovação real da Meta ou publicação em produção foi executada nesta auditoria.

## Resultado

Havia falhas que impediam o funcionamento conjunto. O lifecycle de recuperação verificava credenciais Twilio, mas a submissão utilizava Meta Cloud. O pós-venda tinha um caminho de envio separado, podia marcar mensagens como enviadas sem aceite do provedor e não preservava versões aprovadas. Eventos de entrega sem dados de contato geravam agendamentos sem um comprador resolvível.

As correções abaixo alinham templates e roteamento. A liberação de campanhas em produção ainda depende das pendências documentadas ao final, sobretudo autorização do comprador, retomada válida do carrinho e validação real de entrega.

## Comportamento implementado

| Etapa | Comportamento |
| --- | --- |
| Conexão Meta | O pacote nativo persiste templates por merchant e cenário. O monitor submete e consulta a análise automaticamente. A conexão precisa estar ativa e pertencer ao merchant. |
| Pacote nativo | 11 cenários: follow-up, avaliação, NPS, cross-sell, win-back, fidelidade, recompra, recuperação, confirmação, envio e entrega de pedido. Cada cenário tem conteúdo de e-mail e WhatsApp. Inicialização repetida preserva edições. |
| Envio WhatsApp | Exige template ativo e aprovado, nome válido, aprovação recente e a mesma WABA. Antes do POST, consulta a Meta para conferir nome, idioma e conteúdo, e verifica novamente conexão e revisão local. |
| Sem aprovação ou conexão | Tenta e-mail quando o fluxo permite e existe contato, conteúdo ativo e serviço de envio disponível. Não usa WhatsApp livre para iniciar essas campanhas. |
| Edição | O texto com variáveis nomeadas é a fonte de conteúdo. A API gera as posições enviadas à Meta; o cliente não define status de aprovação. Uma alteração no WhatsApp cria revisão nova para análise. |
| Rollback | O merchant pode restaurar uma versão anterior. A API exige revisão atual, verifica novamente a aprovação na Meta e impede restauração entre contas. A restauração também incrementa a revisão local. |
| Rejeição, pausa ou edição externa | Não libera envio por WhatsApp. A versão anterior só pode ser reativada após a verificação de rollback. |
| Falha ambígua | Timeout, aceite sem identificador e falha de persistência após despacho ficam retidos para conciliação. Não provocam envio automático por outro canal. |
| Registro de envio | O pós-venda grava o canal realmente utilizado e o identificador retornado pelo provedor. Log de desenvolvimento ou resposta sem aceite não contam como envio. |

O termo `sent` ainda representa aceite pelo provedor; não comprova entrega ao destinatário ou leitura.

As versões são alternativas dentro dos cenários existentes. Esta mudança não cria um construtor de campanhas arbitrárias, com novos gatilhos definidos pelo merchant.

## Correções adicionais

- A consulta de compradores inativos agora filtra o merchant. A recompra distingue SKUs por loja e preserva lembretes de produtos diferentes no mesmo pedido.
- Agendamentos usam identidade determinística; eventos repetidos e concorrência não criam outra mensagem para a mesma ocorrência. Win-back e fidelidade usam identificadores estáveis da ocorrência.
- O evento de entrega consulta o pedido da loja e resolve o comprador. Normaliza o identificador do pedido para evitar diferenças entre operação manual e fulfillment.
- Mensagens sem contato resolvem a conta do comprador, incluindo identificadores legados de identidade e sessão com filtro da loja.
- Antes do despacho, o pós-venda revalida a configuração da campanha e a situação do pedido. Pedidos sem elegibilidade atual são cancelados na fila.
- O contexto de resposta WhatsApp é criado apenas quando esse foi o canal utilizado. E-mail não coloca a conversa WhatsApp em espera de NPS ou avaliação.
- Mensagens presas em processamento ficam em estado `unknown` após expirar a execução; não voltam automaticamente à fila de envio.
- Fidelidade e recompra passam a categoria Marketing, junto com recuperação, cross-sell e win-back. Variáveis promocionais também exigem Marketing. A classificação final continua com a Meta.
- Os textos nativos de recompra não prometem frete gratuito incondicional. A sugestão por IA usa o catálogo do cenário e passa por validação de variáveis.
- Avisos de alteração de aprovação do pós-venda passam a usar o mesmo trabalhador de notificações do merchant.
- As telas preservam o rascunho em falhas e conflitos; oferecem comparação e restauração de versões aprovadas e mensagens de erro compreensíveis.

## Migração e implantação

Migração: `apps/api/prisma/migrations/20260913170000_sales_template_versions/migration.sql`.

Adiciona WABA e histórico de aprovação aos templates; instante de processamento, identificador do provedor e motivo de falha aos agendamentos. As aprovações das campanhas passam por uma nova consulta. Identificadores Twilio reconhecidos são retirados do caminho Meta e voltam à análise como uma nova revisão. Conteúdo editado é preservado. O cenário independente `order_quota` não é incluído nessa conversão.

Aplicar a migração e gerar o Prisma Client antes de iniciar a versão nova da API. A migração foi executada somente no PostgreSQL descartável local. Não foi aplicada ao banco do projeto ou de produção.

## Evidências executadas

- 318 testes unitários e de integração entre componentes dos módulos cart-recovery, post-sale e whatsapp-templates, sem falhas.
- 16 testes em PostgreSQL descartável, incluindo edições concorrentes, claims, histórico e rollback, unicidade de agendamento, produtos distintos e retenção de processamento expirado.
- SQL da migração executado sobre tabelas com registros anteriores: preserva conteúdo e identificadores Meta, invalida cache de aprovação e retém processamento de resultado desconhecido.
- Verificação TypeScript da API e dashboard com o schema atualizado.
- Chromium com os componentes e cliente HTTP reais, API simulada, desktop 1440 px e celular 390 px: falha de salvamento preserva rascunho; edição impede troca de cenário e rollback; alteração de e-mail mantém revisão compartilhada; rollback rejeitado preserva o template; rollback aprovado atualiza ambas as telas. Sem erros de página ou overflow horizontal.

As verificações locais não comprovam credenciais de produção, aceite de um template real, entrega de e-mail/WhatsApp, resposta a pesquisas ou conversão de uma compra recuperada.

![Pós-venda no celular](assets/2026-09-13-sales/post-sale-mobile.png)

![Recuperação em desktop](assets/2026-09-13-sales/recovery-desktop.png)

## Pendências para liberar campanhas em produção

1. **Autorização e revogação de contato.** Falta fechar captura, prova, consulta antes do envio e cancelamento por comprador/loja/finalidade, incluindo descadastro e bloqueio de campanhas já agendadas. A aprovação do template não substitui a permissão do destinatário. A [política oficial do WhatsApp](https://whatsappbusiness.com/policy/) exige permissão para contato e respeito à saída.
2. **Retomada de carrinho e elegibilidade.** O scanner de recuperação ainda usa os sinais legados de abandono e precisa revalidar pagamento, atividade recente e compra concluída imediatamente antes do disparo. Não fornece ao fluxo o vínculo completo de retomada autorizado; o fallback de URL genérica não comprova restauração do carrinho. A recompra também precisa de um destino absoluto e funcional para o produto da loja.
3. **Conciliação e entrega real.** Correlacionar callbacks dos provedores aos identificadores persistidos, distinguir entregue/lido/falhou e oferecer tratamento operacional de estados `unknown`. Execute uma jornada controlada com destinatário autorizado antes de liberar volume.
4. **Incentivos e frequência.** A criação de cupons de win-back ainda utiliza percentuais internos e metadados de frete; é necessário alinhar esses benefícios às regras comerciais autorizadas, evitar cupons/benefícios duplicados em concorrência e estabelecer limite de frequência entre campanhas. A unicidade de mensagem corrigida não torna a concessão de benefícios transacional.
5. **NPS e avaliações.** O fluxo atual de WhatsApp usa 1–5 e converte para 0–10, sem representar NPS de forma fiel. Há rotas públicas de resposta que recebem identificação no corpo; a jornada precisa de vínculo autenticado ou token de resposta. E-mails que pedem resposta precisam de destino de coleta efetivo. Não foi alterada silenciosamente a escala de pesquisas já em andamento.
6. **Eventos de integrações.** O webhook de marketplace ainda registra um TODO para emitir `order.delivered`. O fluxo de fulfillment e o de operações foram analisados; cada integração externa precisa comprovar o evento de entrega e a correlação do pedido.

Os scripts legados `qa-postsale-e2e.ts` e `qa-test-postsale-send.ts` ainda refletem a composição antiga e incluem envio real. Não foram usados como evidência. A validação desta auditoria utilizou doubles e banco descartável, sem contato com compradores.
