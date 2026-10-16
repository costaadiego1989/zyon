# Cupons de assinatura e aviso ao administrador

## Escopo

- Admin Control: criar/editar cupons R$ ou %, datas em Brasília, filtros, paginação, habilitar/desabilitar e excluir.
- Recursos comerciais adicionais ficam recolhidos: duração do desconto, planos mensais elegíveis e limites de uso.
- Apenas `platform_admin` escreve; operações de cobrança e auditoria podem consultar conforme permissões existentes.
- Cupom de assinatura é separado dos cupons de produtos das lojas.
- Códigos usados não permitem alterar o contrato de desconto. Desabilitar/excluir impede novos resgates, sem retirar descontos de assinaturas existentes.
- Logo existente do website reaproveitado no Control e no dashboard; sem publicar o website nesta entrega.

## Configuração

Defaults documentados em `apps/api/.env.example`:

- `BILLING_PROMOTIONS_ENABLED=true`
- `BILLING_PROMOTION_MAX_MONTHS=36` (1 a 36)
- `BILLING_PROMOTION_MIN_CHARGE_CENTS=50` (mínimo não zero nunca inferior a 50; desconto total pode zerar)
- `BILLING_PROMOTION_SYNC_INTERVAL_MS=60000`
- `BILLING_ADMIN_NOTIFICATION_ENABLED=true`
- `BILLING_ADMIN_NOTIFICATION_EMAIL`: destinatário explícito recomendado. Sem configuração, só há seleção automática quando existe exatamente um operador `platform_admin` habilitado.
- `PLATFORM_CONTROL_PUBLIC_URL`: URL HTTPS do painel do ambiente.

O remetente usa `RESEND_API_KEY` e `RESEND_FROM_EMAIL`. Em homologação, incluir o destinatário em `NOTIFICATION_EMAIL_ALLOWED_RECIPIENTS` quando a allowlist estiver definida. Não colocar segredos nem o destinatário administrativo em variáveis `VITE_*`.

## E-mail

`invoice.paid` da fatura inicial (`subscription_create`) de uma assinatura ativa em plano reconhecido cria um aviso durável, único por assinatura. Não dispara por checkout aberto, renovação, pagamento falho, assinatura Free ou evento de conta Connect.

O worker usa lease e claim com `FOR UPDATE SKIP LOCKED`. Envio exige aceitação do provedor com ID de mensagem. Recusa recuperável pode tentar novamente; resultado incerto fica `unknown` e exige conciliação antes de reenviar. Chave de idempotência estável reduz duplicidade no provedor. `sent` significa aceitação do provedor, não prova de chegada na caixa de entrada.

## Validação e publicação

1. Aprovação visual do usuário nos prints locais; não publicar antes.
2. Preservar a atualização de WhatsApp e o website mais recente: a origem desta branch isolada é `b0fef37`, mas o deploy do website não faz parte deste pacote.
3. Verificar quais commits/artefatos estão ativos antes de promover a API; não substituir por uma branch antiga.
4. Conferir Stripe, preços e webhook corretos de homologação e configurar o destinatário real do aviso sem expor credenciais.
5. Aplicar em homologação as duas migrations: `20261015120000_billing_promotions` e `20261015130000_billing_admin_notices`, pelo fluxo existente de deploy. Conferir as tabelas de operadores/auditoria do admin preexistente.
6. Publicar API, Control e o ajuste pontual do dashboard no ambiente de homologação. Validar login, permissões e persistência real do CRUD.
7. Criar pelo admin um código exclusivo de teste: R$178 de desconto, somente Starter mensal, primeira mensalidade, máximo um uso e janela curta. O resultado esperado no catálogo atual é R$1 na primeira fatura e R$179 nas seguintes. Não criar um cupom amplo nos três planos.
8. Validar checkout Stripe e eventos com pagamento realizado pelo usuário. Conferir assinatura ativa, uma linha de aviso, ID de aceitação do provedor e confirmação do usuário de recebimento do e-mail. Reentrega de webhook não deve duplicar o aviso.
9. Não promover para produção sem aprovação e evidências de homologação.

## Evidências locais (não são prova de integração externa)

