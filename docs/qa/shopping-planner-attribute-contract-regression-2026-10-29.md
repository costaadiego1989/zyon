# Contrato completo do plano de busca no modo JSON

O inbox real `98de6da0-8df0-43f3-985b-0571f7fe0f79` pediu um organizador pequeno para poucos cabos na mochila, limitado aR$70, sem inclusão ou cobrança. No deployment `52eab3c2-5bb4-44b1-b756-b654c9684e40`, fonte1ecd5e6, o turno `710c10dc-7a4f-4cf1-8189-2a76b8349460` terminou em `shopping_search_unconfirmed`.

Os logs mostram classificador e shopping_plan concluídos, seguidos de `invalid_output` antes de qualquer ferramenta. Dois controles readonly do provedor real classificaram PRODUCT_SEARCH e preservaram maxPriceCents=7000. Ambos falharam no contrato em attributes[0], attributes[1] e attributes[2], que não eram objetos válidos. O problema ocorreu antes da leitura monetária.

O modo json_object recebia somente um exemplo com attributes vazio e delivery descrito como “objeto ou null”. O contrato completo dos objetos internos era enviado apenas no modo json_schema. Agora o mesmo JSON Schema estrito está no prompt nos dois modos. A orientação também distingue instrução operacional suportada de exigência de produto não comprovável: consultar preço/promoções/condições vigentes não é por si só um critério não suportado, pois a leitura canônica revalida preços e promoções.

O validador permanece estrito. Nenhum campo é removido, convertido ou preenchido após a resposta. Não há reparo, retry ou rebaixamento de requisitos para forçar resultados. Atributos textuais inválidos continuam sendo rejeitados; orçamento corrigido, preços, promoções, margem, estoque e demais contratos não mudaram.

O controle candidato `production-budget-70-candidate-52e-proof.json` usa o provedor real e o reader canônico com banco somente leitura. O plano da frase original passou, manteve7000 e preservou atributos obrigatórios. O reader retornou zero itens com esses atributos; isso não prova a inexistência de um produto adequado em linguagem natural. A correspondência semântica entre tamanho/uso e os dados do catálogo continua sendo uma limitação da busca atual. Não foi descartado um requisito para apresentar o Essencial como comprovadamente adequado.

Uma correção sintética de orçamento paraR$95, sem esses atributos no histórico usado pelo controle, passou e retornou somente itens abaixo do teto, com evidence.appliedPlan idêntico ao plano. Esse controle não é um aceite do WhatsApp/storefront nem prova da sequência real de correção com todas as restrições históricas.

Validação local:53/53 testes focados passaram em `local-budget-planner-full-contract-final.log`. Evidências de logs e provedor em `.audit/whatsapp-final-acceptance-20261028/production-budget-70-52e-logs.json`, `production-budget-70-52e-provider-proof.json` e `production-budget-70-candidate-52e-proof.json`. Não houve envio WhatsApp, persistência de conversa nem mutação de produção.
