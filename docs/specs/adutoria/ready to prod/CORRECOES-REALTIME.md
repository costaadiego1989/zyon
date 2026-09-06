# Correções de acesso: conversa, suporte e administração

Data: 2026-09-05. Branch: `fix/ready-to-prod-audit`. Base: `dcb8150aae34b8284178d9d257e4ac174654d965`.

Este registro descreve a implementação desta etapa. A auditoria original continua sendo um snapshot anterior; os gates de produção permanecem abertos.

| Achado | Implementação local | Pendência |
| --- | --- | --- |
| API-004 | Gateway exige capability específica da conversa; HTTP de mensagem, histórico e evento exige a mesma credencial; tenant e carrinho da conversa são derivados dela. | **PARCIAL**: GET/PATCH do carrinho legado e POST marketplace/items ainda precisam de autorização por sessão e da migração da ponte storefront → widget. Não liberar ownership completo de carrinho. |
| API-005 | Lista/status de orçamento e consultas de funnel exigem AuthGuard. Tenant vem do principal; atualização usa um único updateMany com id + merchantId. | **PARCIAL**: compra com ENABLE_LEGACY_ROUTES=false continua dependendo da migração dos contratos públicos. |
| API-041 | Conexão autenticada, membership de merchant e ownership de ticket nos eventos, senderType derivado da credencial, salas com tenant, origem e expiração verificadas. Consumidores de suporte atualizados. | Implementação validada por testes locais; falta smoke de Nest/Socket.IO real, navegador e configuração de produção. |
| API-003 (alias) | Projeção legada de histórias filtra também stories.merchantId, além da categoria. | Complementa a correção de stories; não substitui os testes do módulo. |

## Contrato de conversa

`POST /storefront/conversations` gera um ID com randomUUID e acrescenta `conversation_token` e `conversation_token_expires_at` à resposta. A emissão só acontece para a conversa recém-criada: não há operação para transformar um ID arbitrário em uma capability.

Mensagem, histórico e evento HTTP usam `Authorization: Bearer <conversation_token>`. O path deve corresponder ao recurso do token; um merchant_id divergente é rejeitado. O carrinho usado pela mensagem é a própria conversa, e um cart_id diferente é rejeitado. Prefixar o caminho com `/v1` não remove essas verificações.

O socket `/storefront` recebe `auth: { conversationToken }`. Query merchantId não concede acesso. Join, leave e mensagem validam a credencial novamente. A sala inclui merchant e conversa. Mensagens têm até 4.000 caracteres, processamento sequencial por conexão e limite de 20 mensagens por minuto por conexão.

O cliente de storefront guarda a capability na memória e no sessionStorage da aba, separada por conversationId. A criação registra a credencial antes das mensagens e dos eventos; os emissores de analytics de conversa/login/registro a encaminham. Tokens antigos sem a capability não recebem acesso. A ponte para os endpoints de carrinho do widget ainda não foi migrada nesta etapa.

## Contrato de suporte

`POST /support/chat` continua exigindo EmbedAuthGuard e deriva merchantId do embed token. Quando o caso de uso cria um novo ticket, a resposta acrescenta `handoff.accessToken` e `handoff.expiresAt`. A credencial permite acessar somente esse ticket como buyer. session_id recebido no body é uma referência; não é credencial. Reutilizar session_id cria outro ticket e outra capability, sem recuperar acesso ao ticket anterior.

O socket `/support` aceita uma das seguintes identidades:

- Merchant: cookie HttpOnly existente ou `auth.accessToken` com JWT válido. O cookie exige Origin na allowlist; upgrade de WebSocket também verifica a origem. O usuário deve existir em AUTH_REPOSITORY com o mesmo id, merchant e role do JWT.
- Buyer: `auth.ticketToken` com a capability retornada no handoff. Embed token, buyer JWT e IDs isolados não concedem papel merchant.

