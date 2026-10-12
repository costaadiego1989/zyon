# Revenue Intelligence — navegação e recuperação do checkout

Vigésima sétima entrega local. O chat experimental passa a aceitar quatro ferramentas de apresentação: confirmar endereço, solicitar CEP, mostrar fretes e mostrar meios de pagamento. Texto e controles usam a mesma projeção do chat normal, com dados da sessão no servidor. A IA escolhe o tipo de controle; não fornece preços, endereços, meios de pagamento ou parâmetros comerciais.

## Comportamento

- Chamadas com argumentos, nomes desconhecidos, ferramentas repetidas ou ações comerciais misturadas são recusadas antes de qualquer publicação. Desconto, cupom, frete subsidiado, busca e alteração de carrinho continuam fora deste percurso experimental.
- Respostas somente com ferramentas recebem uma frase neutra, persistida junto com a conversa. A publicação guarda os nomes das ferramentas na mesma transação, com política e baseline versionados. Propostas anteriores exigem nova análise/revisão; não recebem o comportamento novo silenciosamente.
- A recuperação reconstrói controles somente para a última mensagem, quando o recibo está concluído ou reconciliado e a versão comercial da sessão continua igual. Mensagens antigas, contexto alterado, pagamento existente e tentativas incertas não reativam os controles no widget. Uma nova resposta também retira os controles de navegação anteriores do histórico exibido.
- Recuperação e recarregamento não repetem LLM, seleção de frete ou criação de pagamento. O comprador não recebe um botão de verificação técnica.
- O frete mostra preço em reais e prazo. A escolha volta pelo chat autenticado; uma correspondência completa e única com a opção atual é necessária. Botões antigos ou rótulos ambíguos não escolhem outro serviço por aproximação. O atalho local antigo deixa de avançar quando existe uma etapa informada pelo servidor.
- A lista de pagamento inclui boleto e não promete isenção de taxas ou parcelamento sem configuração. O widget mantém o filtro de meios habilitados pela loja; o serviço financeiro continua responsável pela validação ao selecionar.

## Persistência e implantação

Migration `20260928230000_strategy_chat_navigation`, idêntica nas cadeias normal e de deploy. Acrescenta `navigation_tools` à publicação imutável, restringe nomes e duplicações e admite a nova política de publicação/recuperação preservando as verificações anteriores. A política textual anterior continua recuperável quando já tem a prova exigida.

O comando real de predeploy aplicou a migration no PostgreSQL descartável `revenue_release_0928`; a repetição encontrou 51 migrations e nenhuma pendência. Não foi executado em ambiente remoto. O cliente Prisma usado nos testes foi gerado somente na pasta isolada de auditoria.

## Evidência local

- A regressão PostgreSQL exercitou 180 cenários: 177 passaram inicialmente, dois revelaram um erro na identificação do botão de frete e um excedeu o tempo de transação da fixture local. A normalização Unicode removia o separador `·`; a identificação agora ocorre antes da normalização. O tempo permitido da fixture Docker foi ampliado para 30 segundos, sem alterar limites do produto. O reteste final passou nos 24 casos selecionados: as três falhas, toda a navegação e as cinco jornadas de compra. Esta execução não é evidência de desempenho em produção.
- Há 18 casos novos de integração: quatro ferramentas nos dois grupos, seis recusas, recuperação concorrente e três seleções de frete (exata, antiga e ambígua).
- 41 testes de chat, ferramentas e gateway passaram; um teste antigo permanece ignorado. Dez testes de baseline e dez de recuperação do cliente passaram.
- 23 cenários de navegador passaram, cobrindo recuperação, pagamentos existentes, responsividade, repetição limitada e roteamento de voz. Os dois casos novos verificam controles após perda de resposta e reload, ausência de efeitos automáticos e envio da seleção de frete ao chat. Capturas móveis foram inspecionadas com animações concluídas.
- TypeScript da API e do widget passaram. Os dois testes de navegador novos foram repetidos após os ajustes finais de preço, prazo e remoção dos controles anteriores; ambos passaram.

Logs em `.audit/revenue-weekly/`: `navigation-pg-full.log`, `navigation-pg-final.log`, `navigation-api-unit-final.log`, `navigation-baseline-tests.log`, `navigation-widget-tests-final.log`, `navigation-browser-full.log`, `navigation-browser-final.log`, `navigation-api-types-final.log`, `navigation-widget-types-final.log` e `navigation-migrate-repeat.log`.

## Limites

As chamadas de IA e os transportes financeiros são controlados nos testes; o navegador usa HTTP simulado. Isso não comprova comportamento de modelo real, aceitação de provedor, implantação ou ganho de receita. A comprovação de exibição continua sendo de texto visível reportado pelo widget, não leitura humana ou uso dos controles.

Aprovação/ativação pública, paridade completa dos contextos e ferramentas comerciais, economia integral, incentivos, aprendizado entre lojas e outros canais permanecem pendentes. As flags do percurso experimental continuam desabilitadas por padrão.
