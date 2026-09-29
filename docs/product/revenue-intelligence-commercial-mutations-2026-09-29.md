# Revenue Intelligence — invalidação transacional de benefícios

Trigésima quarta entrega local. A inclusão de SKU pela ACP, mudanças de endereço/comprador, seleção posterior de frete e cancelamento ainda podiam conservar um desconto calculado para outra compra ou deixar sua reserva ativa. O cancelamento também gravava o evento de encerramento separadamente da sessão.

## Comportamento

Foi criada a operação `commitCommercialMutation` no repositório de sessão. Ela verifica loja, sessão, versão e snapshot anterior, rejeita pedidos concluídos ou cancelamentos explícitos já registrados e salva os efeitos em uma transação PostgreSQL. Repositórios sem essa capacidade são recusados pelo chamador, sem um fallback de gravações separadas.

A política compartilhada compara itens, total, moeda, identificação do comprador, endereço e frete. Uma mudança relevante remove o desconto e sua apresentação e cancela reservas de cupom ainda aplicadas. Mudanças no carrinho, comprador ou endereço também descartam o frete e suas opções. Uma seleção de frete usa exclusivamente uma opção do snapshot anterior, cuja versão é verificada ao salvar. A operação não concede benefícios: tentativas de introduzir desconto sem autorização própria ou inventar um preço de frete são recusadas.

Alterações de exibição, como corrigir apenas o nome, e entradas equivalentes de endereço/quantidade preservam o benefício. No cancelamento ACP, a limpeza da sessão, liberação da reserva, evento de carrinho e evento de encerramento confirmam juntos. O retorno usa a versão resultante de todos os efeitos, inclusive a telemetria.

`UpdateCartUseCase` passou a usar essa mesma operação, removendo sua implementação transacional particular. Os componentes ACP de itens, comprador/endereço, frete e cancelamento também a utilizam. Cada operação é atômica; um PATCH ACP que combina várias operações ainda não constitui uma única transação.

Na inclusão de produtos pela ACP, quantidades fracionárias, negativas, acima de 99 e não finitas são recusadas em ambos os percursos. SKUs ambíguos e moeda incompatível são recusados. A consulta de catálogo considera apenas produtos/variantes ativos e da própria loja; traz preço, moeda e custo cadastrado. Custo ausente ou negativo permanece indisponível para a autorização de descontos. Não há reserva de estoque ou garantia de preço de catálogo durante toda a jornada nesta entrega.

## Evidência local

- 35 testes PostgreSQL passaram na bateria final: 15 novos cenários, os 18 cenários de cupom da entrega anterior e duas regressões ACP. Foram exercitados repositórios e serviços reais, concorrência, rejeição de snapshots antigos, isolamento entre lojas, reserva, cancelamento, falha de eventos, preservação de alterações sem efeito comercial e consulta de catálogo.
- 177 testes de aplicação/checkout/embed/ACP/cupons passaram, incluindo 12 novos casos de entrada inválida, SKU ambíguo e moeda incompatível.
- TypeScript e `git diff --check` passaram. Nenhuma migration nova ou regeneração do cliente compartilhado foi necessária.
- PostgreSQL 17 nativo descartável em `127.0.0.1:5557`, banco `revenue_release_0928`, timezone UTC, com as 53 migrations existentes. O cluster foi iniciado apenas para os testes. Nenhuma conexão com produção ou chamada a provedor foi usada.

A primeira bateria passou em 34 casos. Na repetição com o novo cenário de concessão indevida, uma fixture colidiu com um produto deixado pela execução anterior: produtos não são apagados pela limpeza de comerciantes. A preparação do banco descartável agora limpa explicitamente essa tabela; os 35 casos foram repetidos após o ajuste. Os doubles de unidade em memória não comprovam atomicidade; essa evidência vem dos testes PostgreSQL. A suíte integral de execução de estratégias e o navegador não foram repetidos nesta entrega, que não alterou a interface.

Logs em `.audit/revenue-weekly/`: `commercial-mutations-pg-recheck.log`, `commercial-mutations-unit-final.log` e `commercial-mutations-types-final.log`.

## Pendências

Falta transformar o PATCH ACP completo em uma transação e integrar os demais escritores, incluindo cadastro/frete pelo chat, cross-sell e o carrinho conversacional do storefront. Pedidos marketplace e seus registros próprios exigem um fluxo específico. A nova operação não impõe uma proteção universal a código legado que ainda chama `saveSession` diretamente, nem substitui a revalidação comercial durante o pagamento.

Aprovação/ativação pública de estratégias, economia integral, incentivos sugeridos pela IA, aprendizado entre lojas e piloto permanecem pendentes. Flags não foram ativadas. Não houve push, merge, implantação ou efeito comercial real.