Depois da autenticação assíncrona, o servidor emite `authenticated`. Os consumidores aguardam esse evento antes de join; enviar join imediatamente em connect pode ocorrer antes da validação. Dashboard usa withCredentials e reinscreve tickets em reconexões; os dois SupportPanel encaminham a capability e não iniciam socket sem ela.

join_merchant permite somente o merchant autenticado. join_ticket e send_message consultam o ticket com merchantId derivado da identidade. Buyer só acessa o ticket da capability e não emite agent_joined. send_message ignora a tentativa de promover senderType/senderName e usa buyer ou merchant conforme o principal. O nome apresentado para atendente é `Atendente`, sem confiar no nome enviado pelo cliente.

As salas contêm tenant + recurso. O helper emitBuyerMessage passa a exigir `(merchantId, ticketId, message)`; não havia consumidores desse helper na base inspecionada. Limites locais: 32 salas de ticket e 30 mensagens por minuto por conexão; conteúdo até 4.000 caracteres. Isso não substitui quotas distribuídas contra reconexões abusivas.

## Configuração e ciclo de vida

O serviço compartilhado usa HMAC com domínio `aacp_realtime_v1` e purposes distintos para ticket/conversa. Exige JWT_SECRET configurado com pelo menos 32 caracteres, sem fallback previsível. Não é necessário outro segredo. A configuração deve satisfazer esse requisito antes de iniciar a API, inclusive em desenvolvimento.

Cada capability dura uma hora, valida formato/tempos/nonce e vincula Origin quando presente na emissão. A origem é lida do request HTTP; para browsers, a mesma origem deve aparecer no socket e nas requisições seguintes. CORS_ALLOWED_ORIGINS deve conter as origens usadas pelos fronts; cookies não são aceitos de origens arbitrárias.

Sockets são desconectados no vencimento mesmo sem eventos. Reconexão exige credencial válida; não há renovação de capability por ID público. JWT e membership são revalidados nos eventos de merchant. Revogação imediata distribuída de JWT e remoção de acesso em conexões passivas antes do vencimento continuam dependendo do trabalho de autenticação compartilhada.

## Validação

17 testes passaram no loader que resolve os pacotes @zyon para fontes deste worktree, evitando dist de outro checkout:

```powershell
node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit apps/api/src/shared/auth/realtime-capability.spec.ts apps/api/src/modules/storefront/infrastructure/gateways/conversation.gateway.spec.ts apps/api/src/modules/storefront/presentation/http/storefront-admin-access.spec.ts apps/api/src/modules/support/infrastructure/gateways/support.gateway.spec.ts apps/api/src/modules/support/presentation/http/support.controller.spec.ts
```

Cobrem token forjado, audience, formato assinado inválido, origem, vencimento exato, expiração passiva, reconexão, isolamento de tenant/sala/ticket, papel buyer, membership removida, JWT revogado, aliases HTTP, orçamento de outro tenant, limites de conteúdo/volume e emissão de capability ao repetir uma sessão de outro buyer.

Storefront passa no diagnóstico `pnpm.cmd --filter @zyon/storefront exec tsc --noEmit --incremental false --types node,react,react-dom`. A execução sem a seleção explícita de types falha no minimatch implícito do ambiente. Widget ainda acusa SmartCart.tsx unused brand e SupportFAB.tsx retorno incompleto, ambos fora destas alterações. Dashboard acusa erros preexistentes de tipos/contratos fora do hook alterado. A API exige o diagnóstico isolado com Prisma gerado para esta árvore; o cliente compartilhado não oferece os tipos completos do schema. A verificação integrada posterior passou no typecheck isolado completo e na composição Nest com configuração fictícia. Consulte o [consolidado da branch](CORRECOES.md) para os resultados finais e limites.

Estes testes usam instâncias diretas e doubles de repositório/socket; não comprovam DI de toda a aplicação, entrega em cluster, cookie/CORS no navegador, restauração de conversa ou E2E de compra. O uso de test-force-exit não comprova shutdown gracioso.
