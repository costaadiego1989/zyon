# Governança de IA no AACP/Zyon

## Entrega

O consumo passa pelo coletor comum antes da chamada paga. Cada chamada recebe
empresa, usuário/papel verificado, equipe, funcionalidade e tarefa quando houver.
O Control volta a ter o backend de custos publicado junto com a interface e ganha
a área **Governança de IA**.

| Frente | Comportamento entregue | Limite explícito |
| --- | --- | --- |
| Acesso | Catálogo de modelos do servidor; política por empresa, papel e origem; revisão imutável e controle de versão concorrente | Sem política publicada, mantém os modelos selecionados pelo servidor. Política vazia bloqueia tudo. |
| MCP | Os cinco tools exigem credencial e autorização da API; indisponibilidade bloqueia execução; busca autenticada verifica `catalog:read` | O servidor MCP permanece stdio; não foi criado um servidor MCP HTTP público. |
| Uso/custos | Chamadas físicas persistidas; equipe/ator/tarefa; CSV; moedas e custos estimados separados de valores reportados | Não reconstrói consumo anterior não observado nem reconcilia automaticamente faturas. |
| Automação | SEO de produto e loja medidos como tarefas, com sucesso/falha/pendência e duração observada | Geração concluída não significa conteúdo publicado ou venda atribuída. |
| Tempo | Referência humana versionada congelada na tarefa; intervenção registrada uma vez; diferença identificada como estimativa | Sem referência e observação, tempo evitado fica indisponível. ROI financeiro depende de custos humanos e resultados reais adicionais. |
| Guardrails/evals | Autorização antes do gasto, isolamento entre empresas, controles comerciais determinísticos existentes, dataset versionado e gates de CI | A avaliação cobre cenários definidos; não constitui garantia de todos os comportamentos futuros. |

## Operação

No Control, **Uso de IA** mostra custos e lançamentos. **Governança de IA** permite
consultar a empresa, atribuir equipe por usuário ou `source:product_seo`, registrar
referência de tempo e salvar a política. Somente administradores da plataforma
alteram configurações. Auditor e operação financeira possuem leitura de IA.
Owner/admin da empresa possuem endpoints próprios, com empresa derivada da sessão.

Novas atribuições valem para próximos eventos. Eventos anteriores preservam a
equipe e a referência originais. Revogar um modelo de voz também bloqueia novos
turnos enviados pela conexão de controle do servidor.

DeepSeek é o provedor de texto em uso. O suporte prioriza DeepSeek quando a chave
está configurada. A credencial OpenAI existente não deve selecionar esse caminho
de texto. A voz continua dependendo da OpenAI e não foi migrada para DeepSeek;
a validação real de voz permanece dependente da conta do provedor.

## APIs

- `/v1/ai-governance`: relatório da própria empresa; `policy`, `team`, `baseline`
  e `tasks/:id/human-time` usam sessão owner/admin.
- `/v1/platform/ai-governance`: relatório agregado; operações por empresa usam
  `:merchantId/policy`, `team`, `baseline` e `tasks/:id/human-time`.
- `/v1/ai-governance/tools/authorize`: credencial de empresa, papel owner/admin
  ou escopo de serviço `configuration:read`.
- `/v1/ai-governance/tools/catalog`: também exige `catalog:read` para serviço.
- `/v1/platform/ai-costs`, `/events` e `/export`: custos observados, com filtros
  adicionais `teamId` e `actorId` e atribuição no CSV.

Datas de relatório são instantes ISO, início inclusivo e fim exclusivo. A interface
transforma dias de São Paulo nesse intervalo. Valores monetários usam inteiros em
micros; moedas diferentes não são somadas nem convertidas implicitamente.

Métricas Prometheus: `ai_policy_decisions_total`, `ai_automation_tasks_total` e
`ai_automation_duration_seconds`. Os labels são limitados e não contêm empresas,
usuários, prompts ou respostas.

## Validação e publicação

As duas migrations de governança/ator de voz são aditivas e estão espelhadas em
`prisma/migrations` e `prisma/deploy-migrations`. O coletor reaproveita a migration
de custos de 18/10 já aplicada nos bancos publicados. Não há reescrita de valores
financeiros históricos.

```powershell
$env:AI_GOVERNANCE_TEST_DATABASE_URL='postgresql://test:test@127.0.0.1:5432/support_test_governance'
pnpm --filter @zyon/api test:ai-governance
pnpm --filter @zyon/api eval:ai-governance
pnpm --filter @zyon/aacp-mcp-server test
pnpm --filter @zyon/control build
pnpm --filter @zyon/api build
```

