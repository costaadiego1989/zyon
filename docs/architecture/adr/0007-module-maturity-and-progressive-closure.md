# ADR 0007 — Maturidade e fechamento progressivo da API e do widget

- **Status:** aceito
- **Data:** 2026-06-13
- **Decisores:** Engenharia, Produto, Plataforma, Segurança
- **Relacionado:** [ADR 0001](./0001-modular-monolith-bounded-contexts.md), [ADR 0003](./0003-event-bus-and-transactional-outbox.md), [ADR 0004](./0004-prisma-isolation-per-context.md), [ADR 0005](./0005-multi-tenant-isolation.md)

> O número `0006` permanece reservado ao ADR de pivot para WhatsApp já
> listado no índice, embora o arquivo correspondente ainda não exista no
> workspace.

## Contexto

A AACP já demonstra uma jornada ampla de agentic commerce:

- checkout conversacional, coleta de dados, frete, oferta, cross-sell,
  cupom, PIX/cartão, confirmação e buyer hub;
- módulos de autenticação, merchant, regras do agente, checkout settings,
  checkout, embed, pagamento, integrações, suporte e buyer account;
- módulos adicionais de commerce, shipping, fulfillment, coupons,
  cross-sell, self-checkout e scraping agent.

Entretanto, "módulo implementado" está sendo usado para estados muito
diferentes. Há módulos persistidos e testados ao lado de módulos com
repositório em memória, controllers sem autenticação, integrações stub,
estado crítico não durável e documentação anterior ao código atual.

Evidências coletadas em 2026-06-13:

- API: `395` testes executados, `381` aprovados e `14` ignorados.
- API: lint falha com `1.146` erros; o CI permite a falha com
  `continue-on-error`.
- API: a suíte Prisma real não foi executada nesta auditoria.
- Widget: typecheck e build de produção aprovados.
- Widget: `255` testes unitários aprovados.
- Widget: Playwright mocked aprovado com `72/72` testes quando executado
  em porta dedicada; a porta padrão `5173` estava servindo outro projeto.
- Bundle do widget: ES `~1.095 MB` (`~255 kB` gzip) e IIFE `~721 kB`
  (`~215 kB` gzip).

Contagem de testes não prova, sozinha, isolamento de tenant, autorização,
durabilidade, idempotência, segurança de pagamento ou capacidade de
operação. Precisamos de um critério comum para fechar cada módulo sem
promover demos locais a piloto por engano.

## Decisão

Adotamos um modelo único de maturidade para módulos da API e capacidades
do widget.

### Níveis de maturidade

| Nível | Nome | Evidência mínima |
|---|---|---|
| `L0` | Scaffold | Estrutura, contrato ou stub sem fluxo funcional confiável. |
| `L1` | Domínio local | Regras principais funcionam com mocks ou memória; integração e operação ainda incompletas. |
| `L2` | Integrado | Fluxo relevante funciona e possui testes, mas ainda faltam garantias de segurança, persistência, resiliência ou operação. |
| `L3` | Pilot-ready | Cumpre integralmente a Definition of Done deste ADR e pode receber tráfego externo controlado. |
| `L4` | Production-ready | Possui SLOs, alertas, recuperação, segurança contínua e evidência de estabilidade em produção. |

O nível é atribuído pela menor garantia necessária ao fluxo, não pela
média entre itens. Um bloqueio crítico de segurança, persistência ou
consistência impede `L3`.

### Definition of Done comum para L3

Um módulo só pode ser declarado `L3` quando todas as condições aplicáveis
forem comprovadas:

1. **Ownership e fronteiras**
   - responsabilidade, aggregates, tabelas, portas e eventos documentados;
   - nenhuma dependência cross-context fora de porta pública ou evento;
   - lint de boundaries bloqueante no CI.
2. **Contrato e segurança**
   - request e response validados em runtime;
   - rota pública, merchant, buyer, API key e embed têm autenticação e
     autorização explícitas;
   - `merchant_id` nunca é confiado ao body quando pode vir da credencial;
   - cenários cross-tenant, replay, expiração e escopo estão testados.
3. **Persistência**
   - estado necessário após restart usa repositório oficial;
   - migration sobe em banco real e possui teste de restart;
   - nenhum índice de idempotência, fila, wallet, promoção, cupom,
     cotação ou shipment crítico existe apenas em memória.
