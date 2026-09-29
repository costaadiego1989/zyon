# Inteligência de receita — plano prévio e evidência por experimento

Entrega local sobre `5fa62fa`, na branch `feat/revenue-intelligence-weekly`. Avança RI-03 do [plano técnico](revenue-intelligence-implementation-plan-2026-09-24.md). Não ativa estratégias, não conclui o piloto e não foi implantada.

## Comportamento implementado

O backend registra uma definição de medição antes de iniciar o experimento. O plano identifica controle e tratamento, congela o hash das variantes, a duração, a janela de conversão, o efeito mínimo de interesse e a amostra planejada. Aceita somente dois braços de comunicação, com distribuição 50/50; regras monetárias ficam fora desta versão.

O plano usa uma coorte histórica madura de 28 dias da própria loja para estimar a conversão inicial. Configurações operacionais obrigatórias definem duração de 7 a 28 dias, janela de conversão de 1 a 168 horas e efeito absoluto entre 10 e 2.000 pontos-base. Não há valores operacionais habilitados por padrão. O cliente HTTP não informa contagens, loja, resultado ou política estatística. Dados insuficientes impedem o registro, sem preencher uma taxa inventada.

A estimativa de tráfego informa se o volume anterior alcançaria a amostra no período. É uma projeção, não uma garantia. A semana de revisão não encerra artificialmente a maturação: sete dias de entrada de sessões com conversão em 24 horas permitem avaliação final somente após o oitavo dia.

Os relatórios partem das sessões atribuídas, incluindo sessões sem compra, exposição confirmada ou registro em `prompt_variant_results`. Pedido aprovado dentro da janela conta para conversão; dois pedidos da mesma sessão contam uma conversão e duas receitas. A janela de atribuição é semiaberta. Pedidos tardios e sessões de outra loja não entram no resultado. Valores monetários são apresentados em centavos de BRL, como receita associada; contribuição e custo conciliado de IA permanecem indisponíveis.

Estados: `not_started`, `collecting`, `awaiting_maturity`, `invalid`, `inconclusive`, `positive` e `negative`. Positivo e negativo se referem à **conversão**, não a lucro ou autorização comercial. Não há seleção do melhor braço após observar os dados. O controle fica identificado previamente.

Contaminação do holdout, sessões fora do período, variante alterada, moeda divergente, valores inválidos, repetição de comprador e encerramento antes do prazo invalidam a inferência. O mecanismo de atribuição atual ainda não comprova independência por comprador; por isso a repetição de identidade impede concluir sucesso nesta versão. Amostra insuficiente ou efeito não estabelecido produzem resultado inconclusivo.

## Estatística e referências

