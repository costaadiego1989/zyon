# WhatsApp Service Booking and Business RAG verification

**Verdict**: FAIL
**Mutations**: 3 - AUTH-01, AGENDA-03/ATEND-04/09, RAG-02/07; todas mortas por assercao de comportamento.
**Proofs**: a varredura final das 125 provas positivas, 9 builds e 3 mutacoes oficiais ainda e obrigatoria depois da correcao, conforme a sequencia otimizada aprovada. Esta revisao nao executou essa varredura nem certifica `proofs.md` como verde.
**Verifier**: independent sub-agent (author != verifier)
**Reviewed HEAD**: `31fb89c24018964c7b246aba34b945aeb4851f99`
**Diff base**: `7229739c7b0da6bbe8da9a7746090e48ae81a7e7`
**Review completed**: 2026-11-27, depois da execucao independente encerrada em `2026-11-27T16:31:03.453998+00:00`.

## Findings

| Finding | Evidence | Fix | Closed |
| --- | --- | --- | --- |
| F1 - Major, bloqueia aceite: um hash `scrypt` malformado com campo de chave nao vazio permite login com senha arbitraria e emite credencial de comprador. Escopo AUTH-01/C82 e seu teste independente explicito de hashes malformados. | E2 no HEAD original, sem mutacao: conta sintetica com `passwordHash = scrypt:synthetic-salt:!`, senha `NotTheBuyerPassword!771`; observacao real `rejected=false`, `jwtSignCalls=1`, `credentialIssued=true`, `returnedBuyerId=buyer_independent_malformed_key`. A prova propria terminou com exit 1 e `ERR_ASSERTION`. `apps/api/src/modules/auth/domain/services/password-hasher.service.ts:44` decodifica o campo; linhas 45-46 derivam/comparam usando seu tamanho sem exigir o tamanho esperado. `apps/api/src/modules/buyer-account/application/use-cases/login-buyer.use-case.ts:28` aceita o `valid=true` resultante e a linha 30 emite a resposta. Logs e comandos abaixo. | Recusar representacao/chave `scrypt` invalida antes da derivacao e retornar verificacao invalida, sem emitir JWT nem alterar a conta. Adicionar o caso de chave decodificada vazia aos testes com hasher/JWT reais e ao HTTP de login existente, preservando senha correta, demais negativas e snapshots da conta. Executar a prova propria vermelha sem mudar seu oraculo, provas afetadas e os gates finais. | |
| F2 - Major, coordinator supplemental finding: AGENDA-04/C9 guest slot choice presents an unvalidated cached review before identification. This was executed by the coordinator after the independent initial report, not by the initial Verifier. | Actual real-component/read-client example at original production source: displayed4873 cents, canonical authority changed to5279 and newer professional/policy versions before click; postclick GET count0, summary stillR$48.73, auth0 and no buyer header/write; specific assertion failed, exit1. Immutable example `guest-review-freshness.example.spec.tsx`; raw `guest-review-red.*` in `.cache/finding-regressions-source-20261127/`. Same oracle after correction is exit0 with fresh GET and public409/no stale summary. The independent Verifier checked these raw receipt hashes in its post-fix factual review. | Re-read existing canonical slots through the normal reader/epoch/abort path; accept only an equivalent current tuple or show the existing public conflict, without guest identity or write. Four additive component regressions cover unchanged/current, changed price, changed versions and disappearance. Original private write/auth negatives stay intact. Approved five total-read counts are applied once; two additional original expiry read counts and affected builds/browser gates remain pending until separately authorized/passed. | |
| F3 - Major, coordinator integration finding: natural-language native service browsing creates an empty CheckoutSession, violating the approved public-read boundary. Not an original Verifier finding. | Actual HEAD20c679 with the nine approved fixture corrections: whole service-selection-channel.integration.spec.ts exit1, tests8/pass0/fail8/skip0. In the first homonymous-professional case, after actual /servicos + promotional decline and the before snapshot, a natural-language resolve_service_selection creates a same-tenant/same-buyer empty CheckoutSession version1. Exact before/after persistence equality fails. Raw stdout SHA256 `9eafab717664384083007ed634d5942e08f379c2f40b79ffcd9ab20dfb3e5bfb`; factual finding `.cache/release-integration-adoption-20261127/read-only-selection-checkout-finding/finding.json`. Subsequent whole-file execution at 04102 passed six children but failed the foreign-ID refusal and cleanup: stdout SHA256 `34168d2c306554e04825012279e339155e793168ce354836b865a522530c3f54`. The refusal has no service controls, so the first presentation-only guard was incomplete. Root added two unchanged-oracle source regressions (RED 4 pass/2 fail, then GREEN 6/6), recorded in `C:/tmp/zyon-service-business-20261114/.cache/F3-service-fallback-20261127-01/`. This is not whole-file acceptance. | Use the already canonical store business mode as well as native controls to keep service browsing, clarification and refused queries free of recovery-checkout writes. Preserve product telemetry and prepared checkout origin. Compile the corrected source in real new CI, import its genuine output, then require the unchanged original whole selection and remaining gates. F3 remains open until those outcomes. | |