4. **Consistência**
   - comandos repetíveis e webhooks são idempotentes;
   - writes de agregado e outbox são atômicos quando publicam fatos;
   - retry, compensação e falha parcial têm semântica documentada.
5. **Observabilidade**
   - logs estruturados incluem correlation id e tenant;
   - métricas cobrem sucesso, erro, latência e backlog;
   - logs e traces não expõem segredo, PAN, CVV ou PII desnecessária.
6. **Testes**
   - testes unitários das invariantes;
   - integração com persistência real;
   - E2E do fluxo público/autenticado e dos principais erros;
   - integrações externas possuem smoke controlado ou contrato sandbox.
7. **Operação**
   - configuração por ambiente falha de forma segura;
   - há runbook de falha, replay, rollback e reconciliação;
   - documentação e tarefas representam o código atual.
8. **Gates**
   - build, typecheck, lint e testes obrigatórios verdes;
   - etapas críticas não usam `continue-on-error`;
   - skips têm justificativa, owner e prazo.

## Classificação atual da API

Esta matriz é um baseline, não uma certificação. Todos os níveis ficam
limitados pelos bloqueios transversais de plataforma.

| Módulo | Nível | O que falta para L3 |
|---|---:|---|
| `auth` | `L2` | Remover segredo padrão fora de dev; refresh rotativo/revogável; rate limit compartilhado; RBAC e abuso em E2E. |
| `merchant` | `L2` | Eliminar rotas paralelas abertas de regras; auditoria; autorização por papel; teste cross-tenant. |
| `agent-rules` | `L2` | Remover ownership duplicado de checkout settings; usar persistência global; autorização por papel e contrato versionado. |
| `checkout-settings` | `L2` | Tornar fonte única; registrar auditoria; fechar tasks de depreciação e validar Prisma no CI. |
| `buyer-purchase-history` | `L2` | Persistir identidade hoje em memória; escrita idempotente/event-driven; retenção de PII e teste de restart. |
| `checkout` | `L2` bloqueado | Fechar rotas legadas abertas, especialmente sessão, decisão, regras e `orders/complete`; confiar somente em carrinho/frete/pagamento server-side; concluir desacoplamento por eventos. |
| `embed` | `L2` bloqueado | Aplicar `allowedOrigin`, `scopes` e `cartRef`; nonce/replay; CORS/CSP; remover modo sem token do piloto. |
| `payment` | `L2` bloqueado | Proteger endpoint legado; impedir fallback fake em produção; confirmação somente por estado autoritativo/webhook; reconciliação, refund e smoke sandbox. |
| `commerce` | `L1` | Persistir índice de pedido pendente e deduplicação; credenciais por tenant; retry/reconciliação e smoke Shopify. |
| `negotiation` | `L2` | Autenticação buyer/M2M correta; retirar chamada direta ao checkout; Prisma como padrão; métricas de custo e E2E live controlado. |
| `cross-sell` | `L1` | Proteger controller merchant; persistir promoções/sugestões; catálogo real; isolamento tenant e E2E de conversão. |
| `coupons` | `L1` | Proteger controller merchant; Prisma; limite atômico por buyer; idempotência concorrente; resgate no fechamento do pedido. |
| `shipping` | `L1` | Exigir embed/tenant confiável; não aceitar regra comercial do browser; persistir quote/seleção/expiração; smoke de carrier. |
| `fulfillment` | `L1` | Consolidar com o shipment persistido de integrações; assinar webhook; label/tracking real; máquina de estado e E2E de entrega. |
| `integrations` | `L2` | Claim/lock de delivery; proteção SSRF; criptografia/rotação de segredos; scopes em leitura; alertas de retry/DLQ. |
| `support` | `L2` | Vincular chat público a embed/sessão; antispam; redaction de PII; SLA/notificação e E2E persistente. |
| `buyer-account` | `L2` bloqueado | Prova one-time no login por checkout; OTP CSPRNG e provider real; rate limit; criptografia de CPF/endereço; refresh/revogação. |
| `self-checkout` | `L1` | Unificar auth com buyer-account; persistir wallet/templates; tokenizer real; executar checkout/pagamento/pedido; E2E cross-buyer. |
| `scraping-agent` | `L0-L1` | Autenticação/rate limit; fila e worker; fontes reais permitidas; persistência; timeout/circuit breaker e compra auditável. |

