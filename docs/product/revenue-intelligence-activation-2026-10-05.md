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

Salvar a política não cobra valores e não aprova uma promoção. Análises e simulações não têm cobrança adicional ao merchant; descontos efetivamente aprovados e utilizados reduzem o valor recebido nas vendas. O orçamento de tokens da plataforma é separado desses valores.

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

## Evolução de experiência discutida com o proprietário

Em 05/10, foi recomendada a substituição do preenchimento obrigatório de limites por valores sugeridos pelo motor dentro da própria proposta. Esse fluxo ainda não está implementado nesta entrega: hoje a política financeira continua explícita e versionada.

O desenho recomendado é: motor calcula benefício, público, prazo, quantidade e exposição máxima com os dados disponíveis; merchant revisa a proposta pronta e aprova ou pede alternativa; operação permanece automática dentro dos termos aprovados. Configuração manual fica como opção avançada. Aumentar exposição de uma estratégia já aprovada exige nova autorização. Sem dados ou custos suficientes, propor comunicação sem desconto ou aguardar evidência, sem apresentar números arbitrários como recomendação personalizada.

## Rollback

Desabilitar as flags de geração, revisão ou execução impede novas ações correspondentes. Preservar tabelas, tarifas, recibos, reservas e histórico de pagamentos para conciliação; não remover migrações nem cancelar efeitos financeiros desconhecidos. Alterações de modelo/regras/revisão invalidam a comparação fixada e exigem nova revisão, em vez de reaproveitar uma aprovação antiga.
