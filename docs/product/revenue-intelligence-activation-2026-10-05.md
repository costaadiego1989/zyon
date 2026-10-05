# Revenue Intelligence: ativação e modalidades comerciais — 05/10/2026

Este registro complementa a [arquitetura](../architecture/revenue-intelligence.md) e o [deploy de 29/09](revenue-intelligence-production-2026-09-29.md). Escopo: Zyon/AACP, loja piloto Athom. Nenhum arquivo ou serviço da Cura Viva faz parte desta entrega.

## Funcionamento

1. A agenda distribui a análise semanal por loja pela madrugada, com fila, teto diário e orçamento de IA da plataforma.
2. Dados maduros, regras comerciais e custos conhecidos sustentam a proposta. A ausência de informação não se transforma em custo zero, resultado positivo ou autorização.
3. O dashboard notifica e apresenta proposta, evidências, limites, público, prazo e plano de medição. Comunicação e benefício financeiro têm autorizações explícitas; uma alternativa exige nova revisão.
4. Após aprovação válida, o checkout atribui controle/tratamento e executa somente o benefício aprovado. Revalida margem, preço, custo, frete, consentimento, versão, orçamento e estado do pagamento.
5. Monitoramento coleta métricas sem uma chamada LLM por evento. Reservas, pagamentos, desistências e estornos permanecem auditáveis. Encerramento bloqueia novas concessões e preserva a conciliação de pagamentos já enviados.

## Novas modalidades implementadas

- Desconto percentual com teto monetário.
- Desconto fixo, escolhido quando os valores históricos dos carrinhos são semelhantes.
- Cupom vinculado à estratégia: criado na mesma transação da aprovação, aplicado automaticamente ao tratamento elegível e visível no painel. Informar o código não cria elegibilidade nem reserva nova; o caminho comum de cupons não pode contornar os controles do experimento.
- Desconto no frete quando existe evidência histórica completa da cotação e do custo, autorizado pelo shipping-engine. É um benefício identificado no total da compra; não altera a cotação original nem reescreve todas as regras globais de frete.

As modalidades v3 preservam o histórico v1/v2 e exigem uma flag e uma lista explícita de lojas. O motor comercial escolhe valores determinísticos a partir da simulação; texto livre da LLM não concede autoridade financeira. Frete já subsidiado não acumula com esse teste.

## Valores da Athom

Em 05/10, o proprietário autorizou escolher valores para sua loja de testes. Foi salva uma política auditada, versão 1, com R$ 300 por teste, R$ 10 por compra e 30 usos. Permanecem desconto máximo de 10% e margem mínima de 38%.

Esses valores não são uma recomendação estatística calculada para a loja. O limite de 30 usos é inferior ao mínimo de 100 compradores por braço do experimento financeiro; portanto, essa configuração não é suficiente para autorizar o A/B financeiro. O histórico observado também está abaixo do pré-requisito de medição: 40 compradores elegíveis maduros, ante o mínimo de 100. O motor deve explicar a inviabilidade, sem aumentar os limites ou fabricar dados para iniciar um teste.

Salvar a política não cobra valores e não aprova uma promoção. Os valores usados nas análises e nos testes internos servem para simulação e não geram cobrança ao merchant. Descontos efetivamente aprovados e utilizados em vendas reduzem o valor recebido pela loja, sem representar uma cobrança da Zyon. O orçamento de tokens da plataforma é separado desses valores.

## Provedores e custo da plataforma

O checkout admite um modelo explicitamente selecionado por `CHECKOUT_LLM_MODEL`, enquanto a análise semanal admite `REVENUE_DEEPSEEK_MODEL`. Isso permite migrar essas rotas sem trocar os modelos globais de catálogo, suporte e storefront. Para DeepSeek Flash/V4 Pro no host oficial, o protocolo envia `thinking.type=disabled`, inclusive em chamadas de ferramentas, mantendo o contrato de respostas e contabilidade.

