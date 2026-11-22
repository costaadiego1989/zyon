# Prospecção de empresas no Control

O administrador de plataforma abre **Prospecção** no menu do Control. Visão geral mostra o estado do diretório, do canal, da base comercial, dos workers e dos limites. O acesso usa a sessão de operador e as permissões `platform:prospecting:*` registradas no módulo de controle. Cada operação exige sua permissão. A busca combina o diretório oficial e o CRM da plataforma pelo CNPJ de 14 caracteres, inclusive alfanumérico.

## Preparar a aplicação

1. Faça backup consistente do PostgreSQL, incluindo os esquemas do CRM e `company_directory`, da base Neo4j e das versões das chaves usadas nos registros. Registre a revisão da API/Control e os identificadores dos snapshots e publicações ativos. Teste a restauração isolada antes de autorizar escrita.
2. Compile com `pnpm --filter @zyon/api build`. O build gera os dois clientes Prisma. Confira se as migrations de CRM em `apps/api/prisma/migrations` e seus espelhos correspondentes em `apps/api/prisma/deploy-migrations` são idênticos, inclusive atribuição financeira, uso de modelo e dia de reserva. Preserve o histórico adotado pelo ambiente. O predeploy da API usa `node scripts/predeploy-migrations.mjs` a partir de `apps/api`.
3. Aplique separadamente o histórico do diretório com `pnpm --dir apps/api exec prisma migrate deploy --config prisma.company-directory.config.ts`, com `PROSPECTING_DIRECTORY_DATABASE_URL` no mesmo PostgreSQL físico, banco e porta do CRM e com `?schema=company_directory` para isolar seu histórico. Verifique ambos com `prisma migrate status` usando a respectiva configuração e o histórico efetivamente adotado. Conflito de checksum requer reconciliação do histórico e backup anterior.
4. Injete os segredos no ambiente do processo. Reserve funções de leitura e de projeção distintas no Neo4j. Preserve o Redis e os mecanismos de sessão da instalação da API. Configure `VITE_PLATFORM_API_BASE_URL` no Control para a URL da API com o prefixo `/v1`. Reinicie a aplicação para aplicar alterações de configuração.

As variáveis da tabela têm prefixo `PROSPECTING_`. As seis flags aceitam `true` ou `false` e começam desligadas.

