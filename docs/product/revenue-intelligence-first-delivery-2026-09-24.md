# Revenue Intelligence: primeira entrega de implementação

Implementação local em `feat/revenue-intelligence-weekly`, baseada em `8a34ef7`. Checkout isolado em `C:\Users\Admin\Desktop\AACP-revenue-intelligence`; as alterações preexistentes do checkout `AACP` foram preservadas. Não houve push, implantação, chamadas pagas ou alteração de lojas reais.

Esta entrega inicia RI-01, RI-04 e RI-05 do [plano técnico](revenue-intelligence-implementation-plan-2026-09-24.md). Não encerra o plano inteiro nem comprova ganho comercial.

## Comportamento implementado

- Medição por coorte de sessões em intervalo semiaberto, com janela de conversão de 24 horas por padrão, versão da definição, instante de observação, sessões maduras e pendentes. Compras são vinculadas à sessão e à loja; uma sessão conta como uma conversão mesmo com vários pedidos. Receita e quantidade de pedidos ficam separadas.
- Eventos repetidos não multiplicam etapas. Uma falha seguida de pagamento dentro da janela não vira abandono. O indicador de não conversão usa sessões maduras sem compra; objeções não são apresentadas como causalidade comprovada.
- Classificação de comprador recorrente considera compra anterior à entrada da sessão. Moedas diferentes bloqueiam a utilização da observação pelo gerador. Custos de IA e contribuição ainda indisponíveis são marcados na proveniência, sem alegar lucro.
- Agenda persistida, sete grupos iniciais, paginação de todas as lojas elegíveis e janela das 03h às 06h no fuso da loja. Padrão `America/Sao_Paulo`. Próximo vencimento nunca antes de sete dias completos da conclusão, na próxima janela noturna; pode cair no oitavo dia se a conclusão ocorreu depois das 03h.
- Ciclo único por loja, retomada após falha de enqueue, lease com token crescente, limite de tentativas e checkpoint da observação. Resposta válida do gerador é reutilizada, e o ID da sugestão é estável por ciclo. Worker antigo não pode publicar após perder seu lease.
- Botão manual respeita calendário e ciclo existente. Falha não conta como análise semanal bem-sucedida. Lojas migradas não retornam silenciosamente ao gerador diário quando a flag nova é desligada. Habilitar o fluxo novo pausa o scheduler legado; essa transição precisa entrar no procedimento de implantação.
- Reservas financeiras persistidas antes do envio, limites diário/mensal/do ciclo, limite de chamadas por ciclo e reserva diária para revisões dentro do teto global do motor. Há limites de concorrência, requisições e tokens por provedor/modelo.
- Cada fallback recebe outra reserva. Timeout e consumo desconhecido mantêm o compromisso, inclusive após virar dia ou mês. Valores em micros e moeda explícita; custo conhecido é registrado em `AiUsageEvent`. Custo acima da reserva bloqueia nova admissão.
- Notificação persistida por ciclo e painel com próxima análise, estado, detalhes do resultado e acesso à revisão existente. A aprovação permanece manual. Corrigida a apresentação de taxas como porcentagem; aprovação não é chamada de teste ativo.

O contrato de `AiUsageEvent` e `AiPriceVersion` foi trazido do trabalho local ainda não integrado à base da branch. Não foram copiados os fluxos de voz/administração desse trabalho. A integração posterior deve reconciliar as migrations para não tentar criar as mesmas tabelas duas vezes.

## Configuração e limites desta etapa

As flags estão desativadas no `.env.example`. A geração exige Redis, plano com Revenue Manager, motor habilitado pelo lojista, inclusão em `REVENUE_WEEKLY_MERCHANT_IDS`, orçamento, limite de análises, limites de tokens/chamadas e capacidade do provedor. A lista de lojas aceita IDs separados por vírgula ou `*` explícito. Não existe valor financeiro padrão que habilite gasto por engano.

As variáveis estão documentadas em `apps/api/.env.example`, com prefixos `REVENUE_WEEKLY_`, `REVENUE_ANALYSIS_` e `REVENUE_AI_`. Os limites de dinheiro são do motor de receita, não de todas as chamadas de voz/chat do produto. Períodos financeiros são UTC; janelas de análise seguem o fuso da loja.

Uma tarifa efetiva em `AiPriceVersion` precisa corresponder exatamente a provedor/modelo, moeda, `chat`, `text_generation` e `source = revenue-upper-bound-v1`. O operador deve validar que suas taxas cobrem o custo máximo do pedido. A admissão limita texto em bytes UTF-8 com folga de envelope; a liberação exige validar esse limite conservador para os modelos concretos. O ledger registra estimativa por tokens, não confirmação de fatura. Não há preços reais semeados nesta entrega.

