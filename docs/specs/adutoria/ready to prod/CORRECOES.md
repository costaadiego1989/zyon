# Implementação das correções — primeiro lote da API

Registro histórico do primeiro lote. Para o estado posterior, consulte a [segunda etapa](CORRECOES-ETAPA-2.md) e a [lista acumulada de achados](evidence/corrections/correction-status.json).

Data: 2026-09-05. Branch: `fix/ready-to-prod-audit`. **Produção continua NO-GO.**

O worktree de correção está em `C:/Users/Admin/Desktop/AACP/.audit/ready-to-prod-fixes-20260905`. As ações deste lote não trocaram a branch nem alteraram o índice do workspace principal, que continuou disponível ao outro agente. Não houve push, merge, implantação nem operação em provedor financeiro.

## Base e trabalho paralelo

A branch parte do commit `dcb8150aae34b8284178d9d257e4ac174654d965`. A auditoria foi registrada separadamente em `7d5613b`. As alterações ainda não commitadas do outro agente não foram incorporadas à base de implementação. Por isso, a configuração de migrações e os resultados dos fronts podem diferir do retrato original da auditoria, que examinou a árvore de trabalho modificada.

Três subagentes trabalharam em arquivos distintos: catálogo/estoque/stories; conversa/suporte; checkout/embed. O agente principal implementou financeiro, preparou o banco isolado e integrou as verificações. Uma revisão independente encontrou e ajudou a corrigir quatro caminhos adicionais: sessão alheia no frete, total/pacotes de frete falsificados, consentimento com identidade do corpo e hidratação de perfil anterior sem prova de e-mail.

As dependências existentes foram consultadas por junctions, sem instalar pacotes ou gerar Prisma nelas. Um cliente Prisma próprio e aliases para os fontes deste worktree evitaram usar o `dist` de outro agente. O setup reproduzível fica em [prepare-ready-prod-tests.mjs](<../../../../apps/api/tests/prepare-ready-prod-tests.mjs>).

Commits de implementação: `255508f` (financeiro), `e8d2b4b` (catálogo/estoque/stories), `946ca7c` (conversa/suporte), `84f322c` (checkout/embed/frete).

## Estado dos achados tratados

“Implementado localmente” significa patch e validação indicada abaixo; não é encerramento dos gates de produção. A lista completa dos 68 itens está em [correction-status.json](<evidence/corrections/correction-status.json>); os demais 56 permanecem abertos para os próximos lotes.

| Achado | Estado deste lote | Comportamento e limite |
| --- | --- | --- |
| API-001 | Implementado localmente | Variante/produto/mídia e reserva exigem tenant; tenant ausente também é rejeitado. Upload usa S3 substituído por double no teste. |
| API-002 | Implementado localmente | Reserva serializada por variante, CAS, idempotência e depósito persistido; confirmação/expiração não repetem baixa/liberação. Migração e legado exigem os cuidados abaixo. |
| API-003 | Implementado localmente | Stories/categorias/reorder e projeções públicas filtram tenant, inclusive o alias legado. |
| API-004 | Parcial | Socket e HTTP de conversa exigem capability. Autorização do carrinho legado, marketplace/items e ponte para widget continuam pendentes. |
| API-005 | Parcial | Administração de orçamento/funnel autenticada e mutation por id+tenant. Compra ainda depende da migração das rotas legadas. |
| API-006 | Mitigado; comando indisponível | Chargeback verifica papel e tenant nos dois aliases, mas exige confirmação do provedor. Nenhuma liquidação/dívida é alterada pelo comando manual. |
| API-007 | Mitigado; capacidade indisponível | Reembolso elegível responde 503 `refund_provider_unavailable`, preservando estado e valores. Não existe estorno financeiro implementado neste lote. |
| API-008 | Mitigado; capacidade indisponível | Repasse devido fica pendente e é contado como bloqueado. Data de repasse preserva política configurada; agendamento usa CAS. Conciliação externa continua necessária. |
| API-041 | Implementado localmente | Suporte autentica JWT+membership ou capability do ticket, deriva papel/tenant e atualiza os três consumidores. Browser/Socket.IO real e revogação distribuída permanecem gates. |
| API-042 | Implementado localmente | E-mail conhecido/hints não provam identidade; OTP atual é exigido e sessão anterior não verificada não fornece perfil. Troca de e-mail revoga prova anterior. |
| API-043 | Implementado localmente | Start precifica em catálogo/commerce; ignora valores/flags do cliente. Cotação usa total e dimensões da sessão. Carrinho sem dados confiáveis falha de forma explícita. |
| API-044 | Parcial | Emissão interna exige instalação/origem; proxy valida origem observada e não aceita cart_ref público. Sessão e endpoints embed vinculados ao nonce. Renovação, múltiplos tenants na mesma origem e quotas permanecem pendentes. |

Detalhes de credenciais e consumidores: [conversa/suporte](CORRECOES-REALTIME.md).

## Evidência executada

