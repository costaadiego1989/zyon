# T106: profissionais no serviço salvo

Implementação local autorizada pelo pedido de toggles e vínculo profissional/serviço. Root revisou o pacote beb22fbd e patch c6a8d9c3 depois de integrar T105 em55f66574d. C parte do próprio commit fc1f8abbc. Nesta janela, somente fonte/git/cache: nenhum import, parser, lint, teste, build, banco, navegador ou probe até novo handover.

## Premissas

- O perfil vem de `ProductDetailPageProps.me`. Reutilizar T59 e `api.serviceAttendance(me)` de T73, sem cliente paralelo, identidade fabricada ou writer novo.
- Apenas proprietário/admin de serviços com seleção resolvida e serviço salvo pode listar/alterar associações. Produto, perfil nulo, Staff e contexto incompleto negam acesso. Staff mantém GET privado `/merchants/me`403 e `me=null`; não abrir essa permissão para testar o painel.
- Ler todas as páginas com limit25/cursor. Cada PATCH envia somente o conjunto completo productIds e expectedVersion atual. Preservar outros vínculos, perfil público, publicação, disponibilidade, histórico e usuários. Associação não significa agenda disponível.
- Conflito para a sequência, preserva sucesso parcial e exige recarregar/revisar/reconfirmar. Resultado desconhecido só reconcilia por leitura; nenhum reenvio automático. Mudança de tenant/usuário/modo/item invalida respostas antigas. Uma submissão simultânea antes do render não duplica o PATCH.
- O hook existente já fornece createdProductId, hash salvo e callback uma vez. Usar essa identidade; serviço permanece no editor após Save e produto mantém navegação atual. Nenhum segundo create, savedId ou remount artificial.
- Todas as associações usam ToggleSwitch existente, nome à esquerda/controle36x20 à direita, label acessível, foco local e teclado. Preservar o footer global/módulos de T82 e a autoridade de horários até T78.

## Arquivos iniciais revisados

Adotar exatamente os seis candidatos do manifesto `.cache/t106-source-preparation/sdk73-toggle-revision/manifest.json`, verificando todos os before/dependency hashes, backup, patch/inversão e hashes resultantes:

- `apps/dashboard/src/pages/product-detail/hooks/useServiceProfessionalLinks.ts` e `.spec.tsx`.
- `apps/dashboard/src/pages/product-detail/components/ServiceProfessionalLinks.tsx` e `.spec.tsx`.
- `apps/dashboard/src/pages/product-detail/ProductDetailPage.tsx`.
- `apps/dashboard/src/shell/DashboardShell.tsx`.

O cliente antigo em cache continua arquivado e não entra em api/index.ts. Os46 contratos preparados são36 de hook e10 de componente; ainda não executados. O runner decidirá a contagem.

## Navegador e fixtures reais

Criar novo `e2e/service-catalog-professionals-fixture.mjs`, spec, setup fino e config dedicada, com opção estática opt-in no shared setup. Defaults e invocações antigas não criam empresas106. Preparar empresas e dados antes de UI pronta no global600 existente, usando register/login/GET/PATCH reais e SQL local declarado para onboarding/role/snapshots, conforme preparadores T75/T76. Não fazer SQL oculto de profissionais, reset/espera de quota, tier upgrade, stub ou novo endpoint de negócio.

Separar quatro jornadas, mantendo todos os resultados do plano anterior:

1. Tenant de serviço A: criar uma vez pela UI, continuar no ID/hash salvo, associar, salvar novamente por UPDATE, reabrir e desvincular preservando outro serviço. API e SQL confirmam o mesmo ID, versionamento e memberships. Callback uma vez continua nos companheiros antigos.
2. Tenant de serviço de paginação próprio:26 profissionais reais já existentes por API e alvo salvo. A primeira resposta25/cursor e a segunda página reais determinam qual profissional selecionar. Link por switch e PATCH/CAS, com outro productId preservado. Essa cardinalidade não gasta o bucket do fluxo criar/reabrir do tenant A.
3. Tenant B: três escolhas, concorrência real no segundo profissional, primeiro sucesso/segundo409/terceiro não processado. Reload e confirmação explícitos usam versão e outros IDs canônicos sem repetir o sucesso inicial. Capturas de conflito e recuperação.
4. Produto/Staff/foreign: produto conserva Save→catálogo e não solicita profissionais; Staff real mantém403/me=null e mutação proibida; foreign ID sob o caminho do tenant atual404, sem mudança SQL. A associação Staff da fixture usará tenant B, separado do fluxo A, com login e roleScopeSQL reais.