O teste de integração exige banco local isolado e falha se não estiver configurado.
O dataset `evals/governance-v1.json` possui 16 casos determinísticos e seis cenários
de agente real: grounding, dados pessoais, instruções indiretas, URL externa e
desconto sem autorização. O gate exige todos os casos. O teste real usa DeepSeek,
ferramentas sintéticas e limite de chamadas; não grava carrinhos nem envia mensagens
a compradores. Relatórios guardam versão/hash, modelo, tokens, latência e resultado,
sem conteúdo ou credenciais.

Evidências locais ficam em `.audit/ai-governance-20261027`, fora do Git. A verificação
de navegador usa NestJS, PostgreSQL e Edge reais para leitura, atribuição de equipe,
negação ao auditor e responsividade. A publicação deve promover a mesma revisão
da API de homologação para produção e verificar código servido, migrations,
rotas autenticadas e captura de uma chamada DeepSeek.

O typecheck completo herdou erros em fixtures antigas de checkout/cupons/frete;
o build de produção e os testes específicos desta entrega são verificados
separadamente. A árvore de trabalho principal do usuário foi preservada.

## Publicação verificada em 28/10/2026

A revisão da aplicação é `227a03d4b740ade4c611e7b909febb29a1c44dbf`.
Produção: API `ba379dde-0264-411c-a1cf-4a53c898b82c` e Control
`dpl_7bY5B1UwduXLrCFcz1Cwuf5Hteub`, em
`https://control.zyon-payments.com.br`. Homologação verificada:
API `85917739-99e2-4fd8-9cbd-9889d0d447eb` e Control
`dpl_HfxHFA3N6fHR6165feCVNVqs5MSK`.

Os dois ambientes passaram em 19 verificações publicadas: geração de SEO pelo
endpoint autenticado, consumo DeepSeek com usuário/equipe/tarefa, referência
congelada, tempo humano, custos/CSV, MCP autenticado, negação entre empresas,
suporte DeepSeek, métricas protegidas e bloqueio antes da chamada paga.
O navegador Edge confirmou o bundle publicado, a gravação de equipe pela API
real e as telas desktop/mobile, sem erros ou transbordamento horizontal.
As empresas e os operadores sintéticos foram removidos depois dos testes.

Os 3.973 arquivos conferidos nas duas APIs possuem bytes idênticos entre si.
Em relação ao arquivo gerado pelo Git, a única diferença textual é LF/CRLF
aplicada pelo checkout do provedor; não houve diferença de conteúdo.

### Origem do Railway

Uma alteração de configuração da homologação reproduziu a regressão: o Railway
reconstruiu a origem antiga, fixada em `c27160dfd329aa5a09e313b212aa30d011b430b7`,
e removeu novamente os módulos de governança. A origem do serviço **api** foi
corrigida nos dois ambientes para `feat/ai-governance-20261027`, fixada na revisão
homologada `227a03d4`. Upload avulso pelo CLI não atualiza essa origem.

A próxima publicação deve homologar o código e atualizar explicitamente o
`commitSha` da origem. Commits somente de documentação ou ferramentas de
verificação não alteram a revisão da aplicação publicada. Outros serviços não
tiveram sua origem alterada.

Os campos `DEEPSEEK_MODEL` e `DEEPSEEK_BASE_URL` da homologação foram preenchidos
com `deepseek-chat` e `https://api.deepseek.com/v1`, como em produção. Nenhuma chave
de provedor foi substituída. Os custos capturados continuam identificados como
estimativas; a tabela de tarifas Flash foi reconferida na
[documentação oficial](https://api-docs.deepseek.com/quick_start/pricing/).

### Avaliação diária ativa

O workflow `ai-governance-production.yml` foi instalado na branch padrão real
do repositório, `feat/checkout-journey-both-channels`, sem modificar seus arquivos
de aplicação. Ele executa diariamente às 06:17 UTC, usando explicitamente a
revisão publicada da API e somente DeepSeek. A credencial está no secret
`ZYON_AI_EVAL_DEEPSEEK_API_KEY`; não aparece nos relatórios.

A [primeira execução](https://github.com/costaadiego1989/zyon/actions/runs/40724116341)
passou com 16 casos de política e seis cenários de agente real. Os artefatos
guardam versão/hash, tokens, latência e resultado. Ao atualizar a revisão publicada,
atualize também o `ref` e `AI_RELEASE_REVISION` deste workflow. O workflow está
presente também em `master` e na branch da entrega; o agendamento ativo do GitHub
usa sua branch padrão.
