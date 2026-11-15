# Anúncios com IA

Módulo de aquisição por loja, adicional ao Growth e Escala. Usa produtos canônicos, gera imagens e prepara propostas de campanha para loja ou WhatsApp. Toda alteração na Meta exige aprovação humana do conteúdo exato. O monitoramento produz diagnósticos e recomendações, sem executar mudanças por conta própria.

## Commercial contract

O servidor fornece a oferta. Os valores iniciais são R$ 149 por mês por loja, até 30 imagens por período pago e cinco campanhas gerenciadas. O pacote opcional contém dez imagens por R$ 39. A verba de mídia é paga diretamente à Meta e não integra a mensalidade.

- Cada imagem utilizável consome um crédito; cinco imagens novas de um carrossel consomem cinco. Reutilização não gera débito.
- Falha sem imagem utilizável libera a reserva. Resultado desconhecido mantém sua reserva até conciliação, sem nova chamada automática.
- A franquia mensal não acumula. Extras permanecem no saldo. Reservas de períodos anteriores não aumentam a franquia atual.
- Preço, franquia e capacidade são variáveis de servidor em `apps/api/meta-ads-agent.env.example`. Cada contrato conserva sua oferta aceita. Alterações de configuração valem para novas contratações e não modificam planos-base nem assinaturas existentes.
- O checkout de extras usa a oferta aceita pelo contrato. Retornar do checkout não concede créditos; o webhook verificado precisa confirmar o pagamento.
- Cancelamento encerra a renovação ao fim do período pago. Histórico permanece disponível após o fim do acesso. Perda de Growth/Scale interrompe futuras renovações pela verificação de elegibilidade do observador.

## Activation gates

Os flags vêm desabilitados. A implementação local não constitui autorização para anúncios, cobranças, modelos pagos, migrações remotas ou publicação.

1. Aplicar a migration `20261114180000_meta_ads_agent` pelo processo de release do projeto. Existe também em `prisma/deploy-migrations`. Runtime usa exclusivamente Prisma; não há fallback em memória.
2. Configurar duas chaves diferentes, cada uma base64 canônica de 32 bytes: `META_ADS_CREDENTIAL_ENCRYPTION_KEY` e `META_ADS_ATTRIBUTION_SIGNING_KEY`. Guardar e rotacionar com o procedimento de segredos do ambiente. Trocar a primeira exige tratar as credenciais cifradas existentes; trocar a segunda invalida links antigos de atribuição.
3. Configurar o app Meta, segredo, configuration ID, versão Graph e redirect URI exata. A URI retorna ao dashboard com `?tab=meta-ads-agent`. O estado OAuth é único, por ator e loja. A credencial desta sessão de desenvolvimento/MCP não é uma credencial de produção da loja.
4. Cada lojista precisa conceder suas permissões e selecionar conta, página e ativos devolvidos pela autorização. Ausência de catálogo, dataset ou WhatsApp é uma limitação real. Acesso de leitura não comprova autorização de escrita, cobrança de mídia ou veiculação.
5. Configurar o provedor de imagens, armazenamento S3 existente e `META_ADS_IMAGE_SOURCE_HOSTS` com hosts HTTPS exatos das imagens canônicas. A revisão visual de preço e condições é obrigatória no runtime. Configurar também a análise de recomendações. Modelos e credenciais ficam no servidor.
6. Configurar Stripe dedicado, preço mensal BRL correspondente à oferta atual, segredo do webhook e `META_ADS_DASHBOARD_URL` HTTPS sem query/fragmento. Registrar `/webhooks/stripe/meta-ads-agent`, preservando o corpo bruto. Eventos têm propriedade `zyon_module=meta_ads_agent`; o webhook dos planos-base ignora esses eventos, inclusive após consultar a assinatura real. Chaves live são rejeitadas fora de produção.
7. Executar o piloto real de custos com ao menos 40 resultados. Registrar geração, revisão visual, análise textual, falhas, uso desconhecido, armazenamento, câmbio e custos de cobrança/operação. Revisar a oferta versionada e sua margem. Só então fornecer a quantidade e o SHA256 da evidência e habilitar `META_ADS_AGENT_COMMERCIAL_READY`. Os marcadores fictícios da suíte de testes não são um piloto.
8. Após a aceitação operacional, habilitar os flags correspondentes: módulo, worker de geração, observação, ponte de compras, escritas remotas e conversões. São controles independentes. Em mudanças comerciais, fechar a contratação, revisar novamente os custos e o preço do provedor e reabrir com a oferta revisada.

