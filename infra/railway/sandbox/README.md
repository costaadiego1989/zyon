# Sandbox Zyon — pacote para revisão e aplicação

## Destino e origem

- Projeto: AACP-ZyonPayments (b8421237-6557-4677-a08c-c93453b08568).
- Ambiente exclusivo: sandbox (a347216c-86e3-4a75-8d73-5ae6e122408c).
- Branch proposta: codex/zyon-channels-production; publicar somente esta branch.
- A produção e o sandbox hoje acompanham master. Alterar a origem apenas da API sandbox antes de publicar este pacote.
- Nenhuma operação deste plano foi aplicada remotamente. Não usar accept-deploy enquanto houver alteração inesperada no patch do ambiente.

## Serviços

Raiz de build: raiz do monorepo. Configuração Railway por serviço:

| Serviço | Arquivo | Porta | Saúde |
|---|---|---:|---|
| API existente | api.json | 3009 | /ready |
| Dashboard existente, sem deploy | dashboard.json | 8080 | /healthz |
| widget-v2 existente, sem deploy | widget-v2.json | 8080 | / |
| Storefront a criar no sandbox | storefront.json | 3001 | / |

Usar os comandos CMD das imagens; limpar overrides antigos de start/predeploy. O CMD da API já executa o preflight de migrações antes de iniciar. Gerar um domínio Railway para cada frontend antes dos builds para preencher as URLs abaixo. Não é necessário domínio próprio para esses três serviços.

## Variáveis públicas

API_SANDBOX = https://api-sandbox-8146.up.railway.app.
DASHBOARD_SANDBOX, WIDGET_SANDBOX e STOREFRONT_SANDBOX serão as três URLs geradas pelo Railway, todas HTTPS e sem barra final.

| Serviço | Variável | Valor |
|---|---|---|
| API | NODE_ENV | production (ativar as mesmas verificações de configuração) |
| API | API_PUBLIC_URL e PUBLIC_API_URL | API_SANDBOX |
| API | DASHBOARD_URL | DASHBOARD_SANDBOX |
| API | CORS_ALLOWED_ORIGINS | as três origens dos frontends, separadas por vírgula |
| API | INTERNAL_SERVICE_TOKEN | segredo novo, compartilhado somente com a Storefront do sandbox |
| API | ASAAS_SANDBOX | true |
| API | ASAAS_BASE_URL_SANDBOX | https://api-sandbox.asaas.com |
| API | E2E_SEED_ENABLED, EMBED_DEV_BYPASS, BILLING_BYPASS | false |
| API | WEBHOOK_DISPATCHER_ENABLED | false durante o isolamento inicial |
| Dashboard | VITE_API_BASE_URL | API_SANDBOX |
| Dashboard | VITE_STOREFRONT_URL | STOREFRONT_SANDBOX |
| Dashboard | VITE_WIDGET_V2_URL | WIDGET_SANDBOX |
| Dashboard | VITE_TURNSTILE_SITE_KEY | chave específica do ambiente se o CAPTCHA estiver habilitado |
| Widget | VITE_API_BASE_URL | API_SANDBOX |
| Widget | WIDGET_FRAME_ANCESTORS | lista finita de origens HTTPS que de fato usam o iframe, inicialmente DASHBOARD_SANDBOX |
| Storefront | AACP_API_URL | http://api.railway.internal:3009 |
| Storefront | INTERNAL_SERVICE_TOKEN | mesmo segredo da API; nunca expor com prefixo NEXT_PUBLIC_ |
| Storefront | NEXT_PUBLIC_WIDGET_BASE_URL | WIDGET_SANDBOX |
| Storefront | RAILWAY_PUBLIC_DOMAIN | variável automática do Railway; não usar hostname de outro serviço |

Os ARGs Docker recebem as variáveis públicas no build. Alterá-las exige rebuild. `WIDGET_FRAME_ANCESTORS` aceita somente origens HTTPS canônicas, sem caminhos, curingas ou credenciais, e gera o `frame-ancestors` do CSP sem `X-Frame-Options` conflitante. O preview atual do dashboard exige DASHBOARD_SANDBOX. A storefront importa o widget como biblioteca; ela não o incorpora em iframe. O runtime standalone é apps/storefront/server.js, com arquivos estáticos no diretório correspondente.