| Verificação | Resultado |
| --- | --- |
| Suíte dos oito módulos afetados, helper de credenciais e integração da migração | **538 testes: 515 passam, 22 falham, 1 já ignorado**. |
| Mesma seleção de testes disponível na base dcb8150, extraída separadamente | **485 testes: 458 passam, 26 falham, 1 já ignorado**. |
| Comparação dos nomes das falhas | Nenhuma falha exclusiva do patch. Isso não prova ausência de regressões fora da seleção executada. |
| Integrações em PostgreSQL 16 descartável | **21 passam**: catálogo/estoque 12, stories 5, settlement 3 e migração 1. Incluídas na suíte acima. |
| Typecheck completo da API com cliente Prisma isolado e fontes locais dos pacotes | **PASS**. Configuração diagnóstica; não substitui o build de release pelo lockfile. |
| Emissão TypeScript e criação da composição Nest | **PASS** com Prisma isolado, secrets fictícios e HTTP externo bloqueado. Sem `app.init()`, listener, browser ou validação de lifecycle. |
| Typechecks padrão dashboard/storefront | **FAIL**, tipo implícito `minimatch` ausente no ambiente. |
| Storefront com seleção explícita dos tipos node/react/react-dom | **PASS**. |
| Typecheck padrão widget_v2 | **FAIL**, `brand` não usado em SmartCart e retorno incompleto em SupportFAB, fora dos arquivos alterados neste lote. |
| Whitespace/diff | `git diff --check`: **PASS**. |

Os testes reais disputaram uma unidade com 100 reservas concorrentes, repetiram a mesma chave simultaneamente, disputaram confirmação/expiração, processaram 205 reservas em páginas, verificaram múltiplos depósitos e disputaram uma transição financeira com 20 workers. O teste de migração executou o SQL aditivo em schema exclusivo, comprovando backfill seletivo e restrição de FK.

Logs, comparação de baseline e resumos estão em [evidence/corrections](<evidence/corrections/README.md>). O teste ignorado já existia: `SendChatMessageUseCase blocks duplicate email registration and returns chat error turn`. Não foram suprimidos testes para obter resultado verde. Os testes de caracterização da auditoria original representam o código anterior; use a suíte de correções para avaliar esta branch.

## Reproduzir as verificações

Execute a partir da raiz do worktree com as dependências instaladas. Para banco, forneça um PostgreSQL **descartável e local** chamado `ready_prod_test`; testes de expiração processam sua fila global. Não use dados de desenvolvimento compartilhados nem produção.

```powershell
$env:READY_PROD_TEST_DATABASE_URL = 'postgresql://audit_test:audit_local_only@127.0.0.1:52230/ready_prod_test'
node apps/api/tests/prepare-ready-prod-tests.mjs --push
$env:READY_PROD_TEST_PRISMA_CLIENT = Join-Path (Get-Location) '.audit/verification/generated-client/index.js'
node apps/api/tests/run-ready-prod-tests.mjs --database
node node_modules/typescript/bin/tsc -p .audit/verification/api-isolated-tsconfig.json --noEmit --incremental false
```

A porta 52230 corresponde ao container temporário desta execução, já encerrado após os testes; ajuste para o banco descartável criado na reprodução. O setup limita `--push` a loopback e ao nome `ready_prod_test`, não altera o schema da aplicação e desabilita instalação automática de Prisma. Sem banco, execute o setup sem `--push` e o runner sem `--database`.

O loader transpila TypeScript sem metadata de decorators para testes com instâncias diretas. O comando usa `--test-force-exit`; não é teste de shutdown. A verificação separada da composição Nest utilizou JavaScript emitido pelo TypeScript com metadata, e não esse loader de testes.

## Integração e migração

1. Revisar os commits desta branch e integrar sobre a versão acordada com o outro agente. Worktrees evitam colisão de arquivos durante a edição; alterações nos mesmos contratos ainda podem exigir resolução de merge.
2. A base desta branch usa `prisma/migrations`. A árvore auditada do outro agente usa `prisma/deploy-migrations`. Incorporar [a migração aditiva](<../../../../apps/api/prisma/migrations/20260905150000_bind_stock_reservations/migration.sql>) ao diretório ativo da versão integrada, **depois** da baseline completa; não substituir ou reaplicar a baseline como solução.
3. Drenar os escritores antigos de reserva antes do rollout. A migração só atribui stock_id quando a variante possui um único estoque. Reservas legadas ambíguas ficam sem atribuição e exigem conciliação de quantity/reserved; o código não escolhe depósito arbitrário.
4. Não remover a coluna nova antes de retirar o código que a utiliza. Rollback para escritores antigos reabre a inconsistência; manter escrita de reservas suspensa até decidir e validar a versão de retorno.
5. Configurar JWT_SECRET com ao menos 32 caracteres, origens permitidas e instalações de embed. Migrar consumidores antigos de sessão: renovação do token pode criar uma nova sessão, e origens/instalações incorretas agora são rejeitadas.
6. Carrinhos commerce precisam de peso/dimensões confiáveis para cotar frete; a ausência desses dados bloqueia a cotação. O emissor público de storefront não recebe autorização de carrinho apenas por seu ID. Completar essa ponte antes de liberar compra.
7. Reembolso/repasse/chargeback continuam sem adaptação e conciliação externas completas. Não apresentar esses fluxos como concluídos nem liberar as capacidades com base apenas neste lote.

Continuam abertos os demais achados de auth, payment, outbox, durabilidade, contratos dos fronts, CI/deploy e dependências. Os 22 testes de base, os builds padrão, E2E/browser, sandbox dos provedores, migração da baseline integrada e operação real precisam ficar verdes antes de reconsiderar o NO-GO.