O cliente usa o transporte oficial `https://mcp.facebook.com/ads`, com credencial cifrada e escopo da loja. Valida metadados e mantém uma allowlist de operações. Continuação automática é restrita a leituras. Nunca repete uma escrita submetida por causa de timeout ou indisponibilidade.

## Merchant workflow

No dashboard, proprietário ou administrador abre **Anúncios com IA**. O módulo não habilita Revenue Manager nem exige sua permissão exclusiva do Escala.

1. Conferir oferta, saldo e contrato da loja; conectar a Meta e salvar os ativos autorizados.
2. Escolher produtos, destino e prioridade: vendas pagas, custo por compra, ROAS ou contribuição após mídia. Os requisitos de dados aparecem sem trocar a escolha do lojista.
3. Informar orçamento BRL, modalidade diária ou total e período. Salvar o rascunho não envia alterações à Meta.
4. Revisar quantidade e reserva de créditos antes de confirmar a geração. Selecionar e ordenar imagens verificadas, conferir produto/preço e salvar o rascunho.
5. Criar a proposta. Revisar objetos, valores anteriores e propostos, imagens e orçamento. Aprovar e executar são gestos distintos.
6. A preparação cria estrutura em rascunho ou pausada. Publicar exige outra proposta e aprovação explícita. `publishing` é processamento; `active_unconfirmed` não comprova entrega. Apenas uma leitura confirmada pode registrar veiculação.
7. Revisar recomendações antes de criar propostas de pausa, orçamento, público ou criativo. Campanhas existentes são somente para análise; um nome contendo Zyon não concede autoria.

Somente campanhas com origem persistida pelo agente podem ser alteradas. Antes de escrever, o servidor revalida aprovação, conexão, produtos e estado remoto. Outra proposta não contorna uma execução `reserved`, `sending`, `publishing` ou `execution_unknown` da mesma campanha. Uma preparação parcial ou concluída também impede recriação por outra proposta já aprovada. O replay da mesma execução preserva sua identidade.

Desconectar, cancelar ou encerrar o gerenciamento não pausa anúncios externos. O lojista precisa aprovar a pausa enquanto tiver acesso e conexão ou usar diretamente o Gerenciador de Anúncios. Após desconectar, aprovações anteriores ficam inválidas.

## Purchases and consent

A receita usa fatos de pagamento confirmados pelo servidor, com identidade canônica do pedido, sessão e reembolsos. Eventos do navegador são apenas gatilhos para consulta; não estabelecem valor ou pagamento. A ponte observa `order.completed` e reconcilia períodos com paginação e sobreposição. O vínculo da conversa da vitrine ao checkout exige o `cart_ref` confiável da sessão do servidor.

Na vitrine, o link assinado `zyon_ad` depende da campanha e da loja. As rotas de captura, vínculo, compra e revogação exigem capability da conversa com tenant, recurso e origem corretos. O proxy existente encaminha a origem e o User-Agent reais. Cookies de publicidade só são usados com escolha explícita. O Pixel usa o valor confirmado e o mesmo `eventID` do CAPI, no Pixel selecionado. Eventos de navegador fora da janela de deduplicação de 48 horas são bloqueados.

O consentimento salvo deve sobreviver à hidratação sem ser revogado acidentalmente. A retirada interrompe sinais futuros, aguarda a tentativa de revogação antes do reload e mantém pendências para nova tentativa quando houver falha de rede. A revogação é um recibo separado e alcança os checkouts já vinculados. Ela não retira eventos anteriormente recebidos pela Meta.

WhatsApp exige origem de anúncio verificada. Iniciar uma conversa ou verificar um telefone não concede consentimento de publicidade. A ponte atual preserva a correlação local com `consent=false`; não inventa autorização nem encaminha `ctwa_clid` nessa ausência. Para CAPI de WhatsApp, são necessários consentimento explícito na origem, WABA/número canônicos, dataset vinculado e permissões efetivas. O adaptador não cria datasets nem substitui WABA por página.

Conversas, compras pagas e receita atribuída permanecem separadas. Relatórios identificam fonte, janela, fuso, moeda, atualização e cobertura. Custos históricos incompletos tornam a contribuição indisponível. Moedas diferentes impedem um ROAS combinado sem conversão identificada. Atribuição observada não prova incremento causal.

## Incident handling

