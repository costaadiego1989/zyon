# Assistente do lojista

O chat e a análise diária usam `MERCHANT_ASSISTANT_PROVIDER` (`deepseek`, `openai` ou `openrouter`) e, opcionalmente, `MERCHANT_ASSISTANT_MODEL`. A seleção usa somente a chave e o endereço do provedor escolhido; uma chave ausente não autoriza troca automática. Sem seleção explícita, permanece a prioridade OpenRouter, OpenAI e DeepSeek. DeepSeek usa `deepseek-flash` como padrão atual. A tarifa vigente e a governança continuam obrigatórias.

As artes usam uma integração separada: `META_ADS_IMAGE_MODEL` e `META_ADS_IMAGE_API_KEY`. Uma chave DeepSeek válida para conversar não habilita geração de imagens. A configuração dos anúncios não modifica as chaves globais usadas pelos demais módulos.

Conversa persistente por loja, ator e contexto. A primeira integração atende Anúncios com IA: ajuda com fontes, catálogo canônico, rascunhos revisáveis, pagamentos, política de execução e relatórios diários. O ChatDock é reutilizável; esta entrega não o expõe em outras telas.

## Authority and rollout

O modo efetivo começa manual. Uma preferência escrita na conversa não aprova uma proposta nem aceita uma política. Owner/admin é resolvido pelo principal autenticado e pela associação atual à loja.

Toda campanha nova exige uma aprovação administrativa da versão e do digest exatos. O motor prepara textos e criativos internamente; antes do aceite não cria objetos externos de campanha. O botão **Aprovar e publicar** registra um recibo durável e executa o preparo pausado seguido de publicação, sem segundo aceite. O executor revalida conexão, origem da campanha, produtos, versão e autoridade antes de cada escrita. Campanhas externas permanecem somente para leitura.

A infraestrutura de política automática da base admite somente ações delimitadas por produtos/campanhas, conta, moeda, periodicidade, datas e tetos aceitos. Há reservas atômicas de exposição; resultados desconhecidos continuam comprometendo o teto. Sem prova do controle financeiro remoto, a publicação automática é bloqueada. Revogação impede novos envios e não desfaz uma operação já recebida pela Meta.

Uma política automática aceita pode autorizar otimizações dentro dos limites, após o lançamento aprovado; nunca substitui o primeiro aceite de uma campanha nova. O chat completa somente os campos ausentes ou ambíguos, usa o catálogo atual e preserva o mesmo planejamento nas correções. A revisão mostra os criativos em slides, textos, produtos, destino, prioridade, público, datas e teto de gasto.

Antes de qualquer ativação operacional:

