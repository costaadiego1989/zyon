# Quantidade acima do estoque — 30/10/2026

## Falha observada

No inbox `f48dddec-70de-4dc1-b5cf-c67d1ceeca71`, revisão publicada `1ecd5e6`, o comprador pediu alterar o Essencial para 20 unidades. Os logs e os dois controles de provider somente de leitura mostraram classificação `ADD_CART`, mas nenhuma chamada de `get_cart` ou `update_cart_item`. O modelo pediu confirmar novamente a quantidade; a guarda de leitura substituiu essa resposta por uma limitação genérica. Não houve uma rejeição de estoque pelo handler nesse turno.

Evidências históricas: `.audit/whatsapp-final-acceptance-20261028/production-cart-excess-52e-logs.json` e `production-cart-excess-52e-provider-proof.json`. O replay usava ferramentas simuladas e não prova o resultado de uma atualização real.

## Correção

- O guia do agente orienta consultar o carrinho atual para resolver a linha, sem reconfirmar uma quantidade explícita. Ambiguidade de linha ainda exige escolha do comprador.
- Um alvo numérico explícito é vinculado aos argumentos de atualização; o modelo não pode reduzir 20 para 2 ou converter o pedido em remoção.
- O handler consulta estoque canônico, desconta reservas e rejeita falta de estoque antes de escrever. Somente essa rejeição recebe `notApplied`, vinculado ao carrinho, variante e quantidade.
- O turno reconhece apenas um marcador válido e correspondente como rejeição conhecida. A resposta canônica explica que o estoque não permite a quantidade solicitada, sem inventar um número disponível e sem alterar a quantidade por conta própria.
- Estoque inválido, erro, timeout, marcador malformado ou divergente continuam sem confirmação. A execução termina sem retry e sem converter um resultado incerto em recusa conhecida ou sucesso.

## Validação

150 testes passaram no gate focado: estoque/reservas, quantidade explícita, saídas de ferramenta, consentimento, update/remove, quantidade fracionária, endpoint de alteração e fluxo de um clique. O gate inclui a preservação de resultado incerto após erro de correlação e de timeout após possível escrita.

Log: `.audit/whatsapp-final-acceptance-20261028/local-cart-stock-rejection-resume-final.log`.

Nenhum build completo, deploy, envio de mensagem ou alteração no banco de produção foi executado por esta correção. Ainda é necessário publicar e repetir o pedido real com a linha de teste no carrinho. A orientação ao modelo não garante, por si só, que ele fará a consulta; a confirmação vem do reteste real. A validação de estoque permanece no backend independentemente da narração.
