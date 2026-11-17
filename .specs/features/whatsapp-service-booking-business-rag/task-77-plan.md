# T77: categorias de serviços em Atendimento

T76 está completo localmente em bf9a4043e e integrado no Root25c9c1c31. T77 começa em fonte e testes; nenhum parser, import, teste, lint, build ou navegador enquanto M detém a janela.

## Assumptions

Reutilizar ProductCategory, CategoryForm e contratos73/74 existentes. Uma oferta tem um categoryId; a escrita de associação usa somente PUT de produto com categoryId, sem CAS inventado, preço, variante, capacidade ou tabela nova. Antes dela, GET canônico exige oferta ativa de serviço do mesmo tenant e revalida o contexto após await. Perfil, modo e política de administração permanecem os existentes.

O catálogo suporta status=active, limit25 e cursor, sem filtro remoto de tipo. A UI filtra serviços ativos, preserva cursor em página sem serviço e não transforma total do catálogo em quantidade de serviços. Categoria atual inativa permanece visível; não introduzir remoção de associação sem contrato confirmado. Limpar pai de categoria usa o SDK corrigido, com parent_id:null no fio.

Atividade usa ToggleSwitch. O formulário compartilhado recebe somente copy opcional de serviços, mantendo products como default. Reutilizar uma única instância do hook74. A releitura explícita bem-sucedida deve limpar o aviso e a trava de resultado incerto; falha de leitura continua bloqueando nova escrita.

## Files

- service-category-form.ts e .spec.ts.
- ServiceCategoriesPanel.tsx e .spec.tsx, useServiceCategoriesPanelData.ts.
- ServiceAttendancePage.categories.spec.tsx com cinco regressões de composição e compatibilidade.
- useServiceAttendancePage.ts: ação serial de associação e reconciliação explícita.
- ServiceAttendancePanels.tsx: composição real da aba Categorias.
- pages/categories/components/CategoryForm.tsx: copy opcional, mantendo o contrato de produtos.
- Fixture, config e spec de navegador dedicados, preparados antes de executar seu gate.
- Plano, evidência e metadados de T77. T105/T106/T107 e caches permanecem preservados.

## Criterion tests before implementation

O pacote cache be848b27 contém26casos já escritos,7puros e19de componentes, sem execução anterior. Conferir hashes e adotar specs antes das fontes. Aplicar integração c44d5288 somente após before hashes e backup das duas fontes existentes; adaptar a composição atual76 separadamente.

Escrever antes dos respectivos ajustes cinco regressões novas: criação mantém editor bloqueado durante releitura e depois restaura feedback/foco; escrita200+leitura503 permanecem fatos separados sem reenvio; troca de tenant ignora resultado tardio; exclusão real remove acionador e devolve foco útil; default do CategoryForm de produtos preserva copy e payload originais. Busy inclui releitura, e foco após exclusão deve ficar no painel/contexto atual.

Previsão:150companheiros atuais+26cache+6novos=182casos em16arquivos, sem filtros, skips ou mudanças nas asserções antigas74/75/76. Contagem executada depende do runner futuro.

## Success and pending gates

Após handover: coorte afetada integral e lint, readmissão integral da API própria, Browser dedicado com AuthScreen/API/SQL locais reais e capturas nativas desktop/mobile. Criar/editar categoria, limpar pai, alternar atividade e associar/reabrir serviço. Dois profissionais continuam vinculados ao mesmo productId; IDs e quantidades de ofertas, variantes, preços, vínculos e grade permanecem. Negativas de tenant/produtos/Staff, vazio/erro, teclado/foco e ausência de autoridade extra precisam de provas reais apropriadas.

Manter guards1024/2048, um worker, sem retry, prazos5/10/30/60/600 e geometria/hit/overflow. Nenhuma fabricação de perfil, reserva, preço, pagamento, resultado de disponibilidade ou imagem. Build/final feature gates permanecem obrigatórios em sua ordem; T77 não será marcado ou commitado antes do gate e inspeção técnica das imagens atuais.

## Existing approval applied to the predecessor control expectation

Root reviewed exact patch05f65017 against ATEND-03/T77 and the existing approved plan before alteration. Root interprets that authorization as superseding T75's temporary read-only prohibition of Nova categoria. This is Root's interpretation of existing user authorization, not a new user answer or general permission to change wrong tests. Only the case description and that control expectation may change; canonical name, Ofertas vinculadas:2 and the negative capacity assertion remain. Snapshot, apply/check/reverse-check and candidate hashes are required before composing the new panel. No SUT while M owns runtime.