Coordinator supplement recorded 2026-11-27: F2 is new factual evidence and is explicitly attributed above. The original independent Round1 report remains byte exact in `.cache/final-recovery-roles-31fb89c2-20261127/independent-round1-preserved/verification.md` (SHA256 `1395fb1d775670c9d843e7f57ef54fcf75f773f8bdf56aef3a635153be1d444f`). Neither finding is closed before its focused commit and required gates.

A falha observada exige um hash armazenado malformado como o exemplo. Esta evidencia nao demonstra que contas com hashes validos aceitem qualquer senha, nem que um comprador possa alterar o hash armazenado. Nenhum cadastro real, token real ou banco remoto foi usado.

## Independent input and scope

Foi usado o pacote selado `C:/tmp/zyon-service-business-20261114/.cache/final-fresh-roles-31fb89c2-20261127/verifier/packet.json`. Os sete arquivos listados conferiram byte a byte pelo SHA256 do pacote. A revisao leu a especificacao, os Checks sem Handoff, o indice factual, o diff e as fontes relevantes na arvore real. Nao usou Handoff do autor, opinioes anteriores, Screens de outro papel ou plano incompleto de verificador anterior.

O indice factual registra 84 criterios, 125 comandos positivos, 9 builds e 3 mutacoes devidas. Ele registra a sequencia aprovada e nao fornece uma prova final verde. Portanto nenhuma qualificacao historica foi promovida a execucao atual nesta revisao.

O exame de assercoes concentrou-se em senha/credencial, disponibilidade canonica e historica, exclusao de ocupacao, publicacao e privacidade do RAG e a separacao entre navegacao publica e escrita de agendamento. As provas de navegacao publica usam sentinelas que falham em consultas indevidas de comprador/carrinho e em escritas, e verificam validade apos locks e ocupacao atual. A suite de login compara HTTP401/`invalid_credentials`, ausencia de assinatura real do JWT e snapshots completos da conta. Sua cobertura de hash malformado, entretanto, so usa enquadramento invalido, algoritmo nao suportado ou salt vazio (`login-buyer.use-case.spec.ts:47`); nao cobre chave nao vazia cuja decodificacao e vazia. E2 mostrou essa lacuna por comportamento real. Nenhum outro achado foi sustentado no recorte inspecionado.

A comparacao visual pertence ao papel Screens e nao foi refeita nem assumida por este relatorio. Tambem nao houve build, banco, Redis, Neo4j, navegador, provedor, push ou deploy nesta execucao independente.

## Mutations injected

Os tres alvos sao fontes de producao tocadas pelo diff selado. Cada trecho `old` ocorria exatamente uma vez. Nenhum teste, oraculo, filtro, timeout, retry ou perfil de recursos foi alterado. As provas usam o loader original que resolve `.js` para a fonte `.ts` desta arvore, sem executar artefato compilado antigo. Os arquivos inteiros selecionados rodaram sem skips, cancelamentos ou casos omitidos.

| Mutation | Location | Before | Mutant and actual behavioral failure | Restore | After | Killed |
| --- | --- | --- | --- | --- | --- | --- |
| M1: ignorar `valid=false` do hasher | `apps/api/src/modules/buyer-account/application/use-cases/login-buyer.use-case.ts:29` | exit 0, 12/12 TAP | exit 1, 4 pass/8 fail; rejeicao esperada nao ocorre para senha errada; `ERR_ASSERTION`, nao erro de ambiente/compilacao | byte a byte; SHA256 abaixo | exit 0, 12/12 TAP | yes |
| M2: comparar inicio da ocupacao com inicio do candidato em vez do fim | `apps/api/src/modules/catalog/domain/services/professional-availability.ts:134` | exit 0, 15/15 TAP | exit 1, 10 pass/5 fail; horario ocupado `10:00` ou bloqueado `10:30` aparece na lista; quatro assercoes `deepStrictEqual` falham, mais o pai TAP | byte a byte; SHA256 abaixo | exit 0, 15/15 TAP | yes |
| M3: retirar a condicao `isPublished` do profissional vinculado | `apps/api/src/modules/graph-rag/domain/public-business-source.ts:129` | exit 0, 16/16 TAP | exit 1, 14 pass/2 fail; `private-professional` e `PRIVATE-CANARY-NOT-FOR-RETRIEVAL` entram na projecao publica; `ERR_ASSERTION` na relacao publicada, mais o pai TAP | byte a byte; SHA256 abaixo | exit 0, 16/16 TAP | yes |

Contagens TAP incluem testes-pai quando o runner os conta. A morte foi confirmada no erro de assercao filho correspondente; um codigo nao zero isolado nao recebeu credito.

