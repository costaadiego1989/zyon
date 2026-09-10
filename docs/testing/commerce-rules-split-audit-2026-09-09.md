# Regras comerciais, cross-sell e split

Auditoria iniciada em 2026-09-09 na master 46a112b. Validação isolada em 2026-09-10, inicialmente sobre e55a1cb e integrada à master 5a47b89. Apenas os arquivos desta correção compõem a entrega; alterações paralelas foram preservadas.

## Cadastro e semântica das regras

O editor do produto reutiliza o editor de regras do checkout. Todos os tipos abaixo foram inspecionados. Condições são combinadas com AND; a primeira regra correspondente por prioridade prevalece.

| Condição | Interpretação e aviso |
| --- | --- |
| cart_total | Valor dos produtos do carrinho, em reais; respeita >, >=, <, <= e igualdade. |
| shipping_cost | Custo de uma cotação real; frete desconhecido não equivale a zero. |
| cart_item_count | Quantidade total de unidades do carrinho, incluindo produtos diferentes. |
| product_in_cart | Presença de SKU elegível; escopo automático restringe regras do produto. |
| category_in_cart | Presença da categoria elegível. |
| coupon_applied | Presença ou ausência de cupom. |
| buyer_type | Tipo de comprador; desconhecido não equivale a recorrente. |
| payment_method | Modalidade escolhida; não é presumida antes da escolha. |
| trigger_fired | Evento configurado no atendimento. |

| Ação | Comportamento do aviso |
| --- | --- |
| offer_discount | Oferta condicional sobre o carrinho, com percentual e limite em reais; confirmação usa o valor efetivamente aprovado. |
| offer_free_shipping | Oferta condicional, respeitando a permissão de frete grátis da loja. |
| offer_coupon | Código oferecido com validação no carrinho, sem afirmar que já foi aplicado. |
| offer_installments | Opção de parcelamento conforme o pagamento; não promete juros zero. |
| suggest_product | Sugestão com o nome configurado. |
| show_message | Texto configurado pela loja. |
| do_nothing | Sem aviso. |

Não existe ação específica de leve X/pague Y nem desconto exclusivo na segunda unidade. Quantidade + percentual representa desconto no carrinho; o aviso não transforma isso em uma promoção diferente. Regras condicionadas a frete, pagamento, comprador ou evento permanecem condicionais enquanto esse contexto não estiver disponível.

## Correções

- GET autenticado para recarregar regras avançadas do produto. Salvar/remover preserva regras globais e de outros produtos; conflito de IDs é rejeitado e o SKU vem do catálogo do lojista.
- Metadado productId identifica o proprietário da regra; condições adicionais do lojista são preservadas. A gravação usa a versão atual das configurações.
- ProductCard, carrossel e conteúdo rico recebem avisos condicionais. O catálogo sem regras preserva seu contrato anterior. Removida a frase fixa de frete grátis nacional sem respaldo na configuração.
- Carrinho no chat passa a mostrar nextNudge e activeRules. Estilo, layout e animação originais do CartSummaryBlock foram preservados a pedido do usuário; apenas o componente de avisos tem estilo novo, usando os tokens existentes.
- Avisos são recalculados ao adicionar, consultar, alterar quantidade e remover. A leitura/alteração REST usa a mesma avaliação. Promoção por produto deixa de ser aplicada duas vezes no mesmo retorno.
- Limiares estritos exigem mais um centavo/unidade. Múltiplas condições pendentes não viram promessa baseada em um único valor. Avisos não anunciam regras bloqueadas pela prioridade atual. A confirmação mostra o desconto real após os limites da loja.
- Nova opção post_cart, desligada por padrão e independente de pre_cart. Sugestões posteriores dependem de adição bem-sucedida; pre_cart pode coexistir no detalhe do produto. Identificadores enviados ao botão correspondem a variantes; produtos já no carrinho e duplicados são filtrados. Sugestões de fallback não anunciam percentual sem promoção autorizada.
- Dois dublês de teste receberam o método vazio exigido pela interface de operações atualizada em paralelo; não houve mudança funcional em operações nesta entrega.

