# Condições comerciais atuais na conversa

Perguntas sobre concorrente, vigência ou combinação de benefícios estavam reutilizando a oferta do histórico sem leitura corrente. O validador rejeitava o percentual sem evidência; outras respostas apenas prometiam consultar e encerravam o turno.

A classificação distingue uma objeção pura (“está caro”, “vou pensar”, recusa) de uma pergunta factual. A pergunta factual comercial usa `NEGOTIATE_PRICE`, `requiresTool:true`, sem se tornar descoberta de novos produtos. O histórico resolve referências e não autoriza uma oferta. Preço alegado de concorrente não se torna orçamento do comprador.

Antes da primeira narração factual, o agente consulta `list_promotions` e `get_daily_deals` pelos executores existentes, que validam os resultados. Anexa os fatos e as limitações ao contexto. Um erro não confirma condição; resultado vazio só confirma ausência nessa consulta. Se nenhuma leitura obrigatória foi confirmada, retorna uma limitação concreta em vez de prometer uma consulta futura. Nenhum guard comercial foi afrouxado.

`allowStackDiscountAndFreeShipping` percorre o contexto tipado desde MerchantRule. `false` proíbe a combinação; `true` permite avaliar elegibilidade conjunta, sem conceder benefícios. As leituras não aplicam cupom, não adicionam itens e não cobram. A confirmação de uma escrita continua sendo responsabilidade da política e do resultado canônico. JSON inválido mantém fallback sem reparo ou nova narração; resultado desconhecido de escrita continua sem replay.

O reader de ofertas é limitado a até 30 resultados e uma janela de 60 produtos. Não comprova ausência global nem todas as condições de um produto fora da janela. Dados específicos de um item conhecido ainda exigem sua leitura própria quando necessários. Frete por produto ainda depende da cotação determinística e do endereço.

Validação local: 286/286 testes passaram em `current-commerce-evidence-final-combined.log`. A suíte inclui regressões de ausência/falha/leitura malformada, leitura antes da primeira fala, flag de acumulação, ausência de escrita por comparação com concorrente e JSON inválido sem retry/review. Também executa os contratos de roteamento, contexto, UI, escopo e estados terminais de mutação.

O controle `production-factual-prefetch-candidate-3dd-proof.json` usa o provedor real e snapshots de leitura do deployment `3dd8ee6b-ce6a-43e0-aa2d-656b7cee4544`. A última rodada fez as duas leituras antes da fala em ambos os cenários, classificou os dois como fatos comerciais e passou o guard. Zero escritas de banco, persistência de conversa ou mensagens enviadas. As ferramentas utilizam snapshots reais, com lista de cupons vazia e carrinho simulado; isto não é aceite do fluxo real.

Limitações do controle: uma rodada anterior da comparação com concorrente ainda caiu em `unsafe_content`. O controle também usa o reader/contrato publicado em `0dff8ab`, sem `expiresAtFormatted`; reproduziu horários errados. A correção de fuso de `c609115` deve permanecer no release integrado. Só os retestes reais após publicar o conjunto podem fechar esses casos.
