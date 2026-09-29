# Revenue Intelligence — exibição de mensagens no widget

Décima nona entrega local no branch `feat/revenue-intelligence-weekly`. Registra separadamente publicação no banco e exibição informada pelo widget. Não há implantação, ativação de estratégias, chamadas pagas de IA ou operações em provedores reais.

## Comportamento

Respostas experimentais já publicadas recebem uma referência emitida pelo servidor, vinculada ao turno e ao hash do texto exato. A leitura autenticada do histórico recupera a mesma referência depois de perda da resposta ou recarregamento. Metadados enviados por um executor não substituem essa prova.

O widget observa o elemento de texto: pelo menos 1% da área precisa permanecer no viewport por 500 ms, com documento visível e navegador online. Confere SHA-256 antes de enviar. Há deduplicação em memória, no máximo três tentativas por mensagem montada e cancelamento ao desmontar. Falhas de telemetria não bloqueiam chat nem pagamento. Nenhuma ação técnica é apresentada ao comprador.

`POST /embed/chat/display` exige origem, escopo `checkout:chat` e token vinculado à loja/sessão. O servidor valida conversa, publicação, texto e recibo concluído ou reconciliado. Não aceita do cliente loja, variante, horário ou resultado comercial. O banco grava uma única evidência imutável por turno, usando seu próprio relógio. Reenvios retornam o primeiro horário. A exibição tardia de mensagem já salva continua registrável após pausa ou rollback da estratégia.

Este dado é uma declaração autenticada do cliente sobre visibilidade do texto. Não comprova atenção humana, leitura, compra ou efeito incremental. Mensagens apenas persistidas não são contadas como exibidas; mensagens históricas sem prova não recebem backfill. Outros canais ainda não implementam este contrato.

## Persistência e validação

Migration aditiva `20260925030000_strategy_message_display`, aplicada apenas ao PostgreSQL descartável local na porta 5557. Cria tabela, relação com a publicação, validação da prova e proteção contra atualização/exclusão. O schema e cliente novos são necessários antes deste código, inclusive para leituras do histórico. O cliente Prisma foi gerado isoladamente; dependências compartilhadas foram preservadas. Diff schema/banco vazio após alinhar o nome do índice. Isso não é ensaio completo de `migrate deploy`.

- 176 cenários PostgreSQL de execução, requisições de chat e recuperação financeira aprovados em uma execução integral, incluindo os 117 cenários de estratégia. Não houve testes ignorados nessa execução.
- 32 testes de controller, escopos e middleware de loja aprovados.
- 6 testes de cliente aprovados, incluindo hash incorreto, falha temporária e deduplicação concorrente.
- 21 cenários completos de navegador aprovados: resposta normal, recuperação, reload, documento oculto, fora do viewport, falhas e tentativas limitadas, além das regressões de pagamento e voz. Widget real com HTTP local controlado; não uma compra ponta a ponta conectada à API real.
- API e widget passaram na verificação TypeScript. Logs ficam em `.audit/revenue-weekly/display-*.log` e não entram no commit.

A revisão final passou a descartar referências de exibição fornecidas pelo executor antes de acrescentar a prova autoritativa. Os casos de resposta com publicação e resposta sem publicação foram reexecutados após essa revisão. A suite integral antecede somente essa mudança pequena de projeção e o alinhamento do índice.

## Continuação

A medição ainda precisa consumir a participação imutável e distinguir os indicadores acima. Paridade completa do checkout, outros chamadores, proteção econômica, regras de parada, aprovação/ativação pública, incentivos e aprendizagem compartilhada continuam sujeitos aos critérios do plano. Não há revenue lift comercial comprovado.
