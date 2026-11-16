# Assistente do lojista

Conversa persistente por loja, ator e contexto. A primeira integração atende Anúncios com IA: ajuda com fontes, catálogo canônico, rascunhos revisáveis, pagamentos, política de execução e relatórios diários. O ChatDock é reutilizável; esta entrega não o expõe em outras telas.

## Authority and rollout

O modo efetivo começa manual. Uma preferência escrita na conversa não aprova uma proposta nem aceita uma política. Owner/admin é resolvido pelo principal autenticado e pela associação atual à loja.

No fluxo manual atual, a aprovação contém a versão e o digest exatos da proposta. Preparar e publicar são operações distintas. O executor revalida conexão, origem da campanha, produtos, versão e autoridade antes de cada escrita. Campanhas externas permanecem somente para leitura.

A infraestrutura de política automática da base admite somente ações delimitadas por produtos/campanhas, conta, moeda, periodicidade, datas e tetos aceitos. Há reservas atômicas de exposição; resultados desconhecidos continuam comprometendo o teto. Sem prova do controle financeiro remoto, a publicação automática é bloqueada. Revogação impede novos envios e não desfaz uma operação já recebida pela Meta.

**Alteração de produto em planejamento:** o lojista solicitou aprovação administrativa obrigatória para toda campanha nova, preparo completo pelo motor e aviso no painel/WhatsApp da loja. Essa extensão ainda não está implementada aqui. Mantenha `META_ADS_AGENT_AUTOMATION_ENABLED=false` no rollout até incorporar e verificar a nova regra; a política anterior não deve ser ativada para contorná-la. Nenhum aviso de campanha pronta ou entrega de WhatsApp pode ser declarado como concluído por esta base.

Antes de qualquer ativação operacional:

