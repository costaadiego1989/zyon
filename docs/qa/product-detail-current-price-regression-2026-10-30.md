# Preço de oferta e cartão do produto

Em produção, a consulta “Quais produtos estão com desconto?” informou a oferta atual R$100→R$90, mas a hidratação nativa do único resultado carregou um cartão separado com o preço-base de R$100. Inbox: `20d6c237-734a-4f04-ac37-ed9c9c172dd1`, revisão `a67f9bb`.

A leitura dos detalhes agora reutiliza o leitor comercial canônico para uma cotação independente por variante, sem criar carrinho ou escrever estoque. O cartão respeita o preço confirmado da variante e preserva o preço-base. Quando a mesma execução também dispõe de uma oferta válida, a projeção exige produto, variante, preço original e validade compatíveis; cupom condicional, oferta vencida ou ambígua não alteram o cartão.

O teste de projeção falhava antes da correção. Os 43 testes focados passaram, incluindo leitura de detalhes, preços promocionais, base original, estoque, promoções inválidas, isolamento, desconhecimento da autoridade e hidratação nativa. Publicação e reteste real permanecem pendentes.