OpenAI recebe `max_completion_tokens`; esse limite inclui tokens visíveis e de raciocínio conforme a [documentação oficial](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). O contrato existente do outro provedor preserva `max_tokens`. Modelos configurados não foram substituídos. Nenhum provedor real foi chamado.

## Validação executada

| Verificação | Resultado e fronteira |
| --- | --- |
| Regressão do Revenue Manager | 221 testes passaram, sem falhas ou skips; inclui fallback controlado, reserva antes do envio, bloqueio sem orçamento e cache da resposta |
| PostgreSQL + Redis dedicados | 11 testes passaram, sem skips; coortes reais, 700 lojas artificiais durante sete noites, concorrência, restart, enqueue interrompido, worker antigo, moeda/preço/capacidade, virada de mês, teto diário, elegibilidade negativa e ciclo completo sem dados |
| Navegador Chromium | Desktop 1440px e celular 390px: abrir detalhes, aprovação pelo fluxo existente, reload, notificação, teclado e dados insuficientes; respostas de API simuladas |
| TypeScript da API | Passou com client Prisma isolado e shared-types resolvido para o código desta branch; não alterou o client compartilhado do outro checkout |
| TypeScript do dashboard | Passou |
| Prisma | Schema gerado e aplicado via `db push` ao banco descartável usado pelos 11 testes |
| Migration SQL aditiva | Gerada por diff entre schema da base e schema final; ensaio separado de aplicação interrompido por indisponibilidade do Docker. Ainda deve ser repetido antes de implantação |
| Produção / ganho comercial | Não executados |

Evidências locais em `.audit/revenue-weekly/`: `regression.log`, `integration.log`, `browser.log`, `typecheck-final.log`, `dashboard-typecheck-final.log`, capturas `weekly-1440.png` e `weekly-390.png`. Client isolado e configuração temporária em `apps/api/.audit/revenue-weekly/`.

O cenário de 700 lojas substitui a verificação de elegibilidade por uma função controlada; um cenário separado comprova bloqueio por participação/plano. Ele mede coordenação, não demanda real da LLM. O navegador usa fixtures e não comprova um pagamento real atribuído ao experimento.

## Reprodução

Executar a suíte de regressão com o loader `apps/api/tests/ready-prod-loader.mjs` e os arquivos `*.spec.ts` do módulo, excluindo `weekly-analysis.integration.spec.ts`. Com client gerado em diretório isolado, apontar `READY_PROD_TEST_PRISMA_CLIENT` para seu `index.js`.

A suíte de integração só escreve quando `REVENUE_TEST_DATABASE_URL` aponta para `127.0.0.1:5557/revenue_weekly`. Ela limpa suas tabelas de fixture; nunca apontar um banco compartilhado para esse nome/porta. Redis de teste: `127.0.0.1:6397`. Aplicar o schema antes de rodar:

```powershell
node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/revenue-manager/infrastructure/weekly-analysis.integration.spec.ts
```

Para o teste visual, iniciar o dashboard local na porta 5186 e executar:

```powershell
node apps/dashboard/scripts/verify-revenue-weekly.mjs
```

## Continuação e critérios antes da ativação

1. Repetir o ensaio da migration SQL quando o Docker voltar. Conciliar a integração paralela de `ai-usage`. Validar a inicialização da aplicação com as flags do piloto, Redis e as tarifas concretas.
2. Concluir RI-02/RI-03: custos/contribuição, proteção comum de margens, maturidade estatística e gate de promoção. O novo fluxo não libera novos tipos de incentivo nesta entrega.
3. Completar operações de RI-04/RI-05: participação de capacidade reservada a lojas novas, janela noturna configurável, conciliação operacional de chamadas incertas, alertas do operador e retomada auditada de ciclos esgotados. Reservas incertas atualmente permanecem conservadoramente abertas e podem bloquear a capacidade.
4. RI-06 a RI-10: planejador estruturado, versões imutáveis, pedido de alternativa em linguagem natural, aprovação/ativação transacional e resultados por estratégia. O painel desta entrega usa a revisão já existente; ainda não há conversa para revisar propostas.
5. RI-11 a RI-13: cupons/descontos inteligentes, biblioteca entre lojas com isolamento e testes locais, recuperação e demais canais. Ainda não implementados.

O primeiro piloto comercial depende desses gates, de orçamento definido e de autorização de implantação. A reversão prevista é por flags, preservando agenda, reservas e histórico. Voltar a um binário antigo que desconheça a propriedade semanal exige manter o gerador legado suspenso por operação; não é um rollback automaticamente seguro.