### Bloqueios transversais da API

Antes de qualquer módulo chegar a `L3`, a plataforma compartilhada deve
fechar estes itens:

- `TenantGuard` atual não valida tenant.
- Tenant middleware possui lista de modelos antiga/incompleta.
- Vários módulos criam `PrismaClient` fora de `PersistenceModule`,
  contornando o middleware e o lifecycle global.
- `MessagingModule` usa outbox em memória apesar da tabela
  `OutboxMessage` existir.
- CORS global usa `origin: true`.
- Controllers legados de checkout/payment e controllers de
  cross-sell/coupons/shipping/scraping/fulfillment não têm a proteção
  necessária para exposição externa.
- O lint de arquitetura não é gate e hoje mistura violações reais com
  configuração que também acusa testes e module roots.

## Classificação atual do widget

| Capacidade | Nível | O que falta para L3 |
|---|---:|---|
| Shell e embed | `L2` | Token obrigatório no piloto; validar claims; Shadow DOM ou isolamento equivalente; CSP e teste contra CSS hostil. |
| Chat e coleta | `L2` | Timeout/abort/backoff; retry idempotente; schemas por campo; consentimento e telemetria de falha. |
| Carrinho | `L1` crítico | `+`, `-` e remoção hoje alteram somente o estado visual; criar mutação server-side e comprovar o mesmo total no pagamento. |
| Frete | `L2` | Confirmar seleção na API antes de atualizar total; estado de erro/retry; carrier real e expiração de quote. |
| Cross-sell e cupom | `L2` | Sucesso/erro explícito, prevenção de aceite duplicado, erros tipados e persistência dos módulos da API. |
| PIX | `L2` | Estado pendente, expiração e atualização por polling/SSE/webhook; confirmação não otimista; smoke real. |
| Cartão | `L1` crítico | Substituir `CardForm` ativo, que envia PAN/CVV ao backend, por tokenização provider-side/Stripe Elements; confirmar apenas por webhook. |
| Confirmação | `L2` | Usar `order_id`, recibo e status final retornados pela API, não referência derivada da sessão. |
| Auth e buyer hub | `L1-L2` | Remover bearer token do `localStorage`; separar buyer/merchant; expiração, refresh, revogação e E2E de sessão vencida. |
| Suporte | `L2` | Remover políticas genéricas do fallback; usar configuração merchant; SLA e notificação operacional. |
| Tema e responsividade | `L2` | Matriz mobile/tablet, alto contraste, zoom 200%, temas piloto e orçamento de performance. |
| Acessibilidade | `L1-L2` | Focus trap/restauração, Escape, semântica de dialog, alvos de toque e gate axe sem violações críticas. |
| Contratos e SDK | `L2` | Schemas runtime como fonte única; contract tests; SDK cobrir cupom/cross-sell e contratos versionados. |

### Requisitos adicionais do widget para L3

- `widgetReloadKey` não pode incluir `cart.total` nem desmontar a sessão
  por uma atualização válida do carrinho.
- Sessão e identidade devem ter política explícita de retenção,
  expiração e consentimento.
- O E2E deve usar porta dedicada/`strictPort` para não validar outro
  projeto por acidente.
- Gates obrigatórios: unit, mocked E2E, real-api E2E, mobile, axe,
  regressão visual, build e orçamento de bundle/TTI.
- Smokes reais devem cobrir os providers, carriers e temas efetivamente
  declarados para o piloto.
- Arquivos grandes devem ser divididos quando impedirem teste de estados
  críticos; contagem de linhas isolada não é gate.

## Ordem de fechamento

### P0 — Baseline confiável e segurança financeira

1. Corrigir o lint/boundaries e torná-lo bloqueante no CI.
2. Centralizar todo Prisma em `PersistenceModule`.
3. Corrigir tenant context, middleware e fuzz com banco real.
4. Persistir outbox, retries, DLQ e idempotência de handlers.
5. Remover fallbacks inseguros de secrets/providers em produção.
6. Restringir CORS e adicionar validação global de requests.
7. Desabilitar rotas legadas abertas em produção.
8. Desativar o formulário de cartão com PAN/CVV até tokenização segura.