## Source adopted, runtime not started

Os26casos de cache e5novos de Page foram escritos antes da adoção produtiva. A revisão de recuperação acrescentou1caso de falha da reconciliação antes do respectivo ajuste: refreshContext retorna sucesso booleano sem mudar seus efeitos/guardas; somente sucesso permite apagar a seleção e liberar a escrita. O hook antigo23casos permanece byteigual.

A integração c44d foi conferida antes e depois, com backup e apply/check/reverse-check0. O delta de controle antigo05f65017 também teve before/candidate/reverse0 e foi aplicado sob a interpretação registrada de Root. Nome, Ofertas2 e negativa de capacidade preservados. Nenhum outro oráculo antigo alterado.

A composição da aba já usa ServiceCategoriesPanel real; uma instância74. Busy cobre releitura e exclusão restaura foco no painel atual. Copy de serviços usa consulta-inicial, mantendo o exemplo original de produtos no default.

Freeze73:2471545e4b8456a0b7a098bc0aef03e89d95ec0ad017f6592fbcfb818aadd55f. Próxima coorte prevista182/16 e lint10, scripts .cache/t77-execution/run-components.mjs e run.mjs lint, somente após handover. Browser dedicado ainda a preparar; nenhum gate executado ou tarefa marcada.105eight/107d949/106cache preservados.

## Dedicated browser source, no execution

Fixture/config/setup/spec77 prontos, opção estática categories:true; defaults/75/76não criam esses dados. Reutiliza3empresas reais75. DELETE da categoria inicial declara vazio e conserva oferta/vínculos; segundo profissional API aponta ao mesmo productId. Categoria estrangeira pertence ao owner de produtos existente.

Quatro casos previstos: ownerCRUD/cancel/delete/foco; owner409real após DELETE da categoria selecionada, reconciliação e vínculo persistido/reload/filtros de2profissionais; produtos com Atendimento negado mas API compartilhada de categorias200 preservada e serviços isolados; Staff GET/me403 e escrita403 sem perfil fabricado. UpdateProductUseCase confirma409category_not_found. SQL compara ofertas/variantes/preços/profissionais/vínculos/grade/usuários e categoria estrangeira. Somente category_id e updated_at da oferta mudam na associação pretendida.

Oito capturas planejadas1440x1000/390x844: vazio, edição reaberta, erro real e vínculo persistido. Mesmo helper nativo validado76: alvo inteiro ratio1, hit, overflow, legendaLOCAL e scroll normal. Nenhuma captura nova existente ainda. Coorte182/16, lint15, list4, ownAPIguard e Browser4 só após handover; sem parser/import ou qualquer novo runtime nesta preparação.

## Actual partial gate

A janela exclusiva executou182/182casos em16arquivos,0falhas/skip,28,17s,natural0 em2026-11-17T06:19:49.838Z. Lint dos10arquivos UI passou sem erros/avisos.77inputs ea5b502c permaneceram exatos; processos conhecidos próprios0 e slot devolvido imediatamente. Os5arquivos de infraestrutura/navegador não foram analisados ou executados. Nenhum Browser/build/list/artifact nesse gate; T77segue aberto.

## Browser draft scope correction before first execution

O caso novo de produtos edita legitimamente sua própria categoria, como exige o contrato compartilhado. O snapshot de serviços inclui também foreignCategory, um espelho dessa categoria externa. Comparar o objeto inteiro antes/depois exigiria igualdade falsa do espelho que acabamos de alterar por uma operação permitida. Antes da primeira execução desse spec, preservar comparação exata de todas as tabelas próprias de serviços e exigir que foreignCategory corresponda ao registro de produtos alterado legitimamente. Nenhum dado próprio deixa de ser comparado; nenhuma asserção antiga ou caso executado é alterado. UI e16companheiros permanecem exatos ao182verde.

## Frozen browser handover packet

A correção de projeção b2a2ae9d alterou somente o spec browser novo ainda não executado. Todos os inputs de componentes e lint10 ficaram byteiguais ao182verde. Novo77freeze cd795cfb520d3d5b47abee5f570eaa7d7a4ca8813af6595b385a8627b43b97e8; manifesto browser-source-ready.json278a86b9. A próxima janela pode analisar os5arquivos novos, descobrir4casos, readmitir de fato API própria2543/fa8c/1d61 e executar Browser4/8frames sob2048. Readmissão atual ainda não feita; nenhuma dessas etapas ocorreu após devolver o slot.