- **Geração desconhecida:** não reenviar a tentativa. Preservar reserva, identidade e uso desconhecido. `GenerationService.recoverStalled` classifica tentativas interrompidas; a conciliação interna exige evidência do resultado, hash e uso conhecido. Não existe endpoint público que permita ao lojista inventar essa evidência.
- **Escrita desconhecida ou parcial:** preservar os IDs já recebidos. Usar a consulta de estado da execução, que faz leitura. Sem confirmação, manter o estado desconhecido. Não apagar objetos, ativar parcialmente ou emitir uma nova preparação automaticamente.
- **Proposta desatualizada:** o erro confirmado exige nova revisão. Falha de rede após o envio exige consultar histórico/estado antes de outra ação. Rejeição de autorização/configuração não é prova de escrita realizada.
- **Permissão revogada ou desconexão:** interromper novas escritas e sinais que dependam dela. Não afirmar que a campanha foi pausada. A conciliação de leitura pode falhar se não houver mais credencial válida.
- **Métricas indisponíveis:** conservar a última atualização como desatualizada. Dados insuficientes permanecem aguardando dados, sem vencedor ou promessa de retorno.
- **Rollback de aplicação:** fechar flags e preservar tabelas/recibos para conciliação e histórico. Não remover migration com contratos ativos e resultados desconhecidos. Exclusão da loja usa o cascade da persistência, sem excluir anúncios na Meta automaticamente.

## Local verification

Os testes usam exclusivamente o PostgreSQL dedicado em `127.0.0.1:15435`, banco `meta_ads`, usuário `meta_ads` e senha fictícia `meta-ads-local-test`. Criam schemas descartáveis e não carregam o `DATABASE_URL` do projeto. O container local usado na implementação é `zyon-meta-ads-postgres-20261114`, PostgreSQL 16.

Na raiz do checkout isolado:

```powershell
Push-Location apps/api
$metaAdsTests = @(Get-ChildItem -LiteralPath src/modules/meta-ads-agent -Recurse -Filter *.spec.ts | Select-Object -ExpandProperty FullName)
node --loader ./tests/ready-prod-loader.mjs --test $metaAdsTests
Pop-Location
pnpm --dir apps/dashboard exec vitest run src/pages/meta-ads-agent src/api/endpoints/meta-ads-agent.spec.ts src/shell/nav-config.spec.ts src/shell/DashboardShell.spec.tsx src/lib/auth/permissions.spec.ts
pnpm --dir apps/dashboard exec playwright test -c playwright.meta-ads-agent.config.ts e2e/meta-ads-agent.spec.ts
pnpm --filter @zyon/api build
pnpm --filter @zyon/dashboard build
pnpm --dir apps/api exec eslint src/modules/meta-ads-agent
```

O bloco usa PowerShell e seleciona os testes do módulo sem depender dos auxiliares locais da spec, ignorados pelo Git.

O Playwright inicia somente webservers de teste em `127.0.0.1:5178` e `127.0.0.1:3018`. Requer Edge instalado. O runtime em `apps/api/tests/meta-ads-browser-runtime.ts` está fora do código de produção. Usa controllers, AuthGuard, serviços, repositório e PostgreSQL reais; OAuth, catálogo/pagamentos, Meta, imagens e CAPI são portas controladas. O teste da vitrine monta `StorefrontConsent` e `MetaAdsAttribution` reais, com SDK de publicidade substituído para impedir envio externo. O proxy Vite é uma ponte de teste; o proxy Next possui teste próprio.

Há três jornadas do lojista em 1440, 390 e 320 px e uma do comprador. Exercitam aprovações, quota, publicação com leitura posterior, análise existente, retorno de checkout sem conceder extras, cancelamento, desconexão, histórico após expiração, hidratação do consentimento, valor/eventID canônicos e revogação. Logs, traces e screenshots ficam em `.specs/features/meta-growth-agent/`.

## Evidence limits and delivery

Esta implementação tem prova local e controlada. Não comprova campanhas reais publicadas, autorização de escrita de um lojista, entrega de anúncios, SDK/Graph reais de um comprador, cobrança Stripe live nem custo de um piloto pago. A contratação comercial continua fechada por padrão até essas condições serem verificadas.

O desenvolvimento preservou o workspace original em um checkout isolado `C:/tmp/zyon-meta-growth-agent-20261114`, branch `feat/meta-growth-agent-20261114`. Os snapshots privados `c56eb34b` e `b6de6d34` contêm a base local e um pré-requisito de build; não são candidatos a publicação integral. Para integrar, revisar os commits próprios do recurso e as migrations sobre a revisão de destino. Push, deploy e migrações remotas requerem autorização específica.