## Taxa e split

PLATFORM_FEE_BRL=0.99 define R$ 0,99 de taxa do comprador. Os exemplos de ambiente foram atualizados. Asaas e crypto passam a receber platformFeeCents, que já era utilizado nos outros provedores. O valor inclui a taxa do comprador e a taxa contratual do lojista, quando aplicável; esta última não é somada novamente ao total do comprador.

Exemplo validado: R$ 335,00 de produtos/frete gera cobrança de R$ 335,99. Com taxa contratual do lojista de R$ 2,99, o valor da plataforma é R$ 3,98. Repetir a mesma chave de idempotência não cria nova cobrança.

- Asaas: split fixedValue usa a wallet da plataforma correspondente ao ambiente. Cobrança na conta de um lojista sem wallet da plataforma configurada é bloqueada antes da chamada de criação. Se a cobrança já pertence à própria conta da plataforma, não é enviado um split para ela mesma.
- Mercado Pago: cobrança na conta do lojista com taxa da plataforma exige credencial OAuth; um token simples do lojista não permite fingir a coleta da comissão.
- Stripe: seleção inicial respeita o estado da conexão; reconciliação de uma intenção já existente preserva sua conta original.
- Crypto: taxa é encaminhada ao adaptador; depende da treasury da plataforma, que não foi configurada nem validada nesta tarefa.

Foram consultadas, por GET autenticado, as wallets das credenciais Asaas já pertencentes à Zyon, em teste e produção. As duas consultas tiveram sucesso. ASAAS_PLATFORM_WALLET_ID_TEST, ASAAS_PLATFORM_WALLET_ID e PLATFORM_FEE_BRL foram gravadas nos .env locais da raiz e da API. Segredos e IDs de carteira não integram o Git.

A configuração do destino foi verificada; não houve cobrança, liquidação ou recebimento real como teste. Variáveis do ambiente de hospedagem não foram alteradas. O crédito efetivo e os custos do provedor dependem de validação operacional no ambiente publicado.

Referências oficiais: [walletId Asaas](https://docs.asaas.com/reference/recuperar-walletid), [split Asaas](https://docs.asaas.com/docs/split-de-pagamentos), [split para a própria conta](https://docs.asaas.com/docs/split-asaas-no-pluga), [comissão Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace), [Stripe Connect](https://docs.stripe.com/connect/destination-charges?platform=web&ui=elements).

## Validação executada

- Build da API, incluindo pacotes internos e geração Prisma: passou.
- Build do dashboard: passou. Suíte do dashboard: 549 testes passaram.
- Build de produção do storefront e dependência widget: passou.
- Testes focados da API na master 5a47b89: 91 passaram, zero falhas (regras, catálogo, carrinho, cross-sell, conteúdo público, pagamentos e compatibilidade dos dublês).
- Playwright sobre componentes reais, em 390 px e 1440 px: 2 testes passaram. Verifica avisos de produto, valor aplicado, atualização após reduzir quantidade, opção post_cart e ausência de overflow horizontal. API/handlers são exercitados separadamente com repositórios de teste; não se trata de compra real em produção.
- Revisão visual do screenshot móvel realizada. O CSS/animação originais do carrinho foram restaurados e revalidados.
- A suíte geral da API foi executada e não está verde. A base e55a1cb, reconstruída em saída separada para os arquivos alterados, apresentou 1.652 testes aprovados, 23 falhas e 20 ignorados. A execução inicial com a correção reproduziu essas 23 falhas e revelou uma diferença de contrato no catálogo sem regras; essa diferença foi corrigida e validada pelo teste do catálogo na execução focada final. A execução geral final sobre a master 5a47b89, com tempo suficiente, terminou em 73,5 segundos: 1.654 testes aprovados, as mesmas 23 falhas e 20 ignorados; não se declara aprovação geral nem prontidão de produção com base nos testes focados.

Limites de sessão/cooldown de cross-sell existentes não foram certificados como parte desta opção nova. Persistência com banco real, deploy e liquidação financeira não fazem parte da evidência executada aqui.