1. Revisar as migrations aditivas `20261114180000_meta_ads_agent`, `20261116103000_merchant_assistant` e `20261117010000_campaign_approval`, incluindo os espelhos em `prisma/deploy-migrations`, pelo processo de release. A última cria preparação durável, avisos e contato administrativo por loja, com exclusão em cascata. Construir e testar não aplica migrations em produção.
2. Concluir as condições comerciais, OAuth, permissões, armazenamento e piloto de custos descritos no [guia de anúncios](../meta-ads-agent/README.md). Cada loja fornece sua própria autorização; nunca copiar a credencial operacional MCP para tenants.
3. Configurar modelo, governança e versão de preço USD vigente em `ai_price_versions` para o provider/model/channel/component efetivos. A configuração seleciona OpenRouter, OpenAI ou DeepSeek, nessa ordem de credenciais disponíveis. Os nomes e preços devem corresponder ao provedor usado.
4. Ativar somente os flags revisados. Não selecionar modo automático por migração, login, mensagem ou flag de automação do checkout.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MERCHANT_ASSISTANT_ENABLED` | `false` | Admissão/processamento de novos turnos do lojista. |
| `MERCHANT_ASSISTANT_TURN_BUDGET_MICROS` | `50000` | Reserva máxima de IA por turno. |
| `MERCHANT_ASSISTANT_MONTHLY_BUDGET_MICROS` | `2000000` | Teto mensal compartilhado por loja, inclusive análise diária. |
| `META_ADS_AGENT_AUTOMATION_ENABLED` | `false` | Disponibilidade técnica de política/execução automática; não concede autoridade. |
| `META_ADS_AGENT_CAMPAIGN_APPROVAL_ENABLED` | `false` | Preparação interna durável e lançamento após um aceite administrativo exato. |
| `META_ADS_AGENT_CAMPAIGN_NOTICES_ENABLED` | `false` | Envio do aviso pelo WhatsApp da própria loja; não substitui o inbox. |
| `META_ADS_CAMPAIGN_REVIEW_URL` | URL do dashboard | Base pública HTTPS dos links de revisão, sem credenciais, query ou fragmento. Não altera a origem confiável dos cookies. |
| `META_ADS_AGENT_OBSERVATION_ENABLED` | `false` | Admissão/coleta diária e recuperação. |
| `META_ADS_AGENT_GENERATION_WORKER_ENABLED` | `false` | Processamento dos jobs de imagens já admitidos. |
| `META_ADS_AGENT_REMOTE_WRITES_ENABLED` | `false` | Escrita no provedor, subordinada à autoridade efetiva. |

Os limites de IA usam micros de USD: 1.000.000 equivale a US$ 1. Valores inválidos são rejeitados. Eles não representam verba de mídia, créditos de imagem nem cobrança adicional automática. Geração conserva a franquia e as reservas existentes; compra de extras exige uma contratação expressa.

## Grounded help and account funding

O corpus curado está em `infrastructure/knowledge/meta-ads.pt-BR.ts`, revisão `2026-11-16.2`, audiência `merchant` e contexto `meta_ads`. Cobre conexão, pagamentos, franquia, produtos, criativos, aprovação, publicação, métricas e erros. Estado atual de conta/campanha e valores contratuais vêm das ferramentas autorizadas, não do texto estático.

Para alterar uma orientação, revisar as fontes primárias, atualizar versão/data/conteúdo e os testes de recuperação. Retirar versões revogadas de novas recuperações. Referências históricas continuam identificadas; uma fonte indisponível não autoriza inventar seu conteúdo. O endpoint de fonte revalida ator, loja e contexto. Sem citação válida, a resposta livre do modelo não é tratada como evidência: perguntas sobre campos ausentes e fatos do catálogo são renderizados pelo contexto do servidor. Uma pergunta terminada em interrogação ou uma consulta de outro assunto não libera instruções financeiras inventadas.

O painel explica que assinatura, créditos de imagem e investimento em mídia são separados. Pré-pago orienta fundos na Meta; pós-pago orienta método de pagamento e pendências; dado ausente fica indisponível. `balance` não é saldo pré-pago disponível.

O destino de pagamentos é validado em HTTPS, host/caminho oficiais e IDs da conta selecionada pelo servidor. O formato observado em 16/11/2026 tem prazo de verificação; atualizar esse marco exige conferir novamente a rota na Meta. Nunca fixar o ID de uma conta de exemplo nem colocar token na URL. Se o destino deixar de ser válido, bloquear o botão e revisar a integração. Clicar, retornar ou verificar novamente não confirma recarga nem compra créditos na Zyon.

## Administrative notices

Em Configurações, informe o WhatsApp do administrativo com DDI/DDD e autorize o recebimento. O destinatário precisa ser diferente do remetente da loja; trocar o número exige novo consentimento. Revogar não concede permissão ao número que ainda estava sendo editado.

Cada versão revisável gera um aviso lógico no inbox existente. Outro owner/admin atual da mesma loja pode abri-lo sem acessar a conversa privada de quem pediu a campanha. O link é somente de leitura; não aprova nem publica. Alteração de versão invalida o aceite antigo e encerra o aviso anterior.

O envio exige a conexão Meta Cloud da própria loja e um template `campaign_ready` aprovado para o WABA atual, com nome, versão e link de revisão mapeados. Consultar e sincronizar sua aprovação pelo processo existente de templates; não presumir aprovação por existir no catálogo. Não há fallback para credencial global ou WhatsApp da Zyon. Falta de contato, conexão ou template mantém o aviso no painel e mostra o próximo passo.

A admissão do aviso preserva seu destinatário e a versão do consentimento; conexão e revisão do template são vinculadas antes do envio. Trocar um contato já admitido não redireciona o aviso antigo. Se a admissão não tinha destinatário, salvar explicitamente um contato consentido pode endereçar esse aviso ainda não enviado; o worker não escolhe sozinho um contato posterior. Resposta HTTP aceita significa **aceito, entrega ainda não confirmada**; apenas recibos vinculados ao remetente/loja podem confirmar entrega ou falha. Um recibo atrasado não rebaixa uma entrega já confirmada. Timeout mantém identidade e estado desconhecido; reiniciar ou trocar contato não repete a mensagem cegamente.

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
node apps/dashboard/scripts/run-agentic-cypress.mjs --case ACAP-27
node apps/dashboard/scripts/run-agentic-cypress.mjs --spec cypress/e2e/agentic/campaign.cy.ts
node apps/dashboard/scripts/run-agentic-cypress.mjs --serve
pnpm --dir apps/api exec node tests/run-agentic-tests.mjs
pnpm --dir apps/api exec node --test tests/agentic-assistant-browser-runtime.contract.spec.mjs
pnpm --dir apps/dashboard exec vitest run src/pages/meta-ads-agent src/components/merchant-assistant src/api/endpoints/merchant-assistant.spec.ts src/api/endpoints/meta-ads-agent.spec.ts --maxWorkers=1
pnpm --dir apps/dashboard exec playwright test -c playwright.meta-ads-agent.config.ts e2e/meta-ads-agent.spec.ts
```