Inventariar HTTP por tenant em setup e observar endpoints/atores/status no navegador, sem publicar tokens. Contagem prévia é estimativa, não prova de quota. O rate limit60/60s de T77 continua intacto; não reduzir leituras canônicas necessárias nem trocar200/403/409 para acomodar a fixture. Se não couber, diagnosticar antes de alterar.

Capturar oito frames novos desktop1440x1000/mobile390x844 de associação, segunda página, conflito e recuperação, com os helpers protegidos de visibilidade/target inteiro/hit/overflow. Lista26 é maior que uma viewport: o alvo de sua captura é a linha real selecionada e label completo, sem encolhimento/zoom/crop. Os painéis curtos usam o painel inteiro. Capturas são nativas após gestos, sem edição. Não recapturar T75 como se provasse106.

## Compatibilidade autorizada

Adicionar somente Back real após Save nas jornadas antigas de serviço T98 e T105, antes das atuais assertions de catálogo/reset/reabertura. Manter cada caso, status, payload, preço, tipo, modo, snapshot, foco e geometria. No helper105, aguardar a conclusão real de Save antes de Back, preservando o próprio retorno HTTP e o catálogo depois. Produtos ficam exatos. Arquivar imagens105/T98 antes do futuro replay e relatar comparações reais; não substituir nova evidência por imagens antigas.

## Sucesso e gate futuro

- Whole36hook+10componente novos, todos os93 companheiros atuais de catálogo/entitlement e49 do SDK/transporte, sem filtros/skip. Expectativa manual inicial188 em15 arquivos, a confirmar pela lista concreta antes de execução; acrescentar regressões somente por comportamento requerido ou falha real.
- Tipos atuais, lint afetado e build oficial dashboard sob5168. Unidade1024, um worker. API própria2543/fa8c/1d61 exige readmissão integral; não copiar/rebuild automático de artifact alheio.
- Config dedicada seleciona os quatro novos casos e os dois T98 mais dois T105 antigos, preservando setup/origens/reporters/2048 e5/10/30/60/600 originais. Formalizar Gate106/C80 antes de executar; nenhum zero-match ou caso oculto.
- Full real verde, limpeza normal/owned0 e Root inspeciona oito prints antes de marcar106 e fazer um commit focado. Não declarar user approval/finalVerifier/feature completa. Só então T78 segue suas próprias dependências/gates.

## Primeiro gate real, somente componentes

Root concedeu a janela exclusiva apenas de componentes. Inventario188/15 e47hashes congelados antes, manifesto f0aab106. TLC0errors/2warnings antigos. Execucao real em .cache/t106-execution/components-2026-11-17T09-53-23.628Z:188/188,15arquivos,0fail/skip,19.94s,natural0at09:53:45.001Z. Novos36hook+10componente e93catalogo/entitlement+49SDK/transporte integralmente selecionados. Admissao6996>=1024,um worker. Todos47inputs exatos; knownCnode/cmd0at09:55:33Z. Slot devolvido antes de metadata. ReactPrefixInput shorthand warning antigo nao altera este resultado.

Nao houve lint,tipos,build,discovery ou navegador106 nesta janela. APIapp/DBfixture/capturas nao iniciados. Fixture30professionals/57HTTP e apenas fonte estimada. Browser8casos/3arquivos e8prints continuam obrigatorios. Task106unchecked/semcommit,78aguarda.

Root registrou novo handover para restanteFull:lint13,tipos/build5168,discovery8,readmissao integral propriaAPI2543/fa8c/1d61 e wholeBrowser8/2048,sem repetir188. Fixture/config/Back ficam congelados antes. Primeira falha/recusa devolve slot sem ajustar oraculo,quota,auth ou prazo. Root inspeciona8frames antes de mark/commit. Nenhuma etapa nova foi executada por este registro.

## Primeiro Browser real e correcao mecanica de endereco

Lint13zero, tipos0 e buildoficial0 passaram no source51b127 antes de discovery8 e readmissao propria API2543/fa8c/1d61. O whole8 em .cache/t106-execution/browser-2026-11-17T10-06-43.384Z terminou5pass/3fail/0skipflaky/natural1at10:08:37.815Z(113.472558s). Quatro antigos e a negativa106 passaram. Os tres positivos pararam no mesmo helper de linha, apos create/list/PATCH200 e conflito real200/409. DOM mostra switch e texto exato de sucesso; o haslocator erroneamente procurava a regiao ancestral dentro do li. Ainda nao foram exercitados UPDATE/reopen/unlink finais e recuperacao parcial completa. Nenhum dos8framesnovos foi capturado.

