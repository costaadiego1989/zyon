**Quarta entrega local — versões de propostas e revisão assíncrona**

24/09/2026. Continuação de `f8409c9`, na branch `feat/revenue-intelligence-weekly`. Avança RI-07 e amplia a admissão financeira de RI-05. Não conclui a aprovação/ativação de estratégias nem a jornada do dashboard.

**Comportamento implementado.** A publicação de uma hipótese semanal grava uma identidade de estratégia, sua primeira versão e a notificação na mesma transação protegida pela lease do ciclo. O ID da hipótese é preservado. A versão contém recomendação, observação usada, configuração comercial, validade e hash canônico. A estimativa de lift do modelo está marcada como não medida. Não há backfill automático de hipóteses antigas sem evidências suficientes.

Versões e recibos de decisões são imutáveis, inclusive por triggers PostgreSQL que recusam atualização e exclusão. Chaves estrangeiras compostas preservam a loja entre ciclo, estratégia, versão, ação e revisão. A configuração econômica da loja continua sendo a autoridade; a sugestão do cliente é uma preferência, não uma nova política comercial.

O cliente da API pode consultar propostas e histórico, recusar uma versão ou pedir uma alternativa informando versão, hash e chave idempotente. Loja e ator vêm da autenticação. Repetir a mesma decisão retorna o recibo original; mudar conteúdo, ação ou ator com a mesma chave retorna conflito. A corrida entre recusa e revisão tem um único vencedor. Endpoints antigos não podem modificar uma hipótese já versionada sem esse contrato.

O pedido de alternativa grava a ação e o trabalho pendente atomicamente. O worker existente recupera esse trabalho pelo polling e executa uma revisão com lease, fencing token, limite de tentativas e checkpoint da resposta. Usa o comentário, a proposta anterior e a observação congelada. Não abre outro ciclo semanal. A nova versão mantém a validade e as evidências originais; não apaga a versão anterior nem herda aprovação. Propostas expiradas deixam de impedir a análise da próxima semana; pendências legadas preservam seu comportamento anterior.

Cada chamada de revisão reserva dinheiro antes do envio usando o ciclo original, a categoria `revision` e a parcela protegida do orçamento. Continua sujeita aos tetos diário, mensal, por ciclo, de chamadas e de capacidade do provedor. Resposta já persistida é reutilizada. Uso incerto conserva a reserva; retry precisa de novo saldo. Mudança de política ou controle durante a geração impede publicar a versão.

A revisão tem uma notificação persistida desde o pedido. Mudanças de estado atualizam o mesmo aviso; repetição do mesmo estado de espera não marca o aviso como não lido novamente. A revisão concluída publica seu aviso na mesma transação da versão. Ler detalhes não chama LLM nem decide a proposta.

**API adicionada.** Todas as rotas exigem autenticação e a capacidade comercial `revenueManager`.

| Rota | Comportamento |
| --- | --- |
| `GET /revenue-manager/strategies?after=...` | Paginação por ID, até 20 estratégias da loja |
| `GET /revenue-manager/strategies/:id` | Versões, recibos, andamento, validade e bloqueios |
| `POST /revenue-manager/strategies/:id/reject` | Recusa transacional vinculada à versão e ao hash |
| `POST /revenue-manager/strategies/:id/revisions` | `202`, recibo de pedido durável de alternativa |
| `POST /revenue-manager/strategies/:id/approve` | Valida identidade e política; retorna `409 STRATEGY_APPROVAL_PREREQUISITES_REQUIRED` enquanto faltarem os artefatos revisáveis de checkout/medição |

Corpo das decisões: `version`, `proposal_hash`, `request_key` e `feedback` opcional; feedback é obrigatório para revisão, limitado a 2.000 caracteres. Campos de autoridade enviados pelo cliente são recusados. O recibo do pedido não afirma que a alternativa já está pronta; o estado atual está no detalhe da estratégia.

**Limite de produto ainda presente.** `PrismaHypothesisMerchantContext.getCurrentPrompt()` continua retornando indisponibilidade: o checkout ainda não expõe um baseline fiel e versionado. A geração semanal real continua bloqueada por essa dependência. Os testes de revisão concluída usam controle e respostas sintéticos. Com o adaptador real atual, o worker adia a revisão sem chamar o provedor.

Nenhuma aprovação é gravada nesta entrega: `approval_available` e `activation_available` permanecem falsos. Aprovar exige uma futura versão que apresente o contrato real do checkout e o plano de medição; esses artefatos não serão anexados silenciosamente a algo já aprovado. Não há nova execução comercial, cupom, desconto, publicação no checkout ou aprendizado entre lojas.

**Validação local.**

- 360 testes de regressão de `experiments` e `revenue-manager`, aprovados, sem skip. Não representa aprovação de toda a API.
- 18 testes novos com PostgreSQL real: publicação/rollback atômicos, concorrência, isolamento, imutabilidade, idempotência, expiração, decisões antigas, drift de política, saída inválida, limites, checkpoint e uso incerto. Um desses testes utiliza Redis e a classe real `WeeklyAnalysisJob` para recuperar e concluir uma revisão com gerador sintético.
- 11 testes anteriores com PostgreSQL/Redis repetidos, aprovados, incluindo distribuição de 700 lojas e admissão financeira concorrente.
- TypeScript da API com cliente Prisma isolado, aprovado.
- SQL aditivo `20260924200000_revenue_strategy_versions` aplicado em bancos locais dedicados, incluindo ensaio sobre cópia do banco vazio preparado com as migrations anteriores. Comparação com o schema final: migração vazia, sem drift. Triggers de imutabilidade exercitados nos testes.

Evidências em `apps/api/.audit/revenue-weekly/`: `strategy-regression.log`, `strategy-integration-final.log`, `strategy-weekly-regression.log`, `strategy-typecheck-final.log`, `strategy-migration-final.log` e `strategy-migration-drift.log`. Fixtures: PostgreSQL local porta 5557, bancos `revenue_strategy_0924` e `revenue_strategy_migration_0924`; Redis local porta 6397, banco 15 reservado à prova da nova fila. Dados artificiais, transporte LLM substituído por fixture, nenhuma chamada paga. Os containers dedicados foram parados ao concluir a validação.

Não houve teste da jornada HTTP completa com autenticação real ou navegador nesta entrega. O dashboard ainda usa o detalhe legado: a integração visual com a nova versão e o pedido de alternativa é pendência de RI-08. Não habilitar esse fluxo ao cliente com base apenas nesses testes de backend.

**Configuração e implantação.** Migration e geração de Prisma precisam preceder a nova API, inclusive porque a proteção das rotas legadas consulta a nova tabela. A mudança é aditiva e não transforma decisões antigas em aprovações novas. `REVENUE_STRATEGY_REVISIONS_ENABLED=false` por padrão; habilitação requer também modo semanal, loja permitida, Redis, elegibilidade, `REVENUE_AI_MAX_REVISIONS_PER_CYCLE` e as configurações financeiras existentes. Nenhum teto financeiro foi preenchido. Não houve push, merge, implantação ou alteração de produção.

**Próxima dependência para fechar o piloto.** Expor no checkout um baseline reproduzível, vinculá-lo ao experimento e ao plano de medição antes da decisão, publicar a versão completa para revisão e implementar aprovação/execução transacionais. Depois conectar dashboard, atribuição/exposição, encerramento, pausa e métricas por estratégia. RI-02, RI-06, RI-09 a RI-13 conservam as pendências do plano principal.
