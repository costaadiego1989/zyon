# Execution Evidence

## T1: Complete Baseline

**Assumptions**: API722 é a base preservada; frontend f103 é fonte Git limpa, com publicação histórica comprovada apenas para widget. Não presumir frontend concorrente do principal como publicado.

**Files to touch**: três árvores frontend ausentes (`apps/dashboard`, `apps/storefront`, `apps/widget_v2`); somente documentos desta feature (spec/context/design/tasks/baseline e manifesto/script de curadoria). API/packages/lock/configs não recebem alteração.

**Success criteria**: 1.259 fontes Git copiadas sem sobrescrita divergente, hashes de destino iguais à origem, shared packages idênticos e reutilizados, ausência de segredos/deploy/builds, importers compatíveis com lock preservado e diff check limpo. T1 é documental, sem teste artificial.

**Gate**: PASS documental: 1.259 arquivos conferidos contra SHA-256 de origem; API/packages/lock sem diff; metadata nova passa diff check; importers frozen/offline aceitos. Linking interrompido para não concorrer com baseline do root, sem download/resolução. Whitespace herdado de source importado permanece registrado em baseline.md, sem reformatar código aprovado. Nenhuma condição de venda, pedido, estoque, pagamento ou mensagem foi alterada.

## T2: Owned Runtime

**Assumptions**: reutilizar PostgreSQL/Redis próprios existentes; executar o AppModule real em processo com ambiente filtrado; tipos e build de produção precisam passar sem noCheck/waiver. Neo4j parent prova o motor local, não integração API-RAG, que pertence às tarefas posteriores.

**Files to touch**: `apps/api/tests/service-test-{runtime,artifacts,neo4j}.mjs`, worker e spec focais; config checked de teste restaurado da fonte f103 e metadados desta feature. Não modificar código comercial ou testes anteriores.

**Success criteria**: recusas de endpoint/env/executável estrangeiros e ownership; contagem zero/skipped/fail recusada; banco real com schema completo/marker, Redis e Neo4j próprios; `/health` e `/ready` servidos pelo AppModule canônico; nenhum provider externo; encerramento exige ACK real de app.close e saída natural code0 antes de remover recursos próprios.

**Preexisting baseline**: orquestrador registrou 5.253 testes, 5.169 pass, 84 falhas e zero skips, exatamente o conjunto já catalogado em 05/11. Relatório em `.audit/service-plan-20261114/execution/baseline-triage.md` do principal. Não há baseline global verde e não se corrigem essas expectativas nesta tarefa.

**Progress**: linking frozen/offline concluído com zero downloads e lock preservado. O script test:compile original não tinha tsconfig.test-runner; config checked foi restaurado, mas um processo interrompido não deixou exit0 e não foi atestado. O build real de produção subsequente terminou exit0. Sua primeira attestation recusou mudança do harness JS durante o build; nenhum manifesto foi forjado. Novo fingerprint distingue produção compilada do harness JS executado diretamente, com novo build/attestation em curso. Sintaxe dos cinco JS passou. RED inicial por módulo ausente foi observado; depois quatro subcasos negativos passaram e o caso real recusou manifesto ainda ausente. T2 permanece incompleta até prova real e cleanup.

**Gate result**: PASS em 2026-11-14: build produção checked e attestation estável exit0; T2 executou 7 testes, 7 pass, zero failed/skipped, em 56,3 segundos. Schema completo e markers reais SQL/Redis, motor Neo4j local, `/health` e `/ready` do AppModule real e providerCalls=0. Cleanup exigiu ACK de app.close, saída natural code0/signalnull e remoção dos containers/bridges próprios. Isso não é aprovação de PSP, conversa Meta real, API-RAG ou shutdown de produção.

**Bootstrap corrections**: restaurados dois mirrors SQL byte-idênticos à história API e à revisão f103; origem/hash em runtime-bootstrap-sources.json. Nenhuma SQL foi alterada. A primeira prova AppModule revelou reconexão no rate-limit usando Redis por docker-exec; o guard real de 1500ms ficou intacto. Redis desta suíte agora é container próprio com publicação restrita a 127.0.0.1/porta efêmera, rootfs read-only/tmpfs/ownership/marker verificados. Helper Redis legado network-none permanece inalterado. A correção foi testada com negativas de bind público/volumes e prova real. O handshake isolado de bridge antigo foi medido em105ms, sem alegar que isso elimina latência sob AppModule concorrente.

**Next checkout**: após este commit, criar `C:/tmp/zyon-service-business-20261114`, branch `feat/service-business-20261114`, a partir do HEAD T2. O R histórico conserva suas mudanças .specs alheias; só fonte commitada e o estado desta feature serão a base nova. Nenhum stash/reset/deleção dos trabalhos anteriores. Instalar dependências próprias offline, sem junction mutável de Prisma.