Cleanup before_closed_ack/disconnected normal,timers[],knownCnodecmd0at10:12:01Z. Nove PNG/ZIP/context de falha arquivados,51inputs exatos. APIseed real57requests,30profissionais,counts por tenant iguais ao plano; nenhum429 no journal observado. Seis frames legados mudaram e foram preservados no comparativo; nenhum foi restaurado para esconder a mudanca.

Root revisou patchdcd43313/candidato26a26796 e causa55b5bbce antes de conceder nova janela: uma linha troca apenas innerhas para role switch relativo, com mesmo nome/exact, outerregion/li e todas as linhas expect exatas. Backup/inverso/hash em .cache/t106-row-locator-review. Nao ha nth/first/force/wait novo ou mudanca de negocio. Dispatch antes da aplicacao: lint somente helper,discovery8,readmissaoAPIpropria,whole8/2048 original. Reutilizar188/tipos/build; apenasE2E fora dos inputs tsc/build muda. Primeira falha/recusa devolve; sem marcar106/commit antes do wholeFull/8frames e revisao tecnicaRoot.
## Full final e self-check

PASS local. Os188 componentes integrais passaram em15 arquivos, sem falhas ou skips. Lint13, tipos e build oficial dashboard passaram antes do primeiro Browser. A correção posterior altera apenas uma linha do novo helper E2E; seus inputs de componentes/tsc/build ficaram exatos. Root autorizou reutilizar esses resultados, executar lint1/list8 e readmitir integralmente a própria API2543/fa8c/1d61.

O whole8 final em .cache/t106-execution/browser-2026-11-17T10-22-36.725Z passou8/8, quatro novos e quatro antigos, sem skip/flaky/unexpected, natural0 às2026-11-17T10:24:18.372Z (100.608733s). Admissão7575>=2048, um worker, todos os budgets/quotas/auth originais. Before_closed_ack/disconnected e timers[] normais; scan exato próprioCnode/cmd0 às10:24:57.405Z. Nenhum outro SUT foi executado para o fechamento.

As57 chamadas de precondição e30 profissionais via API foram medidas; não houve429 no journal observado. As novas jornadas confirmaram create uma vez, ID/hash salvo, vínculo e UPDATE, reabertura/unlink,25+1 páginas, conjunto completo de outros productIds e expectedVersion. O conflito real preservou o primeiro sucesso, bloqueou o terceiro, e só continuou após reload/revisão/reconfirmação. Os snapshots preservaram usuários, disponibilidade, histórico e policy. Produto, Staff privado403/me=null e recurso estrangeiro404 mantiveram as negativas reais sem perfil fabricado.

O self-check cobre CAT-04/C80: cada teste novo faz assertions de estados, payloads ou ausência de acesso exigidos; os controles usam gestos reais. As46 unidades novas cobrem o contrato e as transições; os142 companheiros antigos continuam presentes. O proof CAT-04$ seleciona os quatro casos nativos. Não houve remoção, skip ou enfraquecimento de assertions, quota reset, espera artificial, force, novo endpoint ou desvio da especificação. SDK73, T59, ToggleSwitch e identidade createdProductId existentes evitam autoridade paralela e duplicação. Apenas o Back de serviço aprovado e o endereço mecânico de linha foram adaptados nos testes; produtos conservam sua navegação.

Root abriu as oito capturas novas e os seis frames legados alterados. Revisão técnica dos14 atuais PASS: estados e instruções legíveis em1440x1000/390x844, switches alinhados, controles de catálogo preservados. O toast transitório de atualização do serviço aparece nas capturas e fica fora dos controles do painel-alvo. Os18 bytes legados anteriores, comparativo de seis mudanças/doze iguais, primeira falha5/3 e artifacts permanecem arquivados. Nenhuma imagem foi restaurada, editada ou redimensionada para ocultar o resultado.

Marcar somente os três Done when de T106 antes do commit local focado de31 caminhos:13 código/testes/configuração,8 novosPNG,6 legados atuais e4metadados. Manifesto em .cache/t106-execution/commit-preparation/paths.json. API/packages/schema/lock e107d949 permanecem exatos. Esta revisão não é aprovação visual do usuário, verificação final independente nem conclusão da feature. T78 segue depois deste commit, em fonte até handover;106 não resolve footer82 ou dependência41 de79.
