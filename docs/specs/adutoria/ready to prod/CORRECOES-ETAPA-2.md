# Correções — segunda etapa de segurança da API

Data: 2026-09-05. Branch: `fix/ready-to-prod-audit`. Base desta etapa: `9c80287`. **Produção continua NO-GO.**

Esta etapa trata API-009, API-010, API-011, API-025, API-026 e API-027. O [primeiro lote](CORRECOES.md) permanece registrado como evidência histórica. Os trabalhos continuam no worktree `C:/Users/Admin/Desktop/AACP/.audit/ready-to-prod-fixes-20260905`, separado do workspace de outro agente. Nenhum push, merge, deploy ou envio real a provedor foi executado.

Os três subagentes implementaram sessões/equipe, OTP do comprador e inbox WhatsApp. O agente principal implementou quotas e redação central de logs, integrou schemas e executou migrações e HTTP real. Houve revisão cruzada de autenticação e quota; os testes também identificaram e ajudaram a corrigir aliases sem ator, permissões STAFF e possível reativação de membros removidos na migração.

Commits locais: `a79575a` (OTP), `78e84f9` (quota/logs), `1006871` (schemas/migrações), `19d085f` (webhooks), `bfd285b` (sessões/equipe) e `b97179b` (verificação reproduzível). Aplicar o conjunto: há dependências entre o guard global, o novo serviço de sessões e os schemas.

## Estado dos achados

| Achado | Estado local | Limite principal |
| --- | --- | --- |
| API-009 | Implementado e validado localmente | Sessões persistidas, refresh consumido uma vez e revogação compartilhada. Replays não revogam o vencedor legítimo; família tem prazo absoluto. |
| API-010 | Implementado e validado localmente | Reset por hash/uso único e logout de família. Entrega real de e-mail e retenção de registros continuam pendentes. |
| API-011 | Implementado e validado localmente | Papel/remoção revogam credenciais na transação; STAFF exige política explícita. Owners legados sem membership precisam de revisão antes do rollout. |
| API-025 | Implementado e validado localmente | OTP depende de aceite real do adaptador, sem logs sensíveis. Aceite HTTP não prova entrega ao comprador. |
| API-026 | Parcial | Autenticação e inbox BubbleWhats implementados. Twilio, engine de compra e idempotência dos efeitos externos continuam pendentes. |
| API-027 | Implementado e validado localmente | Quotas compartilhadas por IP e sessão merchant. Buyer/embed/API keys usam quota IP; ingress e capacidade precisam de validação. |

A [lista acumulada](evidence/corrections/correction-status.json) registra 18 achados tratados em dois lotes: 11 implementações locais, quatro parciais e três capacidades financeiras indisponíveis. Outros 50 continuam abertos. **Nenhum gate de produção foi encerrado.**

## Verificação final

| Verificação | Resultado |
| --- | --- |
| Suíte ampliada dos módulos afetados e segurança compartilhada | **677 testes: 654 passam, 22 falham, um skip preexistente.** |
| Mesma seleção disponível no commit anterior `9c80287`, sem novas integrações | **598 testes: 573 passam, 24 falham, um skip.** |
| Comparação dos nomes de falha | **Nenhuma falha exclusiva do patch.** Dois testes antigos de OTP passaram a passar. |
| PostgreSQL 16 descartável | **39 testes passam**, incluídos nos 677: catálogo/estoque, stories, financeiro, sessões/equipe, inbox e SQL de migrações. |
| Redis 7 descartável | **Três testes passam**, incluídos nos 677: concorrência em duas instâncias, expiração/TTL e quotas dos guards. |
| HTTP real com Nest, PostgreSQL e Redis | **Três testes adicionais passam**: abuso anônimo, sessão/cookie/tenant e revogação entre instâncias, indisponibilidade de Redis com health disponível. |
| Typecheck completo da API e emissão de JavaScript com Prisma/aliases isolados | **PASS**. Não equivale ao build de release pelo lockfile. |
| Composição do AppModule com JavaScript emitido | **PASS**, secrets fictícios e fetch externo bloqueado, sem `app.init()` nem listener. |
| Fronts, browser, provedores reais e carga de produção | Não executados nesta etapa; permanecem gates. |

