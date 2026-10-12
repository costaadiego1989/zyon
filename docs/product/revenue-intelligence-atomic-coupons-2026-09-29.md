# Revenue Intelligence — aplicação atômica de cupons no checkout

Trigésima terceira entrega local. O widget reservava a utilização do cupom e gravava o evento antes de salvar o desconto; uma falha ou uma alteração concorrente deixava efeitos parciais. A ACP reservava o cupom, mas não persistia o benefício no checkout.

## Comportamento implementado

`ApplyCouponUseCase.executeForCheckout` recebe somente loja, sessão, código e a versão lida pelo servidor. Uma transação bloqueia a configuração da loja, a sessão e o cupom, nessa ordem. Recarrega carrinho, comprador, endereço, frete, regras e estado do cupom antes de chamar os motores determinísticos existentes. Nenhuma chamada à LLM ou a provedores ocorre nessa transação.

A reserva, o evento `coupon.applied` da outbox, o desconto/frete no checkout e o evento de funil `coupon_applied` passam a confirmar juntos. Falhas desfazem todos esses efeitos. Versões antigas ou ausentes são recusadas; a operação não reaplica automaticamente uma intenção sobre um carrinho diferente. Pedidos já concluídos e carrinhos vazios não recebem cupons por esse percurso.

O endpoint do widget ignora carrinho, identidade e região enviados pelo navegador. Restrições regionais exigem o estado persistido do endereço; limite por comprador exige identidade persistida. Configuração comercial ausente, custo desconhecido, margem insuficiente e benefício já aplicado bloqueiam a concessão. Limites global e por comprador continuam considerando reservas ativas. A garantia de identidade é a do checkout existente; esta entrega não cria uma autenticação adicional do comprador.

A ACP usa o mesmo percurso e seleciona o frete antes de aplicar o cupom quando ambos chegam no mesmo pedido. A apresentação do benefício foi extraída para uma função compartilhada, preservando o formato da resposta do widget. Não há segunda gravação independente no controller.

`UpdateCartUseCase` salva a nova quantidade, cancela reservas invalidadas e grava `checkout.cart.updated` em uma transação. Foi removida a compensação que podia reativar uma reserva cancelada por outra operação. Em conflito de versão, a reserva recém-aplicada e o carrinho atual permanecem intactos.

## Validação local

- 23 testes PostgreSQL passaram: 18 novos cenários de cupons e cinco regressões de versão/ACP. Cobrem os serviços e repositórios reais, concorrência, isolamento de loja, limite global/por comprador, margem, custo ausente, região, identidade, frete, falhas de outbox/funil, cancelamento e reaplicação após alteração de quantidade.
- 165 testes de aplicação, cupons, checkout, embed e ACP passaram. Uma fixture antiga de total líquido herdava frete de R$ 35 apesar de esperar frete zero; agora declara `shipping: undefined` explicitamente. O teste de cancelamento com um mock parcial foi substituído pela verificação PostgreSQL com rollback real.
- TypeScript passou com o cliente Prisma isolado. `git diff --check` passou. Não houve alteração de schema nem regeneração do cliente compartilhado.
- O Docker estava parado e não iniciou por indisponibilidade de virtualização. Foi criado um cluster PostgreSQL 17 nativo descartável em `.audit/revenue-weekly/native-pgdata-0929`, restrito a `127.0.0.1:5557`, com timezone UTC. O comando real de predeploy aplicou as 53 migrations existentes no banco vazio `revenue_release_0928`.
- As primeiras tentativas falharam por indisponibilidade do banco e preparação das fixtures (ID do cupom, limpeza de tabelas sem FK e timezone do cluster). O resultado final acima vem da repetição após esses ajustes. A suíte integral de execução de estratégias não foi repetida nesta entrega.

Logs locais: `atomic-coupons-pg-final.log`, `atomic-coupons-unit-recheck.log`, `atomic-coupons-types-final.log` e `atomic-coupons-migrations.log`, em `.audit/revenue-weekly/`.

## Limites e próxima etapa

Esta entrega cobre aplicação de cupom no checkout por widget/ACP e invalidação por quantidade em `UpdateCartUseCase`. O carrinho conversacional do storefront usa outra persistência e ainda precisa de sua própria operação atômica. Também faltam unificar outros escritores comerciais, como inclusão de SKU pela ACP, cancelamento da sessão, troca posterior de frete/endereço e cross-sell. Um PATCH ACP com várias operações ainda pode confirmar as primeiras e falhar em uma operação posterior. Não há reparação automática de reservas históricas inconsistentes.

O desconto continua autorizado pelas regras da loja no momento da aplicação. Não foi implementada aqui a revalidação integral de todos os benefícios durante cada transição de pagamento, nem a contabilidade completa de subsídios e demais custos. Cupons inteligentes sugeridos pela IA, aprovação/ativação pública de estratégias, economia integral, aprendizado entre lojas e piloto continuam pendentes. Nenhuma flag foi ativada, nenhum provedor real foi chamado e não houve push, merge ou implantação.
