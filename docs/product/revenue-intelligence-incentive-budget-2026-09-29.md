# Orçamento comercial de incentivos por estratégia

Entrega local de RI-11 em 29/09/2026. A simulação semanal já descreve um desconto possível, mas o controle legado de cupons limita usos, não o total de dinheiro comprometido pela estratégia. Esta entrega implementa o registro financeiro necessário para que várias ofertas não ultrapassem o teto revisado.

Atualização posterior: a [configuração financeira por loja](revenue-intelligence-incentive-policy-2026-09-29.md) adiciona a interface e o contrato v2 vinculado à versão dos limites. A descrição abaixo registra o escopo original da quadragésima entrega.

## Contrato e comportamento

- `strategy-incentive-budget-v1`: loja, estratégia, versão, hash da proposta e do estudo, BRL em centavos inteiros, teto total, teto por oferta, quantidade máxima, um uso por comprador e janela de sete dias. Os limites são entradas explícitas; não há orçamento inferido do total simulado nem da resposta da LLM.
- `registerReviewedIncentiveBudget` registra os termos exatos, autor e chave de repetição, após conferir proposta atual, estudo congelado, configuração comercial e vínculo ao ciclo semanal. Exige revisão pendente e início futuro antes de a proposta vencer. Uma estratégia de comunicação já ativa não pode receber esse orçamento.
- Um envelope por estratégia. Termos aprovados não podem ser aumentados ou substituídos por SQL, por uma revisão ou por uma repetição. A chave repetida devolve o registro histórico; conteúdo/autor diferente com a mesma chave é conflito.
- `reserveIncentiveBudget` compromete dinheiro e uma vaga. O banco confere loja, sessão, comprador, BRL, coorte e limites, incluindo uma reserva/resgate por comprador e sessão. Tentativas liberadas podem ser substituídas com uma chave nova; repetir a chave antiga apenas devolve seu estado final.
- `resolveIncentiveBudget` consome o valor efetivo, liberando eventual diferença, ou libera integralmente uma reserva comprovadamente cancelada. O desfecho é final e exige uma identidade de evidência. Repetições idênticas não contam novamente; consumo e cancelamento concorrentes têm um único vencedor.
- `closeIncentiveBudget` impede novas reservas sem liberar compromissos existentes. Desabilitar a flag, encerrar ou vencer o envelope também não apaga custos nem libera tentativas incertas. A conciliação continua disponível.
- `readIncentiveBudget` retorna teto, reservado, consumido, saldo não comprometido e contagens. O estado temporal/financeiro não significa autorização de oferta nem prova de pagamento.

## Atomicidade

As funções recebem a transação do chamador para permitir que carrinho, cupom, evidência comercial e orçamento confirmem ou revertam juntos. Este lote comprova o rollback da contabilidade dentro dessa transação, sem afirmar que o checkout já a utiliza.

Gatilhos mantêm os contadores ao inserir/resolver reservas. O incremento condicional do registro pai impede ultrapassagem em concorrência e provoca conflito de serialização para snapshots antigos em `REPEATABLE READ`. Não se depende apenas de somar registros filhos após um bloqueio estático. Escritas diretas não podem fabricar contadores, reabrir resoluções, trocar valores ou apagar registros; índices parciais protegem o uso por comprador/sessão. Conflitos devem ser tratados como falha transacional, nunca como desconto autorizado.

O registro é contabilidade interna. Uma `evidenceKey` fornecida pelo chamador não comprova, sozinha, pagamento, entrega ou cancelamento. A integração comercial deve verificar a evidência real e fazer a gravação na mesma transação. Também deve validar público do experimento, consentimento, regras, margem, catálogo, carrinho, cupom e pagamento antes de conceder qualquer benefício. O teto financeiro não substitui essas verificações.

## Limites desta entrega

Nenhuma rota, worker, ferramenta da LLM ou aprovação de comunicação chama os novos escritores. A aprovação comercial completa ainda precisa de proposta executável, apresentação dos termos, decisão autenticada e ativação atômica do experimento de incentivo. `scope: funding_only` explicita que este contrato não autoriza oferta. Não se anexou um desconto ao teste de comunicação em andamento.

Ainda faltam configuração de orçamento comercial no produto, proposta/contrato de execução de incentivo, aprovação específica no dashboard, integração transacional com oferta/cupom/pagamento e métricas reais dos resgates. Aprendizado validado entre lojas, demais canais, economia integral e piloto operacional permanecem no plano. Nenhuma alegação de lift, lucro ou prontidão de produção resulta desta entrega.

## Migração e configuração

Migração aditiva `20260929040000_strategy_incentive_budget`, espelhada em `prisma/migrations` e `prisma/deploy-migrations`, cria envelopes e reservas com chaves compostas por loja, restrições e gatilhos. Não há backfill ou alteração nos dados comerciais existentes. Aplicar antes de usar o cliente que acessa esses modelos; não remover as tabelas depois de existirem registros financeiros.

`REVENUE_INCENTIVE_BUDGET_ENABLED=false` e `REVENUE_INCENTIVE_BUDGET_MERCHANT_IDS=` permanecem no exemplo. A lista exige lojas explícitas e não aceita curinga. Essas flags somente permitem a contabilidade interna; não criam uma interface ou habilitam execução comercial. Desativá-las permite fechar/conciliar registros existentes, mas bloqueia novos envelopes/reservas.

## Validação

Passaram 40 testes de domínio (22 novos e 18 do estudo), 24 cenários novos no PostgreSQL, 65 cenários da regressão de revisão e cinco de execução: 134 testes distintos. A regressão de revisão excluiu o teste dependente de Redis real, indisponível localmente. O cenário de aprovação de comunicação recebeu uma asserção adicional de ausência de envelopes/reservas mesmo com a flag financeira ligada e foi repetido isoladamente. TypeScript da API passou com cliente Prisma gerado apenas na pasta isolada.

Os cenários financeiros incluem concorrência por teto, quantidade e comprador; repetição; isolamento entre lojas; consumo parcial; consumo versus cancelamento; falha da transação comercial; desligamento; fechamento concorrente; SQL direto; snapshots `REPEATABLE READ`; e sessões de banco em São Paulo e Tóquio. Todas as comparações de prazo dos novos gatilhos usam UTC explicitamente.

A migração foi aplicada pelo predeploy em ambos os bancos descartáveis e repetida sem pendências (55 migrações de implantação). Durante a revisão local, o ajuste de UTC foi reaplicado recriando somente as tabelas/funções dessa migração ainda não publicada, com verificação explícita de host, porta e nomes dos bancos de teste. Não houve alteração em histórico de produção.

Evidências em `.audit/revenue-weekly/incentive-budget-*` e `apps/api/.audit/revenue-weekly/incentive-budget-*-migration*.log`. Não utiliza provedor, chamada de IA, Redis real ou navegador; a interface não foi alterada. Sem implantação.