### P1 — Caminho transacional do piloto

Fechar em conjunto:

- `checkout`;
- `embed`;
- `payment`;
- `commerce`;
- `shipping`;
- carrinho, frete, PIX, cartão e confirmação no widget.

Saída: start → coleta → carrinho autoritativo → frete persistido →
pagamento provider-driven → pedido/commerce idempotente → confirmação
autoritativa, com restart e falha parcial testados.

### P2 — Identidade e operação do merchant

Fechar:

- `auth`, `merchant`, `agent-rules`, `checkout-settings`;
- `buyer-account`, `buyer-purchase-history`;
- `integrations`, `support`, `negotiation`;
- auth, buyer hub e suporte do widget.

Saída: operação tenant-safe, buyer seguro, webhooks observáveis e
suporte acionável para um piloto controlado.

### P3 — Growth e logística

Fechar persistência e operação de:

- `cross-sell`;
- `coupons`;
- `fulfillment`.

Esses módulos só entram no escopo do piloto quando o caminho P1 estiver
`L3`.

### P4 — Expansão pós-piloto

Fechar conforme demanda comprovada:

- `self-checkout`;
- `scraping-agent`;
- otimizações avançadas de bundle, analytics e canais adicionais.

Nenhum item P3/P4 deve atrasar bloqueios P0/P1.

## Gate de início do piloto

O piloto externo só pode iniciar quando:

- P0 estiver concluído.
- Todos os módulos do caminho P1 estiverem certificados `L3`.
- Não existir rota externa conhecida sem autenticação/autorização
  deliberada e documentada.
- Não existir estado crítico do caminho de compra exclusivamente em memória.
- Migration, restart e retry forem aprovados em banco real suportado.
- CI bloquear lint, typecheck, build, testes e Prisma.
- E2E cobrir happy path, cross-tenant negado, token/origin inválidos,
  retry idempotente, provider indisponível e webhook duplicado.
- Widget passar a matriz desktop/mobile, axe, contrato, performance e
  smokes reais definidos para o piloto.
- Toda exceção tiver owner, prazo e aceite explícito de risco; exceção
  de segurança financeira ou isolamento tenant impede `L3`.

## Fonte de verdade e governança

Para cada módulo, a equipe manterá uma ficha de fechamento com:

- nível atual e nível alvo;
- owner;
- fluxos incluídos e excluídos;
- links para migrations, testes, dashboards e runbooks;
- checklist L3 deste ADR;
- riscos aceitos, prazo e aprovador.

O código e os gates são a fonte de verdade operacional. Roadmaps e task
lists antigas devem ser atualizados ou marcados como históricos quando
divergirem do código.

Mudanças que alterem ownership, segurança, persistência ou semântica de
eventos exigem ADR específico e devem referenciar este documento.

## Alternativas consideradas

### Fechar por quantidade de testes

Rejeitada. Cobertura não prova autorização, persistência, idempotência ou
operação.

### Promover todo o núcleo diretamente a pilot-ready

Rejeitada. Esconderia bloqueios transversais já observados.

### Concluir primeiro os módulos novos em memória

Rejeitada. Aumentaria a superfície antes de estabilizar segurança,
tenant, dinheiro e infraestrutura.

### Criar um ADR independente por módulo

Adiada. Decisões específicas continuam podendo gerar ADRs próprios, mas
o critério de fechamento deve ser único.

## Consequências

**Positivas:**

- "Fechado" passa a significar uma evidência verificável.
- Priorização favorece isolamento, dinheiro e durabilidade antes de
  ampliar features.
- O mesmo modelo serve para API, widget e futuras extrações.
- Gaps de documentação ficam visíveis sem substituir análise do código.

**Negativas:**

- A velocidade aparente de novas features diminui durante P0/P1.
- O lint e os testes reais podem revelar regressões hoje mascaradas por
  mocks ou memória.
- A certificação L3 adiciona disciplina de runbook, métricas e evidência.

**Riscos:**

- Classificação subjetiva: mitigada pela checklist e revisão por evidência.
- Escopo excessivo: mitigado pela ordem P0–P4 e pelo caminho mínimo do piloto.
- Reserva inconsistente do ADR 0006: deve ser corrigida separadamente,
  sem sobrescrever ou renumerar este ADR.