As provas exatas de M1/M2/M3 estao no `mutations.json`. Cada objeto conserva os campos executaveis `file`, `old`, `new`, `proof`, `label` e os resultados reais em `independentEvidence`, incluindo logs, SHA256, codigos e restauracao. Estes resultados sao da revisao em `31fb89c2`; a execucao oficial final das mutacoes continua devida no HEAD de fechamento.

| Target | Original and restored SHA256 |
| --- | --- |
| `login-buyer.use-case.ts` | `35d9d48a04d1963cad8ad51fb4209c09890ecca0c70b0e95b551789678586541` |
| `professional-availability.ts` | `8701b910fcf921c4b2dfb5a1d7d2506132822c223c51afba4d52770f427b2761` |
| `public-business-source.ts` | `e6bd1a7efcc8390ba094f533e283ae9effc242808ca43b2ccbc096aeb34440f9` |

## Own examples

O comando executado no HEAD restaurado foi:

```text
pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ../../.cache/final-verifier-recovery-31fb89c2-20261127/own-examples.test.mjs
```

- E1 PASS: fonte avulsa de 28 minutos em Brasilia no dia `2037-06-17`, servico de 7 minutos, ocupacao `12:07:00.000Z` ate `12:14:00.000Z`. As escolhas publicas foram exatamente `09:00`, `09:14`, `09:21`; ao estender apenas a ocupacao ate `12:14:00.001Z`, foram exatamente `09:00`, `09:21`. Instantes, duracao, zona e preservacao dos inputs foram afirmados. Proba AGENDA-03/ATEND-04/09 com valores que os criterios e checks nao nomeiam.
- E2 FAIL: formato `scrypt` de tres campos, salt nao vazio e campo de chave `!` nao vazio. O login real em memoria, com PasswordHasher e BuyerJwtService reais, retornou credencial e chamou o assinador uma vez. A assercao independente exige rejeicao HTTP401/`invalid_credentials`, zero assinaturas e preservacao da conta. A execucao terminou com 2 testes, 1 pass, 1 fail, zero skipped/cancelled/todo. O fixture e o log vermelho foram preservados sem correcoes.

Uma verificacao adicional somente do builtin `Buffer`, sem importar o SUT, confirmou `Buffer.from('!', 'base64url').length === 0`, exit 0. Esse diagnostico explica o ramo observado e nao conta como um terceiro exemplo ou prova HTTP. O fonte deriva `scrypt` com `expected.length` e compara dois buffers vazios, produzindo `valid=true` aceito pelo login.

## Evidence

Todos os arquivos desta revisao estao em `.cache/final-verifier-recovery-31fb89c2-20261127/`:

- `runtime-receipt.json`: comandos, horarios UTC, codigos naturais de cada prova, sumarios TAP, hashes das saidas, bytes originais/mutantes/restaurados e estado final `FAIL_OWN_EXAMPLE`.
- `m1-baseline-before.log`, `m1-mutant.log`, `m1-baseline-after.log`: cadeia 0 -> assercao 1 -> restauracao exata -> 0.
- `m2-baseline-before.log`, `m2-mutant.log`, `m2-baseline-after.log`: cadeia 0 -> assercao 1 -> restauracao exata -> 0.
- `m3-baseline-before.log`, `m3-mutant.log`, `m3-baseline-after.log`: cadeia 0 -> assercao 1 -> restauracao exata -> 0.
- `own-examples.test.mjs` e `own-examples.log`: os dois exemplos reais e a observacao de emissao de credencial. SHA256 do log: `4041ef65d5af160d88a915a55f58c8e09afb4b6ddf97b1f5360f2879ffcd1b8c`.
- `e2-native-base64url-decoding.log` e `.receipt.json`: campo sintetico `!` decodifica para zero bytes; codigo natural 0.
- `launcher-receipt.json`: processo Python PID `30448`, criacao UTC `2026-11-27T16:30:47.6437448Z`, comando exato e nomes do ambiente permitido. Lancamento oculto com ambiente sanitizado. O exit 0 do lancador indica somente lancamento; os codigos naturais das provas estao no recibo, nao foram inferidos do lancador.

## Runtime and source release

Depois da cadeia e dos dois exemplos, os tres alvos foram comparados aos bytes originais, e `git diff --exit-code HEAD -- <tres alvos>` retornou 0. O processo Python de PID/criacao registrados ja nao existe; nao ha journal de mutacao pendente. Nenhum servico, container, registro de banco ou mensagem externa foi criado por estes testes. As diferencas preexistentes de tasks/capturas foram preservadas.

O verificador devolveu explicitamente a lease de runtime e mutacao ao coordenador. Nao corrigiu fonte, nao fez commit e nao repetiu a prova vermelha. F1 permanece aberto ate correcao, evidencia posterior e registro do commit em `Closed`. A conclusao da feature ainda exige os 125 comandos positivos originais, 9 builds, 3 mutacoes reais no HEAD final e o gate final.