| Variáveis | Operação |
| --- | --- |
| `ENABLED`, `RUN_WORKERS` | A primeira registra o módulo. A segunda inicia o ciclo durável a cada cinco segundos, com parada e fechamento dos clientes pelo lifecycle do Nest. A preparação de audiência independe de ingestão nacional e envio. Com workers parados, acompanhe o acúmulo de inbox/outbox. |
| `DATABASE_URL`, `DIRECTORY_DATABASE_URL`, `DIRECTORY_POOL_SIZE` | O CRM usa o mesmo banco lógico que o `DATABASE_URL` principal. O diretório mantém pool próprio, inicialmente duas conexões. |
| `NEO4J_READ_URI`, `NEO4J_READ_USER`, `NEO4J_READ_PASSWORD`, `NEO4J_INGEST_URI`, `NEO4J_INGEST_USER`, `NEO4J_INGEST_PASSWORD` | A credencial de consulta lê as publicações. A de projeção grava fatos no namespace comercial. Verifique conectividade e privilégios com cada credencial. |
| `CURSOR_HMAC_KEY`, `SUPPRESSION_HMAC_KEY`, `SENDER_ENCRYPTION_KEY` | Chaves distintas de 64 caracteres hexadecimais. Mantenha a chave de criptografia enquanto houver credenciais cifradas com ela. Na rotação da supressão, aumente `SUPPRESSION_KEY_VERSION` e forneça `SUPPRESSION_PREVIOUS_KEYS` como objeto JSON que mapeia versões anteriores às respectivas chaves. Valide uma supressão antiga antes de liberar o canal. Uma versão ausente bloqueia a elegibilidade. |
| `PROPOSAL_SECRET`, `PROPOSAL_TTL_SECONDS`, `DASHBOARD_ORIGIN`, `PUBLIC_SITE_URL` | Use segredo dedicado forte com pelo menos 32 caracteres e TTL explícito positivo. A chave de assinatura da proposta deve diferir da chave de sessão do Control (`PLATFORM_CONTROL_JWT_SECRET`), da chave dos usuários (`JWT_SECRET`) e das demais chaves de prospecção. O dashboard HTTPS fornece o destino canônico de cadastro e exige vínculo autenticado com a conta atual. Configure o endereço público HTTPS exato que a IA pode fornecer quando o contato pedir o site. A troca do segredo invalida links pendentes. |
| `META_SEND_ENABLED`, `META_APP_ID`, `META_CONFIG_ID`, `META_BUSINESS_ID`, `META_PHONE_NUMBER_ID`, `META_APP_SECRET`, `META_REGISTRATION_PIN`, `META_WEBHOOK_VERIFY_TOKEN` | O canal próprio Zyon usa Embedded Signup v5 e credencial cifrada. Confirme WABA e número autorizados, subscrição, registro, template de marketing aprovado com texto revisado e saúde do portfólio. Configure a verificação e a assinatura do corpo original no ingresso `/v1/webhooks/whatsapp/meta-platform`. |
| `META_TEMPLATE_COST_CENTS`, `META_REPLY_COST_CENTS`, `META_QUOTE_VALID_UNTIL` | Forneça cotação vigente em centavos de real e data de expiração com fuso. Cada campanha exige seu próprio orçamento e limite por dia. O dia contábil da reserva é UTC. Observe fuso e janela local de envio separadamente. |
| `LLM_REAL_ENABLED`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_INPUT_MICROCENTS_PER_TOKEN`, `LLM_OUTPUT_MICROCENTS_PER_TOKEN`, `LLM_MAX_COST_CENTS`, `LLM_TIMEOUT_MS` | Configure preços unitários positivos, teto e prazo antes de habilitar consumo. Com workers ativos e modelo pago desligado, a IA encaminha ao humano com motivo registrado. |
| `INGESTION_ENABLED`, `PAID_INGESTION_ENABLED` | A ingestão oficial é separada do canal e do modelo. Manter ingestão paga desligada preserva o perfil oficial gratuito. |

## Diretório e recuperação da importação

Selecione a competência mensal descoberta no manifesto oficial da Receita. Confira a composição de empresas, estabelecimentos, Simples, CNAEs, municípios e naturezas. Dimensões e empresas precedem os estabelecimentos. A API cria um job e o worker processa arquivos fora da requisição. Registre volume, espaço temporário, duração e impacto no banco antes de ampliar o piloto.

No ambiente de ensaio, comece com `IMPORT_CONCURRENCY=1` e o pool dedicado pequeno. Todas as opções de importação também usam o prefixo acima. Ajuste `IMPORT_BATCH_SIZE`, `IMPORT_MAX_FILE_BYTES`, `IMPORT_MAX_EXPANDED_BYTES`, `IMPORT_MAX_ENTRIES`, `IMPORT_MAX_LINE_BYTES`, `IMPORT_MAX_MEMORY_BYTES` e `IMPORT_MIN_FREE_DISK_BYTES` à capacidade reservada. O limite de memória controla o payload acumulado estimado do lote. Meça RSS do processo, I/O e latência do CRM no piloto. A admissibilidade de um registro individual continua sujeita aos limites da leitura e do lote.

Uma interrupção preserva o snapshot publicado e os checkpoints confirmados do candidato. Consulte estado por recurso, erro, hash, linhas confirmadas e rejeitadas. Corrija espaço/perfil e retome o mesmo job e manifesto. O worker valida o hash antes de reutilizar o limite de linhas gravado. Alterar o tamanho de lote altera somente os próximos lotes. Uma fonte alterada exige nova identificação e validação. Publique somente após a conclusão de todos os recursos. Para reversão, mantenha o último snapshot consistente disponível e restaure um backup verificado se for necessário reverter o ponteiro e o conjunto de dados.

## Canal, conhecimento e atribuição

1. Publique no Control uma fonte revisada com referência, validade e fatos. Confira a contagem, versão e hash projetados no Neo4j e teste a consulta específica. A leitura confere o ponteiro e a validade no PostgreSQL. Na indisponibilidade do grafo, prepare atendimento humano. Após restaurar o grafo, valide cada versão ativa com uma consulta. Se faltar projeção, salve uma nova versão revisada com o conteúdo preservado e publique novamente pelo fluxo normal. A retirada remove o ponteiro ativo.
2. Faça o piloto com um grupo delimitado de identidades confirmadas, com comprovante de opt-in para o remetente e finalidade, responsável definido, revisão de público congelado, limite diário e orçamento aprovados. Um telefone do diretório público mantém o estado `no_opt_in`. Mantenha separadas a identidade E.164, a BSUID opaca no seu escopo e as credenciais das lojas. Confira respostas, recusas, assinaturas de status, limites e qualidade no painel do próprio provedor antes de aumentar o volume.
3. Uma resposta interrompe a cadência automática. O follow-up usa somente o ordinal 1, após o contato inicial de ordinal 0 e as reavaliações. Mensagens de conversa têm identidade própria. Em falha de rede, consulte o resultado com o mesmo identificador. Resultado desconhecido mantém a reserva até comprovação do provedor. Revise recibos e o histórico da conversa antes de qualquer ação manual.
4. Uma proposta pode registrar vínculo da conta, cadastro e teste. O pagamento exige evento canônico Stripe assinado ou Asaas autenticado, com alocação identificável. Um retorno do navegador ou cliques no site não comprovam pagamento. Revise cancelamentos, estornos completos correspondentes e cobertura de alocação desconhecida no período da campanha. Esta última é uma ocorrência diagnóstica. Compare os valores com o extrato do provedor antes de confirmar o resultado financeiro ao time.

## Privacidade, parada e rollback

A página Privacidade permite localizar por CNPJ, bloquear contato, consultar supressões e conferir a última/próxima execução. O job remove dados operacionais de leads sem conversão após 180 dias da última atividade comercial, ressalvada retenção com motivo e autorização registrados. Preserva o identificador protegido de supressão e o histórico permitido. Snapshots oficiais e expiração de backups têm ciclo próprio. Documente os prazos de backup e reaplique supressões e descartes atuais antes de liberar uma restauração.

Para parar uma campanha, pause-a no Control e confira destinatários em submissão, aceitos e com desfecho desconhecido. Para conter efeitos da instalação, desative envio e modelo pago, depois pare a ingestão e os workers, aplicando as mudanças com encerramento gracioso. Preserve inbox, outbox, tentativas, comprovantes e reservas. Registre os últimos cursores, revisão de campanha, snapshot e versões publicadas. Uma migração aditiva pode permanecer com a versão anterior da aplicação compatível. Se houver incompatibilidade, restaure e valide cópia isolada dos dados e chaves antes de trocar o tráfego. Reconcilie recibos posteriores ao backup antes de reabrir os envios.

## Demonstração local

Na raiz do checkout Windows, com os serviços de teste próprios em PostgreSQL 15438, Neo4j 17690 e Redis 16389 e o perfil privado `.env.prospecting.local`, execute o comando abaixo.

```powershell
./apps/api/tests/prospecting-browser-preview.ps1 start
```

Abra o Control em `http://127.0.0.1:5179` e entre como operador sintético da fixture. O ambiente vincula a API 3019, dashboard HTTPS 5180 e site HTTPS 5181 ao loopback. As contas de demonstração estão definidas em `apps/api/tests/prospecting-browser-accounts.ts`. Use o menu **Prospecção** para buscar empresas, abrir a ficha lateral, preparar campanha, revisar conversas, conhecimento, canal e privacidade. O simulador de autorização do número pertence à prévia. As flags reais permanecem desligadas.

```powershell
./apps/api/tests/prospecting-browser-preview.ps1 stop
```

Espere o encerramento dos quatro listeners antes da suíte descartável de navegador. A prévia tem um recibo e um banco reutilizável próprios. Somente o dono da fixture encerra os clientes e remove seus recursos descartáveis. As provas locais cobrem UI, persistência, recuperação e provedores controlados. Uma liberação externa depende de autorização Meta no portfólio real, entrega e resposta em um piloto consentido e confirmação financeira do provedor. O tempo e a capacidade necessários para uma carga nacional completa dependem de medição no ambiente destinado ao trabalho.