1. Revisar as migrations aditivas `20261114180000_meta_ads_agent` e `20261116103000_merchant_assistant`, incluindo o espelho em `prisma/deploy-migrations`, pelo processo de release. Construir e testar não aplica migrations em produção.
2. Concluir as condições comerciais, OAuth, permissões, armazenamento e piloto de custos descritos no [guia de anúncios](../meta-ads-agent/README.md). Cada loja fornece sua própria autorização; nunca copiar a credencial operacional MCP para tenants.
3. Configurar modelo, governança e versão de preço USD vigente em `ai_price_versions` para o provider/model/channel/component efetivos. A configuração seleciona OpenRouter, OpenAI ou DeepSeek, nessa ordem de credenciais disponíveis. Os nomes e preços devem corresponder ao provedor usado.
4. Ativar somente os flags revisados. Não selecionar modo automático por migração, login, mensagem ou flag de automação do checkout.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MERCHANT_ASSISTANT_ENABLED` | `false` | Admissão/processamento de novos turnos do lojista. |
| `MERCHANT_ASSISTANT_TURN_BUDGET_MICROS` | `50000` | Reserva máxima de IA por turno. |
| `MERCHANT_ASSISTANT_MONTHLY_BUDGET_MICROS` | `2000000` | Teto mensal compartilhado por loja, inclusive análise diária. |
| `META_ADS_AGENT_AUTOMATION_ENABLED` | `false` | Disponibilidade técnica de política/execução automática; não concede autoridade. |
| `META_ADS_AGENT_OBSERVATION_ENABLED` | `false` | Admissão/coleta diária e recuperação. |
| `META_ADS_AGENT_GENERATION_WORKER_ENABLED` | `false` | Processamento dos jobs de imagens já admitidos. |
| `META_ADS_AGENT_REMOTE_WRITES_ENABLED` | `false` | Escrita no provedor, subordinada à autoridade efetiva. |

Os limites de IA usam micros de USD: 1.000.000 equivale a US$ 1. Valores inválidos são rejeitados. Eles não representam verba de mídia, créditos de imagem nem cobrança adicional automática. Geração conserva a franquia e as reservas existentes; compra de extras exige uma contratação expressa.

## Grounded help and account funding

O corpus curado está em `infrastructure/knowledge/meta-ads.pt-BR.ts`, versão inicial `2026-11-16.1`, audiência `merchant` e contexto `meta_ads`. Cobre conexão, pagamentos, franquia, produtos, criativos, aprovação, publicação, métricas e erros. Estado atual de conta/campanha e valores contratuais vêm das ferramentas autorizadas, não do texto estático.

Para alterar uma orientação, revisar as fontes primárias, atualizar versão/data/conteúdo e os testes de recuperação. Retirar versões revogadas de novas recuperações. Referências históricas continuam identificadas; uma fonte indisponível não autoriza inventar seu conteúdo. O endpoint de fonte revalida ator, loja e contexto.

O painel explica que assinatura, créditos de imagem e investimento em mídia são separados. Pré-pago orienta fundos na Meta; pós-pago orienta método de pagamento e pendências; dado ausente fica indisponível. `balance` não é saldo pré-pago disponível.

O destino de pagamentos é validado em HTTPS, host/caminho oficiais e IDs da conta selecionada pelo servidor. O formato observado em 16/11/2026 tem prazo de verificação; atualizar esse marco exige conferir novamente a rota na Meta. Nunca fixar o ID de uma conta de exemplo nem colocar token na URL. Se o destino deixar de ser válido, bloquear o botão e revisar a integração. Clicar, retornar ou verificar novamente não confirma recarga nem compra créditos na Zyon.

## Daily cycle and recovery

O calendário usa o fuso IANA da conta, sem substituição silenciosa por UTC. A cada 30 s, o serviço torna elegível o dia local encerrado; o requisito é admissão em até 60 s enquanto disponível. Coleta/processamento podem levar mais tempo. A identidade lógica inclui loja, conta, dia e fuso; não há um segundo agendador UTC em paralelo.

`since`/`until` do relatório são datas civis da conta. Instantes de elegibilidade/leases são calculados separadamente, inclusive em dias de 23 ou 25 horas e fusos com deslocamento fracionário. A tela não interpreta uma data civil como meia-noite UTC. A avaliação de desempenho usa a janela fechada de 14 dias, sem converter ausência de dados em zero.

Checkpoints/leases no PostgreSQL preservam coleta parcial, análise e ações. A recuperação retoma os itens não concluídos. Receita atribuída, pedidos pagos confirmados, conversas e cobertura de custos são apresentados separadamente. Dados insuficientes não geram declaração de vencedor nem promessa causal de escala.

| Situation | Response |
| --- | --- |
| Envio sem resposta confirmada | Retomar com a mesma chave; não criar outro turno para adivinhar o resultado. |
| IA/imagem/escrita com resultado desconhecido | Conservar reserva/recibo e reconciliar; não repetir chamada paga ou escrita cegamente. |
| Coleta parcial | Manter valores indisponíveis, horário e progresso; recuperar sob novo lease. |
| Troca/revogação de conexão ou política | Bloquear os novos envios e consultar o resultado do que já foi enviado. |
| Bloqueio financeiro confirmado | Resolver na Meta e consultar novamente; não ampliar teto ou assumir crédito. |
| Loja removida | Exclusão em cascata dos novos históricos/execuções diárias; recuperação posterior é negada. |

Logs e respostas guardam correlação, fontes, versões e resultados. Não registrar tokens, segredos, cartão ou o corpo de credenciais. Histórico sem entitlement pode continuar legível; isso não permite novo consumo ou nova escrita.

## Local acceptance

Executar a partir da raiz do monorepo, com Node 22 e as versões do lockfile, Edge instalado e PostgreSQL de teste dedicado em `127.0.0.1:15435`:

```powershell
node apps/dashboard/scripts/run-agentic-cypress.mjs
node apps/dashboard/scripts/run-agentic-cypress.mjs --case ADAS-58
node apps/dashboard/scripts/run-agentic-cypress.mjs --spec cypress/e2e/agentic/campaign.cy.ts
node apps/dashboard/scripts/run-agentic-cypress.mjs --serve
pnpm --dir apps/api exec node tests/run-agentic-tests.mjs
pnpm --dir apps/api exec node --test tests/agentic-assistant-browser-runtime.contract.spec.mjs
pnpm --dir apps/dashboard exec vitest run src/pages/meta-ads-agent src/components/merchant-assistant src/api/endpoints/merchant-assistant.spec.ts src/api/endpoints/meta-ads-agent.spec.ts --maxWorkers=1
pnpm --dir apps/dashboard exec playwright test -c playwright.meta-ads-agent.config.ts e2e/meta-ads-agent.spec.ts
```

O runner recusa portas ocupadas e casos inválidos, exige testes efetivamente aprovados, salva resultados/screenshots em `.specs/features/agentic-dashboard-assistant/cypress-results` e fecha somente os seus processos. `--serve` permite revisão local em `http://127.0.0.1:5179`; o botão de entrada usa uma sessão assinada de teste. Encerrar com Ctrl+C ou com o controle nonce de shutdown; não reutilizar servidor de produção.

A suíte executa página, AuthGuard/JWT, associação à loja, API, governança, medição, repositórios e PostgreSQL reais. Somente transportes externos, catálogo/contrato de teste e falhas controladas são sintéticos. A chave nonce e o banco imutável em loopback são exclusivos do runtime de teste, fora dos imports de produção. O runner não herda credenciais de provedor e remove `ELECTRON_RUN_AS_NODE` no filho. Google Fonts e mídia externos são controlados no Cypress; eventos de teclado nativos usam os dados completos do protocolo Chromium. A suíte Playwright existente é preservada.

Essas provas não validam custo/qualidade comercial de imagens reais, aceite/entrega de uma mensagem WhatsApp, autorização Meta de um lojista, pagamento Stripe live, veiculação real nem ganho de vendas. Push, deploy, migrations remotas, testes pagos e ativação do piloto Athom continuam exigindo autorização operacional própria.