Foram cadastradas tarifas versionadas para `deepseek-flash`, nas rotas `openrouter` e `deepseek` que apontam ao host oficial. A reserva usa o limite superior não cacheado: USD 0,30 de entrada e USD 1,20 de saída por milhão de tokens, conforme a [documentação oficial consultada em 05/10](https://api-docs.deepseek.com/quick_start/pricing/). O consumo da plataforma continua limitado a USD 0,05 por dia/ciclo e USD 1 por mês; teto não é gasto previsto nem cobrança ao lojista.

## Evidência disponível

- API: build concluído; 17 testes de protocolo/gateway, 19 de geração/governança, 29 de callers/recuperação e 18 de aprendizado compartilhado passaram.
- Comercial: 88 testes unitários distintos de domínio/leitor/compatibilidade e a regressão completa de execução e alternativas (32 integrações PostgreSQL) passaram. Incluem pagamento, estorno, retirada de aprovação, grupos de medição e tentativas de contornar limites no banco.
- Comunicação: 17 integrações direcionadas de monitor, respostas dos dois grupos, idempotência, controle de ferramentas e recuperação durável passaram, sem skips, em PostgreSQL descartável.
- Cupons: 118 de 120 testes unitários passaram; duas falhas legadas de arquivamento foram reproduzidas no código anterior. Não representam validação integral da suíte.
- Estado efetivo dos cupons: mais cinco testes de listagem e typecheck completo da API passaram. A leitura considera prazo, encerramento e capacidade reservada, sem alterar a autorização de compras em andamento.
- Dashboard: typecheck, build, 49 testes direcionados e navegador em larguras 1440 e 390 passaram, com dados controlados.
- Revisão final do dashboard: 19 testes direcionados, incluindo oito novos de status/filtros, typecheck e navegador para cupons encerrados ou sem capacidade passaram nas duas larguras.
- Migrações: 70 migrações aplicadas em PostgreSQL descartável vazio; repetição sem pendências e atualização da base de integração verificadas.
- Provedor real: três chamadas sintéticas ao DeepSeek validaram resposta com modelo fixado, chamada de ferramenta e continuação da ferramenta. Não envolveram comprador, pedido ou pagamento real.
- Widget público: artefato publicado contém protocolo de mensagem durável e rotas de recuperação. Essa inspeção não comprova uma compra real.

Nenhum resultado local comprova aumento de receita ou execução comercial em produção. A verificação da promoção consta abaixo.

## Produção verificada antes da promoção das modalidades v3

API `07a0889e-ff7a-43d7-87cc-f5d5809abfff`, revisão `50d05f89a412204335fe5daa5b8a91a0add20cf9`, disponível e com geração semanal ativa para a Athom. A fila tem worker e processamento periódico. Um erro histórico de 04/10 permanece no histórico; os polls recentes foram concluídos.

O experimento legado “Control vs Improved” foi encerrado pelo caso de uso da aplicação em 05/10 às 16:18:48 UTC, por autorização explícita. Histórico e variantes foram preservados, sem declarar vencedor. A leitura de 17:02 UTC confirmou zero estratégias e zero execuções de incentivo na Athom; nenhuma aprovação foi feita pelo operador.

A próxima janela normal é 06/10, das 03h às 06h, America/Sao_Paulo. O ciclo anterior mantém seu retrato imutável, enquanto o status atual informa geração retomada. A execução ainda pode terminar como dados insuficientes.

## Promoção verificada às 17:25 UTC

Código publicado em `master`, revisão `c1615425bbf743fd3dc4ce0877fcaf3a2c0159b4`:

| Superfície | Evidência |
| --- | --- |
| API Railway | Deployment `4c96d55d-9f62-4610-96e5-58fdcae0c6fb`, SUCCESS, healthcheck `/ready` aprovado; processo em execução confirmou a revisão. |
| Dashboard Vercel | Deployment `dpl_3PtSAt8m4nHDcDZg2wnWfNwq1YLb`, Ready, alias `app.zyon-payments.com.br`, HTTP 200. Log de build confirma `c161542`. |
| Banco | As três migrations `20261005190000_strategy_commercial_coupons`, `20261005191000_strategy_commercial_authority` e `20261005192000_strategy_commercial_validation` estão aplicadas. |
| Configuração comercial | Geração, revisão, aprovação, execução, estudo de descontos, orçamento, incentivos e modalidades v3 habilitados para a lista explícita contendo somente Athom. Os leitores de estudo/modalidades negam uma loja fora da lista. |
| Checkout | Modelo `deepseek-flash`, baseline capturado e pronto, revisão de comportamento `c161542`; chat durável, publicação e recuperação habilitados para Athom. Nenhum modelo global de outros adaptadores foi trocado. |
| Agenda | Geração semanal ativa, loja elegível, um worker, fila disponível e poll a cada 15 minutos. Histórico de erro antigo preservado. |
| Aprovação comercial | Zero experimentos ativos, zero estratégias e zero execuções de incentivo. Publicar e habilitar as flags não substituiu a aprovação do merchant. |

O máximo de entrada foi ajustado para 32.768, preservando 4.096 tokens de saída, três chamadas por ciclo, duas alternativas e 20% do orçamento diário reservado para revisão. A reserva máxima do gerador primário cabe nessa parcela. Execuções compartilham os tetos globais e têm limite adicional de USD 0,05 por execução e oito chamadas por sessão. Os tetos diário e mensal da plataforma não aumentaram.

Aprendizado agregado está habilitado na lista piloto, mas exige cinco lojas independentes. Como há somente Athom na lista, nenhum aprendizado entre lojas pode ser produzido. A política financeira da loja permaneceu versão 1 e nenhuma estratégia foi aprovada durante a verificação.

Evidências operacionais sem credenciais: `.audit/commercial-live-proof.log` e `.audit/commercial-weekly-live.log`. Os bancos e Redis descartáveis usados nos testes foram encerrados e removidos; nenhum serviço da Cura Viva foi alterado.

## Planejador e limites sugeridos — implementação em validação

O novo fluxo elimina o preenchimento obrigatório dos três limites financeiros para lojas que usam o modo automático. Antes da chamada à LLM, o backend simula opções com os dados maduros da loja, os custos conhecidos, a margem mínima e o desconto máximo configurados. Calcula benefício, público, prazo, quantidade e exposição máxima; exclui as opções que não sustentam a amostra necessária durante a semana. A ferramenta `submit_revenue_strategy` escolhe uma dessas opções ou uma estratégia de comunicação sem desconto. Não aceita valores livres nem aprova ações.

O merchant recebe uma proposta completa e uma aprovação correspondente ao tipo de teste. Pode recusar ou pedir uma alternativa; a resposta gera outra versão para revisão, sem reaproveitar a autorização anterior. Uma proposta comercial testa o benefício mantendo a conversa atual do checkout. Uma proposta de comunicação testa a mudança de conversa sem criar benefício financeiro. Gerar a sugestão não cria cupom ativo, orçamento autorizado ou experimento.

Somente a aprovação dos termos exatos materializa a política financeira proposta e a execução, na mesma transação. A configuração manual continua disponível como opção avançada, e o modo desativado impede novos benefícios financeiros. Políticas manuais existentes são preservadas. Aumentar a exposição de uma estratégia aprovada exige nova autorização. Simulações não têm cobrança adicional ao merchant; descontos aprovados e utilizados reduzem o valor recebido nas vendas.

O catálogo inclui a opção de desconto progressivo em duas etapas: entrada no teste e preparação do pagamento. O limite máximo fica reservado desde a entrada, mas somente o desconto efetivamente concedido pode ser contabilizado na venda. A progressão é comandada pelo backend; uma alteração no total exige nova confirmação do comprador antes do pagamento. Não reescreve regras globais nem acumula os valores das etapas.

Esta evolução concluiu a validação local. As evidências de produção nas seções anteriores referem-se às modalidades v3 e não comprovam a publicação do novo planejador. A nova flag `REVENUE_STRATEGY_PLANNER_ENABLED` depende também da lista explícita de lojas das modalidades comerciais. A Athom continua sujeita aos requisitos de dados e medição; habilitar o planejador não fabrica histórico nem autoriza uma promoção.

### Evidência do planejador

- Seis testes de ferramenta/gateway passaram: seleção pelo identificador da opção, contexto exato de cache, reserva incluindo o schema da ferramenta, rejeição de valores livres, adulteração e outra loja.
- 56 testes de governança, validação e estudo de desconto passaram.
- 37 testes de política automática e leitura histórica passaram, incluindo sete integrações PostgreSQL. O fluxo com dez mil compradores de teste e dez conversões percorreu captura real, escolha da ferramenta, publicação sem autorização financeira, aprovação, cupom e pagamento. A revisão trocou desconto fixo por frete preservando a seleção original no ciclo. A leitura histórica foi corrigida para não exceder a pilha do PostgreSQL nesse volume.
- 27 integrações PostgreSQL de execução passaram, incluindo seis cenários progressivos: Pix e cartão exigem nova confirmação antes da cobrança, concorrência não duplica concessões, o grupo de controle não recebe benefício, pagamento e estorno preservam o histórico, mudanças no carrinho liberam a reserva sem reinscrever o comprador. Foram também executados 82 testes unitários distintos de checkout e modalidades comerciais.
- Dashboard: 48 testes direcionados, typecheck, build e navegador com dados controlados em 1440 e 390 passaram. Após a revisão textual sobre testes internos sem cobrança, os 30 testes afetados e o build passaram novamente.
- API: build completo e typecheck passaram. As 73 migrações foram aplicadas no PostgreSQL descartável, incluindo `20261005200000_strategy_planner_policy`, `20261005210000_progressive_incentives` e `20261005210100_progressive_payment_method`.
- Revisão: os 72 testes de integração da suíte completa passaram em PostgreSQL e Redis descartáveis, sem skips. Incluem a nova geração/revisão por ferramenta, contratos legados, notificação, condições de aprovação, orçamento de IA, recuperação pela fila e bloqueios contra mudanças concorrentes.

Os compradores, pedidos, provedor de pagamento e respostas de IA dessas integrações são controlados para teste. Nenhuma aprovação, cupom ou cobrança de comprador foi criada em produção por essa validação. Ela comprova as proteções do fluxo local, sem comprovar aumento de receita.

## Rollback

Desabilitar as flags de geração, revisão ou execução impede novas ações correspondentes. Preservar tabelas, tarifas, recibos, reservas e histórico de pagamentos para conciliação; não remover migrações nem cancelar efeitos financeiros desconhecidos. Alterações de modelo/regras/revisão invalidam a comparação fixada e exigem nova revisão, em vez de reaproveitar uma aprovação antiga.
