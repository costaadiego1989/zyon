# Frontends publicados na Vercel

Configuração validada em 05/09/2026. Kong, API, PostgreSQL e Redis ficam no Railway.

| Aplicação | Diretório | Projeto Vercel | URL de produção |
| --- | --- | --- | --- |
| Dashboard | `apps/dashboard` | `zyon-dashboard` | https://app.zyon-payments.com.br |
| Widget oficial | `apps/widget_v2` | `zyon-widget-v2` | https://widget.zyon-payments.com.br |
| Storefront | `apps/storefront` | `zyon-storefront` | https://storefront.zyon-payments.com.br |
| Site | `apps/web` | `zyon-agentic-checkout` | https://www.zyon-payments.com.br |

O domínio raiz redireciona para `www`. O widget oficial é `apps/widget_v2`.
O dashboard usa esse projeto no preview e nos exemplos de instalação; a
storefront redireciona seu checkout para o mesmo widget.

## Variáveis

As variáveis estão configuradas em Production e Preview na equipe Vercel
`diegos-projects-b6fd2a25`. Os arquivos `.env.production.local` de cada app
contêm a configuração correspondente e estão ignorados pelo Git.

| Aplicação | Variáveis principais |
| --- | --- |
| Dashboard | `VITE_API_BASE_URL`, `VITE_WIDGET_V2_URL`, `VITE_STOREFRONT_URL`, `VITE_OAUTH_REDIRECT_URI`, IDs públicos de GitHub, Google e Meta |
| Widget | `VITE_API_BASE_URL`, `VITE_DASHBOARD_URL`, `VITE_STRIPE_PUBLISHABLE_KEY` |
| Storefront | `AACP_API_URL`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_WIDGET_BASE_URL`, `NEXT_PUBLIC_SITE_URL`, `INTERNAL_SERVICE_TOKEN` |

Todas as bases de API apontam para `https://api.zyon-payments.com.br`.
Esse endereço passa pelo Kong, que encaminha para a API pela rede privada.
Os quatro frontends foram conferidos em Chromium após essa mudança.
O token interno existe apenas no servidor da storefront e na API, com o
mesmo valor. Nunca o transforme em uma variável `NEXT_PUBLIC_*` ou `VITE_*`.
Somente a chave publicável Stripe fica no widget; ela corresponde à chave
publicável configurada na API. A chave secreta Stripe preexistente no Railway
foi preservada e difere da chave no `.env` de desenvolvimento.

Os projetos Preview usam a API de produção. Para testar diretamente pelos
domínios de preview, configure um ambiente separado e sua lista de CORS;
os testes desta publicação foram feitos nos domínios de produção.

## Builds e futuras publicações

Node.js 22, pnpm 9. Os projetos usam as raízes listadas acima, com acesso aos
pacotes compartilhados fora de cada raiz. O install atual usa
`pnpm install --no-frozen-lockfile`, pois o lockfile local contém diferenças
preexistentes. Os comandos e rewrites estão nos respectivos `vercel.json`.

Esta publicação enviou apenas fontes dos frontends e seus pacotes compartilhados,
sem `.env`, API, `node_modules` ou builds locais. A cópia usada está em
`.audit/vercel-frontends-20260905`; é um snapshot, não a fonte para mudanças futuras.
Os arquivos `.audit/stage-vercel.cjs` e `.audit/deploy-vercel.cjs` registram o
procedimento local desta sessão. Nenhum commit ou push foi realizado.

## Verificações e uso

- Builds de produção concluídos na Vercel para os quatro projetos.
- API `/health` e `/ready` com HTTP 200; PostgreSQL e Redis online no Railway.
- Chromium: quatro páginas com HTTP 200, sem exceções de JavaScript.
- Dashboard, widget e storefront acessam a API pelo navegador, sem chamadas a localhost.
- CORS aceita os domínios oficiais e rejeita uma origem externa de teste.
- O widget chama `/embed/start` na API correta e rejeita um token inválido com 401.
- 20 testes do dashboard para instalação e validação do embed passaram.

A homepage da storefront é a página inicial existente do projeto. Lojas ficam
em `/store/<slug>`. O banco Railway foi inicializado vazio; dados do banco local
não foram importados. Um checkout completo exige uma loja cadastrada e carrinho
válido. A prova de conexão do servidor da storefront chegou à API autenticada;
o identificador fictício foi rejeitado pela chave estrangeira de loja, sem criar
pedido ou cobrança. Pagamentos e envios reais não foram executados.

As URLs OAuth foram atualizadas nas envs. O cadastro dos mesmos callbacks nos
painéis dos provedores ainda precisa ser conferido durante a conexão de cada
integração. A publicação não valida credenciais de todos os provedores externos.

## Google OAuth do dashboard

No cliente OAuth do tipo **Aplicativo da Web**, configure:

- Origem JavaScript autorizada: `https://app.zyon-payments.com.br`
- URI de redirecionamento autorizado: `https://app.zyon-payments.com.br/auth/oauth/callback`

Use os endereços exatos, sem barra final. O retorno chega ao dashboard e ele
envia o código à API. O mesmo callback deve estar em `VITE_OAUTH_REDIRECT_URI`
na Vercel e `OAUTH_REDIRECT_URI` no Railway. O `VITE_GOOGLE_CLIENT_ID` do
dashboard e o `GOOGLE_CLIENT_ID` da API precisam identificar o mesmo cliente;
`GOOGLE_CLIENT_SECRET` fica somente na API. Ao criar outro cliente Google,
atualize esses valores e publique novamente os serviços afetados.

O login completo depende de salvar esses endereços no Google e concluir a
autorização com uma conta. Esta validação de infraestrutura não substitui essa etapa.