- 106 testes focados de política, serviço, permissões, módulos administrativos e aviso/webhook, incluindo o limite de 40 caracteres do nome do cupom na Stripe.
- Builds da API, Control e dashboard; schema Prisma validado.
- 17 testes focados adicionais do dashboard: duração do Free no cadastro/acesso, intenção de assinatura, permissões e guarda de rotas.
- `apps/control/tests/billing-promotions.browser.mjs`: CRUD e responsividade com respostas interceptadas, zero escritas em provedores.
- `apps/control/tests/zyon-brand.browser.mjs`: componentes reais, assets e marca, com dados demonstrativos e tráfego externo bloqueado.
- Prints locais em `.audit/billing-promotions-preview/` da worktree isolada.

## Homologação aprovada em 15/10/2026

- Admin publicado em Preview: https://zyon-control-84mfslcp8-diegos-projects-b6fd2a25.vercel.app. Dashboard publicado no hostname de homologação existente: https://dashboard-sandbox-59d9.up.railway.app, preservando as permissões de CAPTCHA/OAuth. Nenhum alias de produção foi promovido.
- Stripe usa somente chaves de teste da conta `acct_1TVJ9KPvEQVo3vcN`, com preço Starter mensal de R$179 e webhook em `/v1/webhooks/stripe`.
- O usuário autorizou um admin separado com o mesmo e-mail de produção, sem copiar senha ou hash. Credencial nova criptografada via Windows DPAPI, fora do repositório: `%LOCALAPPDATA%\Zyon\homolog\admin.credential.xml`.
- Alterar uma variável sem `--skip-deploys` fez o Railway reconstruir `master` (`b0fef37`) em vez do upload local (`00bd8a8`). Não usar isso como publicação desta entrega. A correção exige fonte fixada na versão desta branch **somente no sandbox**; conexão global de fonte também afetaria produção e não é autorizada.
- `connect_service_source` precisa de `staged: true` e do ID de sandbox, revisão de `get_staged_changes` e confirmação de que somente a fonte da API mudou antes de aplicar o deploy já aprovado pelo usuário.
- `apps/control/tests/billing-promotions.homolog.mjs` valida a UI publicada com API e Stripe de testes reais e deixa `HOMOLOG1REAL` sem resgatar.
- API de homologação fixada no commit `2df83aa95fce4bf90205f2e617011510c8c7984d`; deploy `a08ee2aa-5e54-48c9-a5e2-50e505e57239` concluído. Ajustes posteriores de documentação, scripts de evidência e texto do dashboard não exigem republicar a API.
- UI publicada: 18 verificações passaram, incluindo CRUD com persistência real, sincronização Stripe TEST, filtros, recarga e responsividade. Guardas HTTP reais: leitura 200 e cinco rotas de escrita 403 para o operador somente leitura temporário, removido depois do teste.
- `apps/api/scripts/verify-billing-promotions-sandbox.mjs --execute-test-payment` usou outro cupom de QA: pagamento simulado de R$1 na fatura `in_1UQxiIPvEQVo3vcNLTrC08zE`, evento Stripe `evt_1UQxiLPvEQVo3vcNUoLIWBCs`, plano Starter persistido e um único aviso. Replay controlado do evento retornou `duplicate`; não equivale a reentrega originada no provedor. A assinatura de teste foi cancelada e o cupom de QA desabilitado. Não foi conclusão de checkout via navegador.
- Resend registrou `delivered` para `01a141d0-6581-7345-9989-c20f138dc988`. O usuário confirmou explicitamente o recebimento do e-mail de teste na caixa do admin. Essa confirmação complementa, sem substituir, os registros de aceitação e entrega do provedor.
- `HOMOLOG1REAL`: criado pelo painel, ativo e não resgatado; somente Starter mensal, R$178 de desconto na primeira fatura, máximo um uso, até 22/10/2026 às 19:54 de Brasília. Primeira mensalidade de teste R$1; seguintes R$179. Apenas modo TEST, sem cobrança real no cartão.
- O cadastro reutiliza `FREE_TRIAL_DAYS` do catálogo compartilhado (padrão 7), sem a antiga promessa de 14 dias sem taxa. `apps/control/tests/surfaces.homolog.mjs` confere as páginas públicas publicadas, o texto, a API sandbox no bundle e os bytes do logo aprovado; não representa login de lojista autenticado.
- Dashboard de homologação no deploy `6195fb81-0c8b-40f6-a9ae-78eaf79b1440`, concluído. A verificação das superfícies passou com o bundle `/assets/index-lNCuFQUT.js`: Free 7 dias, páginas de acesso renderizadas sem erros JavaScript e logo idêntico ao aprovado.
- Evidências separadas em `.audit/billing-promotions-homolog/`: `result.json` corresponde somente ao teste de UI; `payment-result.json` ao pagamento, webhook e confirmação do e-mail; `surfaces-result.json` às páginas e assets publicados.
- Ao encerrar a homologação, produção não havia sido alterada: a API ainda estava no deploy `da20e9d9-02f6-4f1f-94f4-eb285540d965`. A publicação posterior, autorizada pelo usuário, está registrada abaixo.

