# Limites financeiros de incentivos por loja

Entrega local de RI-11 em 29/09/2026. O Revenue Manager passa a oferecer uma configuração explícita de teto em reais por estratégia, máximo por desconto e quantidade máxima de usos. A loja começa sem permissão financeira e sem valores sugeridos pelo sistema. A configuração não reserva dinheiro, não cria cupom e não aprova um experimento.

## Comportamento do produto

O painel “Orçamento para incentivos” fica junto ao estado da análise semanal. A edição é inline e segue o tema do dashboard. Os campos aceitam valores em reais com até duas casas, convertidos exatamente em centavos, e contagens inteiras. Um desconto não pode exceder o teto da estratégia. Os limites são por estratégia, não um orçamento compartilhado entre todas as estratégias da loja.

Salvar preserva um recibo imutável da configuração, com loja, autor autenticado, versão e chave da solicitação. Alterar ou desativar os limites bloqueia novas reservas de qualquer envelope vinculado à versão anterior, inclusive se a mudança aumenta os valores. Repetir uma solicitação já aceita retorna seu recibo histórico. A tela consulta novamente a versão atual antes de mostrar o resultado, evitando confundir esse recibo com os limites vigentes.

Quando outra sessão altera a configuração, a tela preserva o rascunho e apresenta os limites atuais. O usuário escolhe usar os limites atuais ou manter seus valores antes de uma nova gravação. Se a resposta ao salvamento se perde, os campos ficam bloqueados e a confirmação reutiliza o comando e a chave originais. Respostas de outra loja, incompletas ou inválidas não habilitam configuração presumida. Valores numericamente iguais não geram uma alteração só por trocar a formatação.

## API e vínculo financeiro

`GET /revenue-manager/incentive-policy` lê a configuração da loja autenticada. `PUT` aceita apenas `enabled`, `limitCents`, `maxDiscountCents`, `maxRedemptions`, `expectedVersion` e `requestKey`. Autenticação e plano Revenue Manager são obrigatórios; staff não recebe autorização implícita. Loja e autor enviados no corpo são rejeitados. Versão desatualizada ou chave reutilizada com conteúdo/autor diferente resultam em conflito.

O contrato de orçamento passa para `strategy-incentive-budget-v2`, incluindo versão e hash da política financeira. A construção e o registro exigem política habilitada, da mesma loja, hash íntegro e limites compatíveis. A política financeira nunca substitui o estudo de desconto, as regras comerciais ou a margem mínima. Os novos escritores continuam internos e dependem da flag/lista explícita de lojas.

No banco, o histórico de políticas é imutável. Cada inserção avança um registro de versão atual dentro da mesma transação; versões fora de sequência, edição direta do registro atual e remoção do histórico são bloqueadas. Novos envelopes e reservas bloqueiam esse registro antes dos bloqueios financeiros. Assim, uma reserva não consegue usar um snapshot `REPEATABLE READ` anterior à alteração dos limites: o PostgreSQL rejeita a transação por conflito de serialização. Em `READ COMMITTED`, a nova configuração é conferida e o vínculo antigo é recusado.

Envelopes anteriores sem política associada continuam sendo histórico financeiro, mas não admitem novas reservas. Consumo, cancelamento comprovado e fechamento não dependem de a configuração atual estar habilitada; não há liberação automática de dinheiro incerto. As funções contábeis continuam exigindo integração futura com evidência comercial real, não apenas uma chave declarada pelo chamador.

## Migração e validação

Migração aditiva `20260929050000_merchant_incentive_policy`, espelhada nos dois diretórios de migrações. Cria histórico e registro de versão atual, adiciona vínculo opcional aos envelopes para preservar os registros antigos e atualiza o contrato exigido para novos envelopes. Sem backfill, ativação automática ou alteração de margens. Não reescreve a migração financeira anterior.

Passaram 154 testes distintos: 45 de domínio/rotas, 39 cenários financeiros no PostgreSQL (36 na execução completa e três verificações adicionais de SQL/rollback/conciliação), 65 da regressão de revisão e cinco de execução. TypeScript da API e do dashboard passou. O cliente Prisma foi gerado somente na pasta isolada. A regressão de revisão excluiu o teste dependente de Redis real, indisponível neste ambiente.

A migração foi aplicada pelo predeploy aos dois bancos descartáveis PostgreSQL 17, totalizando 56 migrações. A repetição no banco de release terminou sem pendências. Os arquivos da migração nos dois diretórios têm SHA-256 `092BFCC2B48B8449649983B76817380B56A4A196E78AFAB799581D945B48C96B`.

As duas jornadas de navegador com respostas HTTP controladas passaram em 1440 e 390 px: configuração inicialmente desligada, centavos exatos, salvamento, resposta perdida, conflito entre sessões, desligamento, resposta de loja incorreta, recuperação, alvos de interação e ausência de overflow. Capturas inspecionadas visualmente. Evidências em `.audit/revenue-weekly/incentive-policy-*` e `apps/api/.audit/revenue-weekly/incentive-policy-*-migrations.log`. Não houve chamada de IA, provedor comercial ou serviço externo. Navegador controlado e testes da API/banco são evidências separadas, não uma jornada HTTP integrada de produção.

## Pendências para incentivos executáveis

Esta entrega conclui a configuração financeira no produto e seu vínculo à contabilidade. Ainda são necessários: proposta comercial executável vinculada ao ciclo semanal, aprovação dos termos específicos, atribuição de público, aplicação transacional no checkout/cupom/pagamento e métricas de resgates. Aprovar a estratégia atual de comunicação continua sem conceder descontos. RI-12 (aprendizado validado entre lojas), RI-13 (demais canais), economia integral e piloto operacional permanecem no plano. Sem implantação ou prova de lift/lucro.
