# Checkout nativo: vínculo autorizado do carrinho

Data: 2026-09-07. Escopo: API, storefront e widget_v2.

## Regressão confirmada

A proteção de referências de carrinho introduzida em `84f322c` e `c52f68b`
passou a recusar o `cart_ref` que o storefront ainda enviava. O widget iniciava
com `cart.items=[]`, enquanto a validação de preços ocorria antes da antiga
hidratação do carrinho. Além disso, o widget lia e alterava o carrinho público,
separado da sessão usada para calcular frete e pagamento.

## Correção

- O storefront envia a capacidade assinada da conversa ao proxy de token.
  A API verifica assinatura, expiração, origem, merchant e referência de carrinho.
- A referência nativa usa a claim `storefrontCartRef`, distinta de `cartRef`
  de provedores commerce. A loja nativa autenticada pela conversa não exige
  cadastro de instalação de widget externo. A emissão externa mantém essa exigência.
- A API carrega o carrinho persistido por merchant/conversa, valida expiração,
  variantes locais ativas, opções e estoque agregado. Preços incluem a cotação
  feita pelo servidor, modificadores e promoções, aplicadas uma vez. Os valores
  enviados ao widget continuam em reais. Nenhum preço do navegador é utilizado.
- O widget exibe `experience.items`/`experience.totals` e modifica `/embed/cart`.
  A identidade de variante/opções evita juntar itens com o mesmo SKU.
- Alterações invalidam frete e desconto de carrinho; a interface remove o
  pagamento anterior e usa nova chave de idempotência na próxima tentativa.
  Falhas de atualização preservam o carrinho exibido e mostram erro.
- Leitura, alteração e limpeza do carrinho público exigem a capacidade da
  conversa. Ferramentas da conversa usam a referência do contexto autenticado.
- Mensagens de compradores logados usam a capacidade da conversa, sem substituí-la
  pelo JWT do comprador. O token de checkout inclui `coupons:apply`.

## Evidência executada

- 38 testes focados de contratos, isolamento, preços, opções, atualização,
  provas de pagamento e cliente do widget passaram (Node test runner).
- Teste Playwright com API simulada passou: abertura da interface, aumento de
  quantidade, autenticação em `/embed/cart`, total retornado pela API e
  preservação do total diante de erro HTTP 500. Nenhuma chamada ao carrinho
  público é feita pelo widget.
- Compilação Nest da API, typechecks do storefront/widget e build da biblioteca
  widget_v2 passaram. O build completo da API encontrou `EPERM` na substituição
  de `query_engine-windows.dll.node` do Prisma; a compilação Nest foi executada
  separadamente com o cliente gerado disponível.

## Limites da validação e continuidade

- Não foi realizada cobrança real nem comprovado o deploy destas mudanças em
  Railway/Vercel. API e storefront/widget precisam receber o mesmo conjunto.
- O teste do navegador usa respostas simuladas; não substitui smoke test na
  versão publicada com catálogo, frete e provedor de pagamento reais.
- Este resolvedor atende variantes locais do merchant. Produtos federados do
  marketplace exigem resolução própria e conciliação das quantidades/preços com
  `cross_store_line_items`; não estão liberados por esta correção.
- O helper legado de redirecionamento para widget em outra origem não faz parte
  do fluxo inline validado. Ele ainda exige alinhamento entre a origem da prova
  da conversa e a origem de destino antes de voltar a ser utilizado.
- Reavaliar concessões de frete grátis de regras do storefront e conciliação de
  pagamentos iniciados antes de uma alteração de carrinho em uma etapa própria.