Os logs finais e o manifesto de fontes estão em [evidence/corrections-stage2](evidence/corrections-stage2/README.md). A comparação de nomes não comprova ausência de regressões fora da seleção nem resolve as 22 falhas existentes. O skip já presente continua sendo o cenário de cadastro de e-mail duplicado em SendChatMessageUseCase. Nenhum teste foi desabilitado para obter resultado verde.

As integrações disputaram 20 refreshes e 20 resets entre réplicas, os três papéis com login/redução/remoção e a remoção simultânea de proprietários. O inbox recebeu 40 entregas concorrentes, disputou 20 claims, recuperou lease expirado e demonstrou retry após falha do pipeline real. A quota Redis admitiu exatamente dez de 100 chamadas concorrentes para o mesmo contador.

## Decisões de implementação

### Sessões e recuperação de senha

A API passa a consultar sessões persistidas para autenticar merchants. A assinatura do JWT, sozinha, não comprova sessão ativa. Refresh mantém o contrato de `access_token`/cookie, consome a sessão anterior em transação e preserva a validade absoluta da família. Dois pedidos concorrentes não recebem duas novas sessões. Logout revoga a família, inclusive quando disputa com refresh. Reset guarda hash do token, consome uma única vez e altera senha, versão de autenticação e revogação no mesmo commit.

JWTs emitidos antes da implantação não têm sessão persistida e exigem novo login. Links de recuperação que só existiam na memória do processo anterior precisam ser solicitados novamente. O banco passa a participar da autenticação de cada requisição e evento autenticado de suporte; dimensionamento e latência desse acesso continuam gates operacionais.

### Papéis e associação de equipe

`MerchantUser` é a conta efetiva de autenticação. Alterações de equipe devem manter seu papel, estado de acesso e sessões coerentes com `MerchantTeamMember`. A migração não deve recriar automaticamente acesso para administradores ou agentes de suporte cuja associação esteja ausente: esse estado também pode representar uma remoção anterior. Contas ambíguas exigem conciliação antes de reativação.

O legado não distingue todos os owners removidos de owners originais sem projeção de equipe. A migração preserva o bootstrap de owner; sua lista deve ser revisada antes de produção. Detalhes de contrato e transações: [sessões e equipe](CORRECOES-AUTH.md).

Os papéis de autenticação são `owner`, `admin` e `staff`. Acesso de `staff` exige metadata explícita e foi habilitado nas operações de tickets/mensagens de suporte. Configurações e demais operações administrativas não herdam essa permissão. Comandos de promoção/remoção exigem um ator humano ativo, conferido no banco; uma API key não identifica esse ator. A navegação do dashboard para agentes de suporte ainda precisa de validação de browser.

### OTP do comprador

SMS e e-mail exigem adaptador configurado e aceite HTTP do provedor. Falta de configuração, status de erro e timeout retornam 503 com código estável. Não há fallback que registre o código e simule envio. Os logs removem código, hash, destinatário e corpo de resposta do provedor. O hash do novo desafio só é salvo depois do aceite; uma falha de reenvio preserva o desafio anterior.

A configuração central de Pino também oculta `x-webhook-secret`, assinatura Twilio, credencial interna, código OTP, token de recuperação e segredo de configuração, preservando status e códigos de diagnóstico.

Aceite HTTP não comprova entrega ao aparelho ou à caixa postal. Crash depois do aceite e antes da gravação pode exigir novo envio. Confirmação de entrega, limites por destinatário e concorrência entre reenvios continuam sujeitos à validação do canal; esta etapa não declara essas garantias como concluídas.

### Webhooks BubbleWhats

O canal ativo exige segredo de webhook. A API normaliza e persiste eventos em inbox PostgreSQL antes do 200, deduplica por identidade do evento e rejeita conteúdo conflitante para o mesmo ID. O worker usa claim atômico, lease, recuperação após interrupção, tentativas com atraso e estado terminal `dead`. Configuração, tenant e dispositivo são conferidos novamente no processamento.

A entrega externa continua sujeita a repetição se ocorrer crash após o envio e antes da confirmação no banco. O inbox não torna o provedor externo transacional. O fluxo Twilio e o motor conversacional ainda determinístico não são declarados prontos para compra. Não eliminar registros de deduplicação sem definir o horizonte de replay do provedor; payloads contêm dados pessoais e exigem política de acesso e retenção.

Contrato completo de entrada, worker, reprocessamento e retenção: [inbox WhatsApp](CORRECOES-WHATSAPP-INBOX.md).