O checkout nativo obtém o token em `/api/checkout-token` no servidor da Storefront. Esse token exige `INTERNAL_SERVICE_TOKEN`, uma capability de conversa e um `cart_ref` assinado; a API então lê o carrinho persistido e ignora itens alterados pelo navegador. Criar token de checkout no browser, liberar carrinho vazio ou aceitar um `cart_ref` não assinado não é uma alternativa válida.

## Dados e segredos: ordem necessária

1. Confirmar as instâncias de PostgreSQL e Redis do ambiente antes de qualquer escrita; os textos DATABASE_URL e REDIS_URL iguais não provam compartilhamento nem isolamento. O SSH da conta não está configurado e o PostgreSQL sandbox não possui proxy TCP público. Não abrir o banco ao público apenas para esse diagnóstico.
2. Criar um banco de homologação vazio no PostgreSQL confirmado do sandbox e usar Redis exclusivo desse ambiente. Preservar o banco existente e seus 16 eventos mortos; não fazer replay automático. Uma loja nova em banco com credenciais herdadas não garante isolamento de workers.
3. Gerar segredos exclusivos: JWT_SECRET, BUYER_JWT_SECRET, EMBED_TOKEN_SECRET, AACP_PAYMENT_ENC_KEY, AACP_PII_ENC_KEY e eventuais chaves internas/ops. Não rotacionar chaves de criptografia sobre dados antigos sem migração; o banco novo evita essa perda de acesso.
4. Retirar credenciais live/herdadas de Stripe, Mercado Pago, Meta, Twilio, BubbleWhats, Resend/Brevo, Melhor Envio, OAuth e S3. Não copiar credenciais da produção nem imprimir valores em logs. Remover flags de habilitação que dependam dessas chaves.
5. Manter exclusivamente ASAAS_API_KEY_SANDBOX; configurar ASAAS_WEBHOOK_TOKEN exclusivo e callback no sandbox. Validar conta/carteira de teste antes de qualquer operação financeira. Variáveis de payout existentes não comprovam que o repasse do marketplace funciona.
6. Configurar bucket e email de teste exclusivos antes de testar upload e autenticação por OTP. WhatsApp precisa de configuração de teste e destinatário autorizado. Esses dados ainda não foram fornecidos.

## Execução e evidências

1. Registrar snapshot sanitizado do ambiente e do patch pendente; não alterar produção.
2. Aplicar origem/variáveis/serviços somente ao sandbox confirmado; implantar a revisão aprovada.
3. Rodar as migrações no banco vazio, criar lojas e catálogo fictícios, instalar origens do widget/storefront, validar /ready e autenticação real.
4. Repetir: configuração do agente → storefront → widget; tema/upload; conversa e carrinho; frete; pagamento Asaas sandbox e recibo; eventos/reconciliação; WhatsApp e domínio quando seus recursos existirem.
5. Guardar IDs de pagamento/recibo/evento e conferir estado e valores persistidos. HTTP 200, imagem saudável e teste simulado não substituem esses comprovantes.

## Bloqueios que o deploy não resolve

- Marketplace: carrinho entre vendedores, estoque/frete e payout/reconciliação ainda incompletos; a rota pública continua desabilitada.
- WhatsApp: nenhum destinatário de teste autorizado; processamento incerto ainda exige revisão humana.
- Domínio próprio: CNAME/TXT e emissão/renovação TLS continuam exigindo um domínio com DNS controlável. URL Railway não dá controle do TXT necessário.
- Widget em site externo: o snippet de iframe para uma origem de lojista ainda precisa de uma resposta CSP vinculada ao `allowed_origin` assinado, ou de inclusão explícita e novo build. Não liberar `frame-ancestors` com curingas para contornar esse requisito.
- Os testes externos ACP legados usam alternativas de status e não são critério de compra aprovada. A suíte padrão exige E2E_API_URL explícita para executá-los; os resultados ignorados não contam como homologação.

## Reversão

Reverter somente os deployments/configurações do sandbox para o snapshot anterior, se necessário. Preservar banco anterior e banco de teste; não apagar dados nem reverter índices financeiros automaticamente. Nunca usar push em master ou force-push para aplicar este pacote.

Referências de implementação: [variáveis em Docker no Railway](https://docs.railway.com/builds/dockerfiles) e [saída standalone do Next.js 15](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/output).