## First actual browser failure and reviewed focused repair

Lint5zero/list4/actualownAPI2543fa8c/1d61admission0 preceded Browser22000. It ended natural1 at2026-11-17T06:38:12.303Z,2pass/2fail,0skip/flaky and normalcleanup/known-own0. Six actual frames and failed traces are archived. OwnerCRUD and product isolation passed; owner reload categories/policy429 and laterStaff profile429 came from the legitimate shared tenant60/60s bucket, not an IP limit or rerender loop. Initial owner reload profile200remaining1 is retained accurately. Final two-professional/reopenSQL steps were not reached.

Causalpacket5122e75a preserves observed chronology, source count reconciliation and limits. Root reviewed6actual frames as readable, without claiming full-flow or user approval. No rate setting, expected200/403/409, timeout or retry changed.

Root reviewed focused v2patchc05dc73f6b4ba7e90bae3f725c7f7090665119212cb6db8aa0106a70efc2f591/manifest4ae7d874 before adoption of7files. V1c6bf05a5 was never applied and is archived. V2uses scoped category refresh plus real consulted-offer reads, retains unrelated canonical data, guards busy/context/error and preserves the origin and exact identity of the reconciled issue. Professional/policy issue falls back to all, and a later issue remains blocked. Initial and global refresh remain all. Five new criterion regressions require187/16 rather than reusing182for changed SUT. NewpolicySQL checks strengthen preservation; browser observers follow actual scoped reads without altering business statuses/results.

Before adoption: fresh7-file/raw77-freeze backup, exactpatch/before/candidate hashes, apply/check/reverse0 and preservation of six frames/failure receipt. After adoption: fresh freeze and future187/lint/discovery/APIguard/Browser4+8frames only after explicit handover. No task mark or commit before true gate and current technical frame review.

## V2 adopted and current pending gate

Exactv2c05dc73f applied to7reviewed files after77before hashes, fresh backups and apply/check/reverse0.7candidates exact,70other inputs byteigual. New77freeze619645531b0a09ce3f93450293f8331f152589a489d3bf434835b742ab57bc2f.187/16required for changed SUT; prior182is historical, not reused as current proof. Lint15/list4/actualownAPIguard/Browser4+8frames remain pending explicit handover. No parser/import/test/lint/browser/build/probe after adoption.

Old23tests74 unchanged; only prior05f65017 old control expectation remains authorized. First failure receipt9b5991ab, source chronology/tenant counter5122e75a and six actual frames remain immutable. Root reviewed v1, then replaced it with v2before application after identifying the cross-resource issue origin and later-issue race. V1was never applied.

Next technical order confirmed by Root:77Full and commit, then105and106before78, preserving the currently approved105schedule controls and all8WIP.41does not block those local tasks.78will transfer schedule authority under its own requirements and tests afterward; no old105oracle change is inferred.

## Current passing gate and task closure

187/187in16files,0fail/skip,19.78s,natural0; lint15zero/list4 and actualownAPI2543fa8c/1d61readmission0. Browser69037 passed4/4in39.4s,0unexpected/skip/flaky, ended2026-11-17T07:23:56.555Z with normalcleanup/known-own0. Source77freeze61964553 stayed exact. All8frames are native1440x1000/390x844, with timestamps within the current run. Whole reload, two-professional shared-offer reads, finalSQL, Staff403 and permitted product-category200 were actually reached. No rate-limit reset/waiver/increase or status/time-budget change. The projected request total is not presented as measured telemetry.

Root actually opened the two links, mobileeditor, desktoperror and desktopempty currentframes;3others are byte-identical to already-inspected images. Technical task review PASS. User visual opinion remains pending; no independent final verification or full-feature/production completion is claimed. Original failure/counter traces and six frames remain archived. Current receipt0dbd9053 records counts, paths and hashes. T77marked before focused27-path commit. Next105then106before78, source only until explicit handover.

## Commit formatting

Git diff --check found one extra blank line at EOF of the new browser spec. Removed exactly one trailing newline; no token, assertion, gesture or payload changed. Tested bytes/freeze61964553 are archived in commit-preparation and the passing browser folder. The commit receipt records the separate formatting-only source hash; no SUT was rerun after returning the slot.