O runner recusa portas ocupadas e casos inválidos, exige testes efetivamente aprovados, salva resultados/screenshots em `.specs/features/agentic-dashboard-assistant/cypress-results` e fecha somente os seus processos. `--serve` permite revisão local em `http://127.0.0.1:5179`; o botão de entrada usa uma sessão assinada de teste. Encerrar com Ctrl+C ou com o controle nonce de shutdown; não reutilizar servidor de produção.

A suíte executa página, AuthGuard/JWT, associação à loja, API, governança, medição, repositórios e PostgreSQL reais. Somente transportes externos, catálogo/contrato de teste e falhas controladas são sintéticos. A chave nonce e o banco imutável em loopback são exclusivos do runtime de teste, fora dos imports de produção. O runner não herda credenciais de provedor e remove `ELECTRON_RUN_AS_NODE` no filho. Google Fonts e mídia externos são controlados no Cypress; eventos de teclado nativos usam os dados completos do protocolo Chromium. A suíte Playwright existente é preservada.

O roteiro de fechamento local percorre briefing completo e guiado, correção, preparo sem objetos externos, revisão com setas em 1440/390/320, aceite único, consulta da publicação, avisos, outro administrador, isolamento e recuperação. A suíte mantém cenários de financiamento, política/revogação e métricas com KPIs/gráficos, além do Playwright da vitrine. Depois do último commit, executar as provas em HEAD limpo, revisão independente com mutações e o gate de verificação; os resultados ficam em `.specs/features/agentic-campaign-approval` e `agentic-dashboard-assistant`.

Essas provas não validam custo/qualidade comercial de imagens reais, aceite/entrega de uma mensagem WhatsApp real, autorização Meta de um lojista, pagamento Stripe live, veiculação real nem ganho de vendas. Push, deploy, migrations remotas, testes pagos e ativação do piloto Athom continuam exigindo autorização operacional própria.
