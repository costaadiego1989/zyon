# T76: gestão de profissionais em Atendimento

T76 está completo LOCAL, antes do commit atômico. A versão atual passou150/150componentes, lint14, Browser4 e limpeza normal. Root inspecionou os estados atuais e aceitou a correção visual dos vínculos. Isso é revisão técnica da tarefa, sem aprovação do usuário sobre capturas ou verificação independente final da feature.

## Assumptions

O profissional é um recurso público de serviço, sem login implícito. SDK73, permissões59 e uma única instância do hook74 preservam as rotas existentes e expectedVersion/CAS. productIds substitui o conjunto completo; vínculos fora da página e perfil público inalterado permanecem. Nenhuma nova autoridade de preço, capacidade, usuário, agenda ou pagamento.

O picker lê o catálogo real paginado com status=all, limit25 e cursor, filtrando type=service nos resultados. Não existe filtro remoto type=service nem endpoint de contagem de compromissos afetados. A confirmação é qualitativa: novos agendamentos deixam de oferecer o profissional; confirmados e histórico permanecem.

Publicado, Reativar e cada vínculo usam ToggleSwitch existente. Root confirmou que o pedido explícito de trocar checkbox por toggle também abrange essas associações. Nome legível à esquerda, controle fixo à direita e fieldset discreto, sem CSS global.

## Files

O commit fica limitado aos14arquivos de código/teste/infra enumerados em .cache/t76-execution/commit-preparation/planned-paths.json,8capturas nativas e4metadados. Inclui ProfessionalsPanel/form/data, composição Page/Panels e testes, fixture/config/setup dedicados. Exclui T77, T105, T106, caches, API, packages, schema e lockfile.

## Criterion tests before implementation

Os29casos do pacote a3d6669 foram adotados antes dos3arquivos produtivos. Inicialmente ficaram byteiguais. Após a revisão visual, somente a mecânica de controle/role/aria foi adaptada ao toggle autorizado; payloads, CAS, productIds, guardas, estado, histórico e foco continuam preservados.

Quatro regressões de Page/painel foram escritas antes dos respectivos ajustes:

1. Salvar conserva o editor durante a releitura, bloqueia reenvio, depois mostra snapshot canônico, feedback e foco restaurado.
2. Escrita200 seguida de leitura503 conserva o fato do salvamento sem resultado otimista ou reenvio, com erro de atualização separado e foco útil.
3. Troca de tenant durante escrita mascara o editor anterior e ignora resposta tardia, sem leitura ou feedback do contexto anterior.
4. Desativar remove o acionador original; sucesso e releitura devolvem foco a Editar do mesmo profissional/contexto.

A correção mínima de composição conserva painéis apenas quando há snapshot do contexto atual. Carga inicial e troca de contexto continuam mascaradas. Edição fica desabilitada durante escrita/releitura; nenhum segundo hook.

## Real browser and persistence

Configuração dedicada herda guards/reporters/origem/limites. Wrapper passa professionals:true; setup default/T75não cria novas empresas nem muda testMatch. Fixture reutiliza preparação75commitada, mais segundo serviço e empresa estrangeira via API real. São4empresas sintéticas, sem endpoint inventado ou26profissionais.

Histórico preexistente é declarado por SQL canônico commitado: compromisso confirmado e pagamento pendente coerentes com serviço, variante, duração, preço, fuso e política real lida após PUT/CAS. Não simula reserva pela UI, muda plano/quota ou chama PSP.

Casos reais:

1. Owner valida fuso, cria/publica, vincula2serviços, enfrenta409, atualiza/reabre com versão canônica e preserva o vínculo restante; negativas de recurso/tenant estrangeiros.
2. Owner cancela confirmação, desativa, exclui elegibilidade e preserva compromisso/pagamento/usuários/vínculos; reativa por Space sem republicar.
3. Produtos negado na UI/API, sem leitura administrativa nem escrita.
4. Staff negado mantendo GET/me403 e dados privados inacessíveis, sem perfil fabricado.

SQL compara também preços, grade, bloqueios e registro estrangeiro. Native Space/foco/aria nos controles existentes permanece coberto; ring de foco em fonte vem de button:focus-visible no styles.css, sem mudança global. Não se afirma medição de estilo computado que não foi realizada.

## Preserved gate history

- Primeiro parcial149/13 e lint8 verde, antes da quarta regressão de foco. Freeze53ff0bbc92 preservado no cache; não substitui a prova atual.
- Primeiro150/13, lint14, list4, API2543fa8c/1d61 e Browser4natural0 encerrado2026-11-17T05:28:35.288Z; receipt291aaaad e8imagens originais arquivados. Root rejeitou somente o picker visual com caixas gigantes/labels espremidas; tarefa ficou aberta.
- Patchb5d06557 revisado antes de adotar SOMENTE4arquivos. Conferidos62before hashes, backup fresco, apply/check/reverse-check0, candidatos exatos e58outros inputs byteiguais. Mecânica de role/aria mantém as mesmas regras e contagens.

## Current passing gate

Freeze62atual64948b739befc575a52942f5c77bdd456bb1d4c74c21dc6e680aa1bc3dc7f4fd permaneceu byteigual durante todos os checks:

-150/150componentes em13arquivos,0fail/skip,18,49s,natural0; .cache/t76-execution/components-2026-11-17T05-44-07.262Z.
- Lint14sem erros/avisos; list4em1arquivo.
- Readmissão integral API própria checked2543/fa8cefd9363b/1d6187f518f5, sem cópia ou rebuild.
- Browser4/4natural0 em51,7s, encerrado2026-11-17T05:45:48.419Z;0skip/unexpected/flaky. Logs browser-2026-11-17T05-44-55.506Z.
- Limpeza before_closed_ack/disconnected normal e processos conhecidos próprios0. Slot devolvido imediatamente, sem novo SUT após ACK.
-8capturas atuais1440x1000/390x844, com mtime dentro da execução e hashes no recibo d7f74eae. Sem edição de imagens.

Root viu os4novos frames de edição/vínculos e inativo desktop; os3restantes são bytes exatos de frames já inspecionados. Veredito técnico: switches/labels legíveis e alinhados, sem contorno nativo. Guards1024/2048,1worker, sem retry/skip e prazos5/10/30/60/600 preservados. T76marcado antes do commit focado. T77segue em fonte; build/final feature/Verifier/produção continuam fora desta conclusão.
