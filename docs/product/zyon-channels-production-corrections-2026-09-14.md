# Zyon — correções de Canais e diagnóstico do sandbox

Data: 14/09/2026 (Brasil); consultas Railway em 15/09/2026 UTC.

## Resultado

**Liberação para produção ainda bloqueada.** Há correções implementadas e validadas localmente, mas marketplace completo, homologação de provedores, domínio externo e suíte global permanecem pendentes. Nenhuma alteração foi publicada no Railway ou na produção durante esta execução.

Checkout de trabalho: C:/Users/Admin/Desktop/AACP-channels-prod, branch codex/zyon-channels-production, base 3b28746. O checkout principal recebeu commits e alterações concorrentes durante a execução; não foi sobrescrito nem recebeu este pacote.

## Correções implementadas

| Módulo | Comportamento corrigido | Evidência executada / limite |
|---|---|---|
| Agente IA | GET/PUT merchant-agent-configuration salva identidade, modo e respostas rápidas em uma transação. Revisão detecta edições concorrentes, incluindo identidade legada. | PostgreSQL: rollback da terceira gravação, concorrência e leitura consistente. HTTP autenticado e navegador real: salvar/recarregar, configuração pública e widget_config do embed. |
| Tema & Aparência | Patch parcial preserva storeStyles; identidade do agente é centralizada, com nome somente para leitura na tela de tema. | API real preservou nome e cor; dashboard 569 testes; build e testes de branding do widget. Upload externo/S3 ainda sem homologação isolada. |
| WhatsApp | Resposta persistida antes do envio; retomada não executa checkout novamente; envio com resultado incerto bloqueia repetição; recibo assinado da Meta reconcilia entrega; painel mostra pendências. | PostgreSQL: rejeição seguida de retomada, envio aceito com resposta perdida, isolamento por loja/configuração e bloqueio ordenado da conversa. Sem envio real a um telefone. |
| Marketplace | Filtros de parceiros/bloqueios/estoque antes da paginação; nome/comissão reais; evento durável order.completed grava vínculos e liquidações atomicamente; unicidade por item. Pool compartilhado gerenciado pela aplicação. | PostgreSQL: falha intermediária reverte tudo; concorrência/replay produz uma liquidação por item; busca não perde produto elegível por limite. Isso não comprova transferência financeira. |
| Domínio | CNAME mais TXT exclusivo da inscrição para provar posse; timeout DNS preserva estado; storefront e autorização do certificado exigem posse confirmada. Caddy aceita URLs configuráveis. | Migrações em PostgreSQL, negação sem TXT e configuração Caddy validada em contêiner. Não houve emissão real de certificado. |

Também foi removido o sucesso fictício do adaptador de commerce sem provedor: validar carrinho, criar/marcar/cancelar pedido e testar conexão agora falham explicitamente. Leituras de catálogo vazio continuam permitindo o caminho nativo.

A lista de modelos protegidos por loja foi alinhada ao schema. O acesso entre lojas do marketplace usa explicitamente o mesmo pool sem reescrever o vendedor como a loja atual; seus repositórios mantêm os filtros de autorização de parceiros, host e seller.

## Validação executada

- 33/33 testes com PostgreSQL local: configurações, domínio, journal/inbox WhatsApp, liquidação e middleware de tenant. Nenhum skip.
- 234/234 testes focados dos módulos, checkout concluído e outbox antes das duas correções finais de composição/commerce; estas também são exercitadas na suíte padrão abaixo.
- Dashboard: 569/569 testes, 44 arquivos; build concluído.
- API, storefront e widget_v2: builds concluídos (consulte o log final da API).
- Playwright widget_v2: 10/10, com APIs simuladas; storefront: 2/2, fixture de regras comerciais em 1440px e 390px.
- Dashboard no navegador contra API e banco reais locais: salvar/recarregar identidade, publicação em configuração pública e tela móvel sem overflow; nenhum erro JavaScript. Ocorreram 401 esperados antes do login e 403 da consulta de domínio por limitação do plano da loja fictícia; o fluxo de domínio não foi homologado por essa tela.
- Suíte padrão completa da API: **pendente testes, pendente aprovados, pendente falhas e pendente ignorados**. Não constitui aprovação de release. Falhas detalhadas em api-default-suite-final.log.
- 33 migrações aplicadas em PostgreSQL 16 local com pgvector; Redis local separado. Nenhum banco remoto foi migrado.

Logs e capturas: ../../.audit/channels-prod. Os provedores dos testes automatizados são simulados; seus resultados não são comprovantes de pagamento, repasse ou entrega externa.

## Railway: sandbox encontrado e consultado

Projeto AACP-ZyonPayments: b8421237-6557-4677-a08c-c93453b08568.
Ambiente sandbox: a347216c-86e3-4a75-8d73-5ae6e122408c.
URL: https://api-sandbox-8146.up.railway.app.

