# Revenue Intelligence — equivalência das respostas de navegação

Vigésima oitava entrega local. Corrige o chat normal quando a IA retorna apenas ferramentas de apresentação: a mensagem vazia fazia o caso de uso buscar outra resposta e perder os controles já construídos. O chat normal e o percurso experimental agora usam a mesma frase neutra, preservando os botões sem chamar uma segunda conversa.

O contrato de navegação passa para `checkout-navigation-v2`. A referência do baseline muda e propostas com a versão anterior exigem nova revisão. Não houve alteração de schema ou de flags de ativação.

## Evidência local

- Oito cenários PostgreSQL passaram, comparando o caso de uso real do chat normal com o grupo de controle experimental. Cada uma das quatro ferramentas foi exercitada com texto e sem texto. A comparação inclui mensagem, blocos, etapa e campos pendentes; verifica ausência de segunda conversa e de pagamento e a conclusão do recibo experimental.
- 51 testes de API e baseline passaram; um teste preexistente permanece ignorado. TypeScript da API passou.
- Logs: `.audit/revenue-weekly/navigation-parity-pg.log`, `navigation-parity-unit.log` e `navigation-parity-types.log`.

Provedores de IA e transportes são controlados. A evidência cobre essas respostas válidas de navegação, não a equivalência integral de todas as ferramentas, contextos e saídas possíveis. A ativação pública, a economia integral, os incentivos e o aprendizado entre lojas continuam pendentes. Sem implantação ou chamadas externas.