## Produção autorizada em 15/10/2026

- Usuário autorizou publicar a entrega e criar `BLACKFRIDAY`: 50% nos três primeiros meses, disponível imediatamente até o final de 30/11/2026 (Brasília).
- A fonte em execução continha 10 arquivos de correções de ERP na API e cinco no dashboard que ainda não estavam na branch de homologação. Foram preservados na branch `release/subscription-promotions-prod-20261015`, commit `e035914cb05c3724d62255b0089c4fd0193d8b34`. A árvore original com alterações locais não foi publicada.
- API: deploy `b31545db-409f-4900-a217-9da169fadc1f`, `SUCCESS`, fonte fixada nesse commit somente no ambiente de produção. As duas migrations foram concluídas às 23:37 UTC. `/ready` confirmou banco conectado; endpoint de cupons sem autenticação respondeu 401.
- Conferência do container ativo contra a fonte anterior: 3.390 arquivos fora da alteração preservados, normalizando exclusivamente CRLF para LF. Não houve diferença de conteúdo além de quebras de linha nesses arquivos.
- Antes da publicação: 154 testes focados da API, cupons, admin, aviso e regressões ERP passaram; outros 21 testes focados de dashboard passaram. Builds da API, admin e dashboard passaram. Isso não representa a suíte completa do monorepo nem um pagamento real em produção.
- Admin: `dpl_25N9xFkvymqnKXfpwvY68Ctt8oLE`, https://control.zyon-payments.com.br, bundle `/assets/index-C1tGt-7H.js`.
- Dashboard: `dpl_HqWbBkKigHAQCCdwikjookzbM1BM`, https://app.zyon-payments.com.br, bundle `/assets/index-C-6HMZPd.js`. Foram mantidos 97 assets anteriores para sessões já abertas.
- Os previews foram verificados antes da publicação. A tentativa de promoção automática da Vercel retornou outro bundle de dashboard; a publicação foi corrigida com `vercel deploy --prebuilt --prod` dos pacotes verificados. Os HTMLs, bundles, API de produção, logos e ausência de erros JavaScript foram reconferidos nos domínios públicos.
- Configuração de avisos: destinatário administrativo explícito, recurso de cupons e avisos habilitados e URL do admin configurada. Chaves/preços/webhook Stripe LIVE existentes foram preservados. O recebimento de e-mail foi confirmado anteriormente pelo usuário em homologação; não foi gerada assinatura paga de produção para provocar um novo aviso.
- `BLACKFRIDAY` foi criado pela UI publicada, com sessão administrativa temporária emitida pelo serviço de autenticação para a operação autorizada. Nenhuma senha/hash foi lida, copiada ou redefinida; as sessões de validação foram revogadas ao terminar cada execução.
- Condições: Starter, Growth e Scale mensais; 50% por três meses; sem limite total de usos; expiração exclusiva `2026-12-01T03:00:00.000Z` (00h de 01/12 em Brasília), cobrindo todo o dia 30/11. Após o desconto: volta ao valor integral; taxas por compra não mudam. Coupon e PromotionCode conferidos na conta Stripe LIVE `acct_1TWHY8CGsYQE7HwX`.
- Divulgação no website não é automática ao criar um cupom no admin. O website restaurado continua no deployment `dpl_A7PwAbiE9pwt4WXy99LWGK5XfkYk`. A posição do anúncio e sua aprovação visual são tratadas separadamente.
- Checkpoint posterior: o campo nativo da Stripe recusou o código (`payment_pages_promotion_code_invalid`), embora sessões com `discounts.promotion_code` aplicado no servidor retornassem R$89,50 no Starter. Sessões de diagnóstico LIVE foram encerradas sem pagamento; clientes Stripe temporários foram removidos e o código QA foi desabilitado. BLACKFRIDAY permaneceu ativo, sem resgate.
- O usuário aprovou aplicar o código no app antes da Stripe e pediu novamente prints antes de qualquer publicação dessa alteração. Implementação LOCAL: campo compartilhado no cadastro e em Planos; resolução pelo servidor com bloqueios de vigência, plano, mensalidade, exclusão, habilitação, provisionamento, limite e propriedade do objeto Stripe; identidade de sessão inclui a promoção para não reutilizar checkout sem desconto. Novos testes focados: 43 API e 28 dashboard passaram. Builds API/dashboard passaram antes dos últimos ajustes visuais. Essa versão ainda precisa de homologação integrada e nova publicação, condicionada à aprovação visual.
- Prévias locais reais da interface, com dados de teste no app (não evidência de autenticação/pagamento), capturadas por `campaign.preview.mjs` e `coupon-app.preview.mjs`: topo/planos do site e campo do app em desktop/mobile; copiar código, ausência de overflow e ocultação de campanha vencida/desabilitada/agendada/indisponível conferidos. Os scripts não publicam nada. A skill impeccable orientou preservar os estilos existentes e o contraste nas superfícies clara e escura.
- Correção visual solicitada depois dos prints: a escolha proveniente do site não deve reduzir a etapa final do signup ao resumo isolado de um plano. `PlanSelection` mantém agora a comparação completa (Free, Starter, Growth e Scale), com a escolha inicial marcada e o cupom na própria etapa, preservando o layout existente. O caso de trial encerrado continua exibindo somente planos pagos. Teste de navegador local confirmou quatro opções, seleção inicial, preservação do cupom entre planos pagos e ocultação no Free em desktop/mobile. Typecheck e 24 testes focados do dashboard passaram; sem nova publicação. Prints corrigidos usam o sufixo `-planos-completos`.
- Scripts e evidências: `apps/control/tests/surfaces.production.mjs`, `apps/control/tests/blackfriday.production.mjs`, `apps/api/scripts/verify-billing-production-preservation.mjs`; resultados em `.audit/billing-promotions-production-20261015/evidence/`.