- API na branch master, a mesma acompanhada pela produção. Deployment 55975f0e-d259-44ab-bbfa-ff36b34bbeea chegou a SUCCESS durante a consulta, sem ação de deploy desta execução.
- /ready e /health responderam 200; ready informou banco conectado. /v1/storefront/athom-technologies/config respondeu 404 no sandbox: a loja não está disponível ali nesse endpoint.
- PostgreSQL, Redis e Caddy online. Dashboard, widget-v2 e Kong sem implantação. Serviço zyon antigo offline/falhou; não há serviço storefront configurado nesse inventário. O Caddy usa apenas a imagem padrão, sem variáveis, domínio ou volume para certificados nesse ambiente.
- ASAAS_SANDBOX=true, chave sandbox presente, repasse adiado marcado como ativo. Código resolve a URL sandbox quando essa opção está ativa. A existência dessas variáveis não comprova pagamento/repasse.
- **Chave primária Stripe live igual à produção.** Credenciais Twilio, Meta, BubbleWhats, Resend, bucket S3 e segredos JWT/embed também iguais à produção. Token primário Mercado Pago igual e sem prefixo TEST.
- API_PUBLIC_URL, PUBLIC_API_URL, DASHBOARD_URL e CORS ainda apontam para origens de produção. Melhor Envio também aponta para o serviço de produção.
- DATABASE_URL e REDIS_URL possuem textos iguais, com hosts internos Railway. Isso **não prova banco/Redis compartilhados**, pois a resolução interna depende do ambiente. A comparação com variáveis dos serviços não foi conclusiva. A inspeção SSH para verificar os destinos não pôde ser executada porque a conta não tem chave SSH registrada; nenhuma chave foi criada.
- Logs do sandbox mostraram 16 eventos mortos no outbox e descarte de logs por excesso de volume. Não houve replay nem alteração desses eventos.

O diagnóstico sanitizado está em railway-sandbox-redacted.json. Valores secretos não foram gravados no relatório.

## Plano concreto para homologar no sandbox

1. Separar a origem da API em uma branch de homologação e publicar o commit revisado somente no sandbox. Não usar push em master como canário, pois ambos os ambientes acompanham master.
2. Confirmar os destinos de banco/Redis por instância; preservar dados existentes e usar loja/contas fictícias separadas. Configurar segredos de sessão exclusivos do sandbox sem alterar produção.
3. Ajustar URLs/callbacks e CORS para o sandbox. Preparar storefront, widget_v2 e dashboard vinculados à API sandbox; as URLs fornecidas pelo Railway/Vercel bastam para esses três componentes.
4. Remover do sandbox o uso de credenciais live. Para Asaas, manter exclusivamente credenciais sandbox e validar conta/carteira de teste. Stripe/Mercado Pago, e-mail, WhatsApp, frete e S3 precisam de recursos próprios de teste ou ficar indisponíveis até serem configurados. Não reutilizar destinatários reais.
5. Aplicar as três migrações novas após o preflight abaixo e testar os fluxos na loja fictícia. Usar recibos/webhooks reais do provedor de teste e conferir os valores persistidos.
6. Um domínio externo continua necessário para validar ponta a ponta CNAME/TXT, emissão/renovação TLS e roteamento por Host. Uma URL gerada da API não fornece controle de TXT para esse teste.

## Pendências de implementação e release

- **Marketplace:** a rota pública de inclusão de item entre lojas permanece desativada; composição do carrinho misto, estoque, frete, checkout financeiro, adapter de payout e reconciliação real ainda precisam ser concluídos. O job atual não afirma que dinheiro foi transferido. As variáveis de repasse adiado do módulo payment não implementam automaticamente o payout do marketplace.
- **WhatsApp:** processing_unknown exige revisão humana; recibos automáticos implementados aqui são da Meta. Outros provedores e casos de mídia/voz/anexos precisam de homologação e, onde faltar suporte, implementação. Ainda falta telefone autorizado para envio.
- **Domínio:** inscrições antigas com apenas CNAME precisarão comprovar TXT. Antes da publicação, inventariar os domínios ativos e coordenar essa mudança para evitar indisponibilidade. A migration não apaga registros.
- **Liquidação:** o índice único por line_item_id exige ausência de duplicatas existentes. Se houver duplicatas, reconciliar registros financeiros antes da migration; não apagar para forçar o deploy.
- **Suíte global:** resolver as falhas remanescentes e executar os cenários externos ignorados; preservar as proteções de pagamento aprovado, sessão embed e validação de cliente/frete ao corrigir fixtures antigas.
- Integrar a branch de correções com o estado atual de master, repetir os testes afetados por conflitos e só então publicar. Nenhum merge, push ou deploy deste pacote foi feito.

## Preflight SQL (somente leitura; executar no ambiente confirmado)

```sql
SELECT line_item_id, count(*) AS entries
FROM marketplace_settlements
GROUP BY line_item_id HAVING count(*) > 1;

SELECT count(*) AS domains_requiring_txt
FROM merchant_domains WHERE verified = true;
```

Migrações: 20260915010000_domain_ownership_verification, 20260915011000_whatsapp_delivery_journal e 20260915012000_channel_reconciliation_constraints. Mantidas em deploy-migrations (histórico efetivamente usado) e migrations (histórico legado).

Referência da configuração Caddy: https://caddyserver.com/docs/caddyfile/options e https://caddyserver.com/docs/caddyfile/directives/reverse_proxy.
