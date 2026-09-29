# Simulação de descontos com dados da loja

Entrega local de 29/09/2026, preparação econômica de RI-11. Corrige o gerador legado de sugestões de desconto e adiciona um leitor reutilizável de coortes. Não ativa cupons/descontos vinculados à estratégia semanal.

## Comportamento

- O gerador deixa de usar um carrinho fictício de R$ 250 e a tolerância de cinco pontos abaixo da margem mínima. Busca um percentual comum, em passos de 0,01 ponto percentual, que preserve o mínimo em cada carrinho da amostra. O mesmo `rules-engine` usado pelo checkout valida a oferta resultante.
- O leitor usa a primeira sessão por comprador identificado no intervalo observado, consentimento vigente e intenção registrada até a entrada dessa sessão. A janela de conversão desta análise descritiva é de 168 horas, já encerrada; pedidos aprovados da própria loja, em BRL, contam uma vez dentro do intervalo semiaberto. Repetições de sessão, pagamentos pendentes e compras tardias não inflam a taxa.
- Preços e custos são reconstruídos do catálogo atual da própria loja, considerando apenas produtos/variantes ativos e produtos não excluídos. Preço/custo enviados no snapshot não substituem o catálogo. Custo ausente, negativo, variante externa, moeda incompatível, personalização, quantidade inválida ou outro benefício excluem o carrinho. Zero explicitamente cadastrado continua sendo um custo conhecido.
- O percentual respeita a configuração, a oferta fica limitada à faixa de valores simulada, possui teto por oferta calculado em centavos e exige ausência de cupom. A regra nasce desabilitada, com revisão humana e risco estimado médio. A classificação de baixa conversão é um critério descritivo de seleção, sem previsão causal de melhora.
- O relatório agregado acompanha a hipótese no JSON existente: tamanho da amostra, conversão observada, menor margem estimada, faixa dos carrinhos, teto por oferta, total hipotético de descontos e premissa de taxa de pagamento de 4%. Não persiste identificadores dos compradores nessa projeção.
- A deduplicação considera loja, observação e regra, com trava da loja no PostgreSQL. Repetições após recusa não recriam a mesma hipótese naquela observação; outra loja ou outro ciclo pode receber sua sugestão. Falha na notificação desfaz a hipótese e o relatório na mesma transação.
- O dashboard mostra “A medir” para efeito na conversão de sugestões de desconto, inclusive históricas. Apresenta os dados da simulação quando presentes e explica que o total hipotético não é previsão de gasto ou orçamento reservado. Hipóteses antigas sem relatório não recebem evidências retroativas.

## Limites explícitos

O leitor faz uma simulação com o catálogo atual, não uma apuração histórica de lucro. A margem estimada usa a definição já existente de mercadoria e taxa presumida de pagamento; tributos, frete, estornos e IA não estão incluídos. Cada oferta real continua dependendo da revalidação comercial do checkout. A simulação não reserva estoque, preços, capacidade de cupom ou orçamento comercial.

Exige pelo menos 30 compradores elegíveis. Mais de 10 mil sessões ou registros de intenção no recorte interrompem a sugestão, em vez de extrapolar uma amostra truncada. O intervalo de entrada usa o lookback configurado, deslocado para que os sete dias de resultado estejam encerrados. Não se trata do plano causal dos experimentos semanais.

O worker legado é o consumidor desta entrega; lojas sob governança semanal continuam fora desse worker. A conexão com a proposta semanal imutável, aprovação exata, público atribuído, orçamento comercial concorrente, resgate e métricas dos incentivos permanece pendente. Também permanecem a economia integral, aprendizado validado entre lojas, outros canais e piloto operacional. Nenhuma flag foi ativada e nenhuma migration foi necessária.

## Validação local

- 87 testes de domínio/aplicação: simulação, leitor, worker, HTTP, aprovação/criação de experimentos legados, autorização de descontos e regras avançadas. Log: `.audit/revenue-weekly/discount-simulation-regression.log`.
- 57 testes PostgreSQL da revisão de estratégias, incluindo quatro novos: concorrência, isolamento por loja/ciclo, rollback de notificação e leitura real das coortes/catálogo. Log: `.audit/revenue-weekly/discount-simulation-pg-final.log`. Um teste existente dependente de Redis real foi excluído pelo filtro, sem ser apresentado como validado.
- TypeScript da API com cliente Prisma isolado e do dashboard aprovados. Logs `discount-simulation-types.log` e `discount-simulation-dashboard-types.log` no mesmo diretório de auditoria.
- Duas jornadas de navegador, 1440 e 390 px, com respostas HTTP controladas: relatório, incerteza histórica, bloqueio de aprovação semanal para hipótese antiga, ausência de efeitos ao consultar e ausência de overflow. Script: `apps/dashboard/scripts/verify-discount-simulation.mjs`; screenshots inspecionadas em `.audit/revenue-weekly/discount-simulation-browser/`.

A primeira execução PostgreSQL passou em três casos e falhou na fixture de sessão sem `updatedAt`; a fixture foi corrigida e todos os 57 casos passaram na execução final. Não houve LLM, Redis real, cupom resgatado por esta funcionalidade, provedor externo, push ou implantação.