## Campanhas automáticas e seleção de planos — implementação local, sem publicação

- O usuário aprovou substituir copiar/digitar por aplicação automática e pediu escolher todos ou apenas alguns planos. O formulário agora oferece “Todos os planos pagos” e “Planos específicos”, mantendo `%`/reais, início/fim, duração e CRUD. O array de planos continua validado no servidor e restrito também aos produtos Stripe correspondentes. Free e anual ficam fora dessas campanhas.
- `autoApply` é opt-in explícito; migration aditiva `20261016010000_billing_promotion_auto_apply` ainda NÃO aplicada em nenhum ambiente. Cupons existentes permanecem privados por padrão, inclusive BLACKFRIDAY até ativação administrativa autorizada na nova versão. Criar cupom não o torna público automaticamente.
- Endpoint público `GET /v1/billing/promotions/automatic` projeta somente campanhas publicadas, provisionadas, habilitadas e vigentes, sem IDs Stripe ou dados administrativos; verifica status e usos no provedor. Cache local de até 15 segundos com invalidação nas mutações evita consultar a Stripe a cada visita. Checkout sempre revalida sem usar esse cache.
- Campanhas não acumulam. A seleção determinística usa a campanha elegível cadastrada mais recentemente, por plano; essa regra está descrita no admin. Preços e duração são apresentados na comparação completa do signup, com resumo do valor integral após a promoção. A entrada manual fica recolhida em “Tenho outro cupom”.
- Site na worktree separada `AACP-blackfriday-web-20261015` lê a campanha pública da API, não mais um JSON de BLACKFRIDAY fixo. Topo e planos usam “Aproveitar oferta”; cartões elegíveis mostram o preço promocional e planos não selecionados mantêm o preço normal. A contratação continua pelo signup completo; Stripe recebe apenas a promoção resolvida pelo servidor.
- Provas locais com fixtures, sem writes em provedores: CRUD do admin (12 verificações), criação automática para todos e para Growth/Scale, contratação sem digitar código com payload capturado, Starter sem desconto quando excluído, quatro planos visíveis na comparação, Free inalterado, desktop/mobile e campanhas vencidas/desabilitadas/futuras/indisponíveis. Tests unitários e verificações de tipos executados separadamente. Não são prova de login, persistência integrada, pagamento ou webhook dessa nova versão.
- A skill impeccable orientou reutilizar o formulário e o componente de planos existentes, explicitar escopo e condições e apresentar a alternativa manual como ação secundária. Novos prints: `campanha-admin-specific-desktop.png`, `blackfriday-app-signup-desktop-automatico.png`, `blackfriday-site-oferta-automatica.png`, com variantes mobile e seleção específica no diretório de evidências. Aguardam aprovação visual antes de homologação; nenhuma nova publicação nesta etapa.
