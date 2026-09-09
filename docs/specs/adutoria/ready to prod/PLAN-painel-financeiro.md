# Painel financeiro do merchant

Status: primeira entrega implementada. A tela de Financeiro e os endpoints autenticados estão prontos para validação de dados e publicação.

## Objetivo e escopo inicial

Responder quanto a loja vendeu, quanto foi confirmado em pagamentos, o que foi devolvido e quais pedidos explicam cada valor. Exibir valores em reais e separar vendas, pagamentos e repasses. Um pagamento aprovado não comprova que o dinheiro já está disponível para saque.

Primeira versão: página **Financeiro**, no grupo Loja, com as abas **Visão geral**, **Transações** e **Relatórios**. Reutilizar título, filtros de período, seletor de datas, tabela, paginação, estados vazios e modal lateral de Pedidos e Envios. Preservar temas claro/escuro e o sistema de fontes do dashboard.

## Experiência proposta

- Cabeçalho: Financeiro, descrição curta e botão Exportar relatório.
- Filtros comuns às abas: hoje, 7/15/30 dias e intervalo personalizado; comparação com intervalo anterior de mesma duração. Início inclusivo e término exclusivo no fuso da loja, com datas convertidas no servidor.
- Visão geral: vendas confirmadas, pedidos pagos, ticket médio e reembolsos confirmados. Abaixo, evolução diária de vendas e reembolsos, distribuição por meio de pagamento e lista de pendências que levam às transações correspondentes.
- Transações: data, pedido, meio de pagamento, valor, reembolso e situação. Pesquisa por pedido/referência, filtros por situação e meio, paginação no servidor. Modal lateral com composição do valor e histórico do pagamento; dados pessoais mínimos e mascarados quando apropriado.
- Relatórios: resumo diário, pagamentos e reembolsos. CSV na primeira versão, com período/fuso/moeda e horário de geração identificados. Resumo em PDF pode vir depois, quando os totais estiverem conciliados.

Cada indicador deve abrir a lista que explica seu total. Mostrar a atualização dos dados e diferenciar “nenhuma movimentação” de “dados indisponíveis”. Não apresentar saldo, lucro, taxas estimadas ou valor líquido a receber como valores confirmados.

## Dados inspecionados e decisões necessárias

| Fonte existente | Uso possível | Limite a resolver |
| --- | --- | --- |
| `CompletedOrder` | Pedidos concluídos, valor em BRL, data e itens da compra | Definir inclusão de cancelamentos e reconciliar com pagamento confirmado; evitar contar um pedido mais de uma vez |
| `PaymentIntent` | Método, situação, valor aprovado, referência e histórico | Há campos internos explicitamente em centavos; converter na camada de leitura e devolver contrato monetário inequívoco em BRL |
| `ReturnRefund` | Reembolsos associados às devoluções | Inspecionar o ciclo de estados e contabilizar somente confirmação do provedor; conciliar reembolsos parciais |
| `StoreMetricDaily` e analytics existentes | Evolução diária e comparação | Agregados podem atrasar; validar fuso e conciliação antes de usá-los como fonte financeira |
| Liquidações do marketplace | Dados específicos do marketplace | Não representam automaticamente o saldo do merchant em Stripe/Asaas ou em outras integrações |

O schema consultado não demonstrou um razão unificado de recebíveis e repasses de todos os provedores. **Saldo disponível**, **a receber**, taxas efetivas e previsão de repasse ficam para uma segunda versão com integrações e conciliação próprias. A primeira entrega pode ser útil sem inventar esses números.

## Contratos e segurança

O controller financeiro delega filtros e agregações ao caso de uso de leitura do módulo Dashboard, injetado pela fronteira de persistência já adotada no módulo. Todo acesso e exportação exige autenticação, papéis OWNER ou ADMIN e o escopo do merchant da sessão, com testes de isolamento entre lojas.

Rotas implementadas: `GET /dashboard/finance/summary`, `GET /dashboard/finance/transactions` e `GET /dashboard/finance/export.csv`. O período é compartilhado por métricas, tabela e relatório; tipo, método e busca pertencem somente à tabela. Todas as rotas exigem sessão de OWNER ou ADMIN e usam o merchant da sessão, nunca um ID enviado pelo navegador. O intervalo aceita no máximo 366 dias, a tabela é paginada no servidor e a exportação consulta todo o período, nunca somente a página visível.

Valores do contrato em BRL decimal, sem inferência pela magnitude; cálculos no servidor com aritmética decimal. A definição de cada métrica deve especificar fonte, estado elegível, data de competência e tratamento de descontos, frete, tarifa da plataforma, cancelamento e reembolso. Não somar moedas diferentes.

Exportações grandes serão processadas em job, com autorização na geração e no download, arquivo privado, URL temporária e expiração. CSV deve escapar campos corretamente e neutralizar fórmulas originadas de dados fornecidos por usuários. Registrar quem gerou e qual período foi exportado, sem registrar dados de cartão.

## Etapas e critérios de aceite

1. Fechado: a primeira versão usa apenas `CompletedOrder` com status não cancelado e `ReturnRefund` com status `COMPLETED`. Vendas importadas de ERP e saldo de integrações externas permanecem fora do relatório até haver conciliação.
2. Fechado: API, paginação, isolamento do merchant, exportação CSV e a divulgação da lacuna de repasses foram implementados.
3. Fechado no código: a página usa cabeçalho, filtros, abas, tabela, paginação, estados de carregamento, falha e vazio do dashboard. A validação visual em desktop e temas acompanha a checagem de build.
4. Pendente de evidência de produção: executar pedidos aprovados, falhos e reembolsos parcial e total e conferir que cards, tabela e CSV fecham no mesmo valor, inclusive em limites de dia e mês.
5. Recebíveis, taxas e repasses constituem a próxima entrega e não bloqueiam a visão de vendas confirmadas.

Sugestão inicial: começar com pagamentos da própria loja processados pela Zyon e CSV, mantendo o menu preparado para evoluir para recebíveis e conciliação.