### Quotas HTTP

O `APP_GUARD` de [HttpModule](<../../../../apps/api/src/shared/http/http.module.ts>) consulta Redis por operação Lua atômica antes de liberar a requisição. Entradas anônimas recebem quota por IP. Tokens de merchant são verificados na sessão persistida para aplicar quota compartilhada da loja antes dos guards de rota. O limitador não atribui principal de autorização e não confia em tenant ou plano enviados pelo cliente.

O IP vem de Express e de sua configuração `TRUST_PROXY_HOPS`; `X-Forwarded-For` não é interpretado diretamente pelo guard. A topologia e a restrição de acesso ao servidor precisam corresponder à configuração de proxy. IDs de recursos não criam novos contadores para a mesma rota. As chaves Redis usam hash da identidade.

Redis é obrigatório em produção. Sua indisponibilidade causa 503 nas rotas protegidas por quota. Probes de saúde e métricas mantêm a exclusão explícita. Fora de produção, a ausência de Redis usa contadores locais limitados a 10 mil chaves ativas e emite aviso. Essa alternativa não oferece quota compartilhada.

`RATE_LIMIT_MAX` e `RATE_LIMIT_WINDOW_MS` configuram a quota por IP; defaults: 600 por 60 segundos. `RATE_LIMIT_TENANT_MAX` configura a quota de merchant por minuto; default: 60. Planos comerciais não são inferidos de `request.billingTier`. Credenciais de buyer, embed e serviços permanecem sob quota IP neste guard. O módulo alternativo `shared/rate-limit` continua desmontado; seus contadores não são a evidência desta correção.

## Integração e operação

Aplicar as migrações aditivas de [sessões/equipe](<../../../../apps/api/prisma/migrations/20260905180000_durable_merchant_auth/migration.sql>) e [inbox](<../../../../apps/api/prisma/migrations/20260905230000_whatsapp_webhook_inbox/migration.sql>) no diretório de migrações ativo da versão integrada, depois de sua baseline. Esta branch usa `prisma/migrations`; o outro workspace auditado tinha `prisma/deploy-migrations`. Não substituir a baseline.

Drenar instâncias antigas antes de liberar a versão: elas não consultam as novas sessões e ainda podem aceitar webhooks antes da persistência. Fazer rollback para esses escritores reabre os defeitos. Manter o schema aditivo e suspender as capacidades afetadas até escolher uma versão de retorno validada.

Configurar Redis compartilhado, segredos de webhook e canais de OTP. Preparar acompanhamento de 401 após a troca, 429/503 das quotas, backlog, lease expirado e eventos `dead`. Definir retenção e recuperação de eventos antes do rollout. As alterações não encerram gates de build de release, migração integrada, browser, provedores reais, carga, observabilidade ou recuperação de desastre.

## Reproduzir

Usar PostgreSQL e Redis descartáveis em loopback. O banco precisa se chamar `ready_prod_test`; as suítes de workers processam filas e fazem limpeza de fixtures. Os containers desta execução foram exclusivos e encerrados após a validação. Criar outros e substituir as portas abaixo.

```powershell
$env:READY_PROD_TEST_DATABASE_URL = 'postgresql://audit_test:audit_local_only@127.0.0.1:57689/ready_prod_test'
$env:READY_PROD_TEST_REDIS_URL = 'redis://127.0.0.1:57694'
node apps/api/tests/prepare-ready-prod-tests.mjs --push --compile
$env:READY_PROD_TEST_PRISMA_CLIENT = Join-Path (Get-Location) '.audit/verification/generated-client/index.js'
node apps/api/tests/run-ready-prod-tests.mjs --database
node --loader ./apps/api/tests/ready-prod-runtime-loader.mjs --test apps/api/tests/security-stage2-http.integration.test.mjs
node --loader ./apps/api/tests/ready-prod-runtime-loader.mjs apps/api/tests/ready-prod-composition.mjs
```

O setup gera Prisma e JavaScript apenas em `.audit/verification`, sem escrever nas dependências compartilhadas. O runner unitário usa transpile sem metadata e `--test-force-exit`; não valida shutdown global. Os testes HTTP separados usam o JavaScript emitido com metadata, abrem listeners somente em loopback e encerram os apps ao concluir. A composição completa continua limitada à resolução de dependências.