- Intervalo bilateral de 95% para a diferença de conversão, tratamento menos controle, pelo método de Newcombe a partir de intervalos de Wilson. Aplicável a duas amostras binomiais independentes; a versão atual usa horizonte fixo, sem declarar resultado durante a coleta. [Referência oficial do statsmodels](https://www.statsmodels.org/stable/generated/statsmodels.stats.proportion.confint_proportions_2indep.html).
- Planejamento aproximado com poder de 80%, alocação igual e variância agrupada sob a hipótese nula e separada sob a alternativa. O poder é uma hipótese de planejamento baseada na taxa histórica, não uma garantia do teste real. [Dimensionamento no statsmodels](https://www.statsmodels.org/stable/generated/statsmodels.stats.proportion.samplesize_proportions_2indep_onetail.html).
- Diagnóstico de desequilíbrio 50/50 por qui-quadrado com um grau de liberdade e limiar de 0,001. Desequilíbrio exige investigação; não demonstra efeito da estratégia.

Valores de referência foram produzidos com `statsmodels==0.14.6` em dependências isoladas de auditoria, sem alterar as dependências do produto. Os testes comparam intervalos positivos, negativos, iguais e extremos, além de quatro dimensões de amostra. Exemplo: conversão inicial de 10%, efeito absoluto de 5 pontos percentuais, 95% de confiança e 80% de poder aproximado exigem 686 sessões por braço. Esses números são um fixture, não configuração de produção.

## Persistência, concorrência e API

Migration aditiva `20260924190000_experiment_measurement_plans`:

- `experiment_measurement_plans`: um plano por experimento, com hash canônico que permanece igual após a normalização de JSONB pelo PostgreSQL.
- `experiment_measurement_reviews`: evidência agregada, versão de definição, hash do plano e chave idempotente por loja/experimento.
- Relações compostas incluem loja e experimento; índices atendem o histórico e a busca de sessões atribuídas.
- Triggers recusam alteração e exclusão de planos/relatórios. Mudanças posteriores exigem outro registro, preservando a evidência anterior.

Registro, edição de rascunho e captura usam lock do experimento no banco. O repositório salva experimento e variantes em uma transação e recusa mudanças em rascunhos com plano registrado. Estados antigos não podem ressuscitar um teste concluído. A leitura de atribuições e pedidos de cada relatório ocorre em um único snapshot SQL. A chave repetida retorna o relatório original, mesmo que os pedidos tenham mudado; uma nova chave gera uma nova fotografia do estado registrado.

Rotas autenticadas com a capacidade `revenueManager`:

| Rota | Uso |
| --- | --- |
| `GET /revenue-manager/experiments/:id/measurement` | Plano e até 20 relatórios mais recentes |
| `POST /revenue-manager/experiments/:id/measurement-plan` | Prepara/congela plano de um rascunho; corpo vazio; exige adesão semanal persistida |
| `POST /revenue-manager/experiments/:id/reviews` | Captura relatório; corpo `{ "request_key": "chave-unica" }` |

Não há chamada de LLM nessas operações. Configuração nova em `apps/api/.env.example`: `REVENUE_EXPERIMENT_DURATION_DAYS`, `REVENUE_EXPERIMENT_CONVERSION_WINDOW_HOURS`, `REVENUE_EXPERIMENT_MINIMUM_EFFECT_BPS`.

## Validação local

| Verificação | Resultado |
| --- | --- |
| Regressão Revenue Manager + experimentos | 358 testes passaram, zero falhas e skips |
| PostgreSQL: medição nova | 12 testes passaram; isolamento, FK composta, registro concorrente, reenvio concorrente, correção, imutabilidade, atribuição e preservação do fluxo legado |
| PostgreSQL + Redis: agenda/orçamento | 11 testes passaram novamente, incluindo 700 lojas, concorrência, recuperação e limites financeiros |
| Referência numérica | Intervalos e amostras conferidos contra statsmodels 0.14.6; 8 testes de domínio passaram também após os ajustes finais |
| TypeScript | API com client Prisma e aliases de fontes isolados |
| Migrations | Base `8a34ef7` em banco vazio local; SQL da fundação semanal e desta entrega aplicados; comparação Prisma sem diferenças de schema |
| Produção/provedor/navegador | Não executados; esta entrega não altera a interface e não comprova jornada completa |

Logs: `.audit/revenue-weekly/measurement-*.log`, referência numérica em `measurement-reference.json`. Banco exclusivo de integração `revenue_measurement_0924`, banco de ensaio `revenue_measurement_migration_0924`, ambos no PostgreSQL de teste em `127.0.0.1:5557`. O teste recusa execução destrutiva fora do banco explicitamente permitido. A suíte de agenda usa separadamente `revenue_weekly` e Redis em `127.0.0.1:6397`.

A regressão inteira da API não foi reexecutada. As falhas globais preexistentes documentadas na entrega econômica não estão sendo declaradas resolvidas. O client Prisma local foi gerado fora das dependências compartilhadas com o workspace original.

## Limites e sequência de implementação

1. **Aprovação e ativação ainda indisponíveis para o fluxo semanal.** O endpoint legado agora recusa antes de registrar aprovação ou aplicar uma regra. O repositório também impede iniciar o experimento semanal pelo caminho antigo. Retorna conflito `EXPERIMENT_VERSIONED_APPROVAL_REQUIRED`. Isso evita exibir aprovação concluída quando ainda faltam as garantias da nova execução. Experimentos de lojas não migradas mantêm seu fluxo legado.
2. **Baseline fiel do checkout ainda pendente.** O hash congela as variantes do rascunho; não prova que o controle reproduz toda a composição atual do checkout. `PrismaHypothesisMerchantContext.getCurrentPrompt` continua indisponível até existir esse contrato, e a geração semanal permanece bloqueada por esse gate. As ativações usadas nos testes de medição são fixtures inseridas diretamente no banco, não a jornada de ativação do produto.
3. Integrar RI-06/07/08: proposta estruturada e imutável, plano apresentado junto da proposta, pedido de alternativa, orçamento de revisão, aprovação da versão exata e dashboard. O lojista não precisa editar os critérios do motor. Os endpoints de medição são a infraestrutura para essa integração, ainda sem tela nova ou cron de relatórios.
4. RI-09 precisa persistir atribuição/exposição com identidade estável, interromper novas atribuições no prazo, publicar a versão aprovada e permitir pausa/reversão. A medição atual detecta atribuições fora do prazo; ainda não implementa o encerramento automático da execução. Interromper manualmente antes do prazo invalida a conclusão positiva.
5. Relatórios usam o estado do pedido no momento da coleta e preservam snapshots anteriores; não reconstroem um ledger histórico de pagamentos/estornos. Seu hash identifica a evidência agregada. Um ledger de origem imutável e componentes econômicos completos permanecem necessários para contribuição e decisões comerciais.
6. Somente após esses gates ligar decisão ao resultado, aprovação de promoção, memória privada validada e, depois, padrões entre lojas com privacidade e teste local. Todo relatório desta entrega mantém `promotionAllowed: false`.

Esta etapa não autoriza expansão do piloto nem remove os bloqueios econômicos. Migrations, deploy, dados reais e aprovação externa de gastos continuam sendo etapas separadas.
