# Buyer Hub: benefícios e conversas, 05/10/2026

**Sandbox aprovado e exemplos disponíveis para revisão visual. Produção desta entrega ainda pendente.** Esta entrega complementa o [registro anterior do motor](revenue-intelligence-sandbox-2026-10-05.md). O pedido mais recente do proprietário foi disponibilizar os exemplos no sandbox para validar a interface. A publicação de produção será confirmada por revisão, fontes em execução, saúde e artefatos da storefront.

## Comportamento e impacto

O Buyer Hub apresenta o benefício efetivamente aplicado à compra do comprador: valor atual, limite, condições, validade e código quando houver cupom. A consulta autenticada respeita comprador e loja e é somente de leitura. Abrir a conta não matricula em experimento, não reserva orçamento e não concede desconto. Consentimento, audiência, controle, holdout, margem, prazo, retirada e encerramento continuam obrigatórios.

Cupons de estratégia são excluídos do catálogo público, de `list_promotions` e do contexto usado para intervenções genéricas do chat. O merchant continua consultando esses cupons no painel administrativo. A oferta personalizada aparece no checkout e, depois da aplicação, no Hub correspondente. Esta entrega não projeta um benefício de um checkout no carrinho inicial da storefront.

A aba Conversas usa títulos legíveis derivados da primeira mensagem do comprador, com nome da loja como alternativa, linhas compactas e mensagens identificadas como “Você”. Consulta de histórico e avaliações permanecem disponíveis.

| Estado | Evidência | Ações |
| --- | --- | --- |
| Em andamento | Carrinho válido ou sessão atual válida já aberta | Ver mensagens; continuar somente a conversa atual |
| Finalizada | Pedido encerrado do mesmo comprador/loja, com precedência; ou carrinho expirado | Ver mensagens |
| Histórico | Sem evidência operacional suficiente | Ver mensagens; a sessão atual válida pode aparecer em andamento |

“Continuar conversa” revalida comprador, loja, estado, sessão atual e credencial de conversa vinculada à origem. Fecha o Hub, encerra voz/narração e preserva o chat existente e suas mensagens. Não restaura arbitrariamente outras sessões nem emite credenciais a partir de IDs de histórico. A projeção de suporte baseada apenas em chaves globais do navegador foi removida desta aba; o painel de Suporte continua existente.

Leituras de benefícios e conversas são privadas e não armazenadas em cache. Conta/loja alteradas invalidam respostas atrasadas. Em Railway, o proxy conserva a origem pública HTTPS para GET/HEAD de mesma origem sem cabeçalho Origin; origens conflitantes, metadados inválidos e requisições entre sites são recusados. Autenticação e capability continuam obrigatórias.

Não há migração própria desta entrega. O candidato integrado preserva as 74 migrações já presentes no master, incluindo o trabalho concorrente de endereços e checkout, sem modificar as configurações financeiras da Athom.

## Evidência local

As execuções se sobrepõem e não representam contagens cumulativas de testes únicos.

| Verificação | Resultado | Registro local |
| --- | --- | --- |
| Integração completa de execução/benefícios em PostgreSQL isolado | 32/32 | `.audit/revenue-hub-runtime-integration.log` |
| Regressão focal da API após integração do master | 79/79 | `.audit/merged-hub-focal-regression.log` |
| Benefícios no Playwright local, 390/1440 px | 9/9 | `.audit/merged-storefront-ui-857429/benefits-final.log` |
| Conversas no Playwright local, 390/1440 px | 7/7 | `.audit/merged-storefront-ui-857429/conversations-final.log` |
| Autenticação/origem no proxy, usando NextResponse real | 11/11 | `.audit/merged-storefront-ui-857429/storefront-proxy-origin.log` |
| Typecheck e builds API/widget/storefront | Concluídos | `.audit/revenue-hub-merged-*-build.log`, `.audit/revenue-hub-proxy-storefront-build.log` |
| Novo layout de Fidelidade, condições, ID/slug e temas claro/escuro | 21/21 | `.audit/loyalty-redesign-final-20261005.log` |
| Condições legíveis na API e isolamento por merchant | 21/21 | `.audit/loyalty-condition-api-tests.log` |
| Typecheck e builds finais API/widget/storefront | Concluídos | `.audit/loyalty-redesign-final-typecheck.log`, `.audit/revenue-hub-loyalty-*-build.log` |

Os testes locais de interface usam fixtures controladas. A evidência abaixo usa a API e a storefront publicadas, sem interceptar respostas.

## Sandbox publicado e ensaio real

API `cd7c38de-660e-4bdb-b1e6-7e40ee4faf45`, candidata `8b0e9f044d9dee5c9464895b5b55cfc05e323350`: 11 fontes conferidas contra o código comprometido, com normalização exclusiva CRLF/LF; nove arquivos compilados com comportamento esperado; `/ready` HTTP 200 e banco conectado. Storefront `0690a5bf-1eff-4b49-8790-51f534de8547`, candidata `ee2777a8054b751f4eac8d1d092402e98a32e613`, em SUCCESS. Entre essas revisões não houve mudança no backend desta entrega.

A estratégia sintética `a1b3cfea-04d0-4969-a287-8035f0ec0716`, execução `5a7aea20-ba18-4994-b8f6-9d9ac5c0e115`, foi aprovada pelos endpoints oficiais na loja de QA `sbx-revenue-planner-20261005-reject`. Dados e compradores são sintéticos e não pertencem à Athom.

| Fluxo publicado | Resultado | Evidência local |
| --- | --- | --- |
| Checkout oficial de tratamento, controle e holdout | R$ 5 apenas no tratamento; nenhum pagamento; gasto liquidado zero | `.audit/revenue-hub-v2-checkout.log` |
| Login oficial e GET de benefícios | Uma oferta de 500 centavos no tratamento; zero nos demais e em outra loja; repetição estável; cupom ausente das saídas gerais | `.audit/revenue-hub-v2-benefits.log` |
| Fidelidade no navegador autenticado | 6/6 combinações comprador/largura; valor, código e condições reais; zero erros HTTP, console ou página | `.audit/sandbox-revenue-planner-20261005/benefits-browser-2026-10-05T23-26-19-010Z/report.json` |
| Conversas no navegador autenticado | 6/6; estados, mensagens, título e retorno ao chat atual preservado; zero erros HTTP, console ou página | `.audit/sandbox-revenue-planner-20261005/conversations-browser-2026-10-05T23-26-48-606Z/report.json` |
| Storefront pública | 390/1440 px, sem estouro horizontal, artefatos de ofertas e conversas carregados | `.audit/revenue-hub-sandbox-public-artifacts.json` |
| Retirada e encerramento da fixture | Execução retirada e geração de QA pausada por API oficial; histórico preservado | `.audit/revenue-hub-v2-withdraw.log`, `.audit/revenue-hub-v2-pause.log` |
| Leitura após retirada, na API integrada confirmada | Zero ofertas nos três compradores e em outra loja; leituras estáveis | `.audit/revenue-hub-v2-withdrawn-benefits.log` |

Os navegadores usam login oficial por senha e JWT retornado pelo servidor nas chaves normais da aplicação, sem fabricar tokens. A conversa atual utiliza capability emitida pelo endpoint oficial e histórico sintético restaurado pelo mecanismo existente da storefront. O estado “Finalizada” foi exercitado por carrinho expirado; a precedência de pedido encerrado está coberta localmente. Não houve OTP, mensagem à LLM, comunicação externa, pagamento ou liquidação. A primeira visita pode registrar recusas de contato opcional, abertura de sessão e eventos normais da interface; as consultas de benefícios são somente leitura.

## Integração final

Após o PASS, o master avançou de `8e6f7d23` para `eb19645c` com ajustes de checkout em chat, contenção do Pix em telas estreitas e links de políticas do merchant. O merge `98198e5b` preservou essas alterações e não alterou a API de benefícios/conversas. A correção do catálogo usa `storeSlug` na consulta pública de cupons, conservando `merchantId` para APIs autenticadas. O ensaio final utilizou uma loja cujo ID e slug são diferentes.

## Fidelidade e condições: novo layout

A revisão `bd3c6d24b75efc64d2939fb738dd7588a89a9af5` reorganiza Fidelidade em benefícios aplicados, condições para aproveitar ofertas, cupons da loja e histórico de compras expansível. Substitui os cartões de indicadores com relevo por linhas, divisórias e tipografia dos temas existentes. Não inventa pontos, níveis ou saldo a partir do total comprado. Copiar cupom apresenta confirmação e falha; erro de catálogo apresenta tentativa novamente e não é tratado como ausência de cupons.

Progresso em reais ou itens depende de snapshot de carrinho confirmado para o merchant atual. Uma resposta atrasada, troca de loja, limpeza, erro ou atualização do carrinho invalida essa base. Sem snapshot, a interface informa a condição mínima. Atingir o mínimo não promete aplicação do benefício: elegibilidade, produtos, entrega, pagamento e limites continuam validados no checkout. Condições avançadas são descritas em linguagem legível pela API, sem expor expressões técnicas ao comprador.

A API de sandbox `daa945d8-816e-4a57-9e92-ac471bbf6a68`, candidata `4625ba31`, teve 12 fontes e nove verificações de compilados conferidas, com `/ready` HTTP 200 e banco conectado. Seus arquivos de API e pacotes são idênticos aos do candidato `bd3c6d24`. A storefront `fb4c4d73-83e4-42f6-b795-134d8f3746d6`, publicada a partir do arquivo completo de `bd3c6d24`, está em SUCCESS.

| Ensaio do novo layout no ambiente publicado | Resultado | Evidência local |
| --- | --- | --- |
| Fidelidade autenticada, três compradores em 390/1440 px | 6/6, zero erros HTTP/console/página; cupom comum com mínimo R$ 100 e carrinho confirmado R$ 0 apresenta “Faltam R$ 100,00” e progresso 0/100 | `.audit/sandbox-revenue-planner-20261005/benefits-browser-2026-10-05T23-50-37-565Z/report.json` |
| Conversas autenticadas após integração final | 6/6, estados, mensagens e retorno à sessão atual preservados; zero erros HTTP/console/página | `.audit/sandbox-revenue-planner-20261005/conversations-browser-2026-10-05T23-51-14-200Z/report.json` |
| Storefront pública final | 390/1440 px, sem estouro horizontal; textos do novo Hub presentes nos artefatos entregues | `.audit/revenue-hub-sandbox-public-artifacts.json` |
| Encerramento do cupom comum de QA | Cupom pausado, ausente do catálogo, histórico e slug preservados | `.audit/sandbox-revenue-planner-20261005/reject.close-coupon.public.json` |

O cupom comum de R$ 1 foi criado somente na loja sintética para conferir o slug e a condição real do carrinho; não houve resgate. A preparação consultou carrinhos pelo endpoint nativo, que renova seu prazo pelo comportamento existente, sem renovar capabilities. A estratégia v2 continuou retirada, seu orçamento encerrado e a geração de QA desativada. O ensaio confirmou ausência de ofertas retiradas nos três compradores. A aplicação financeira positiva de R$ 5 já foi comprovada no ensaio anterior, com o mesmo reader financeiro; a apresentação positiva do novo layout foi verificada nos testes locais. Não foi reaberta uma estratégia para repetir essa evidência. Frete grátis não estava habilitado na loja sintética; suas condições e unidades foram verificadas localmente, sem anunciar oferta de frete no sandbox.

## Exemplos progressivos e avançados para revisão

Por solicitação do proprietário, os exemplos ficaram somente no sandbox, na loja sintética com slug `sbx-revenue-planner-20261005-reject-store`. O endpoint oficial `PUT /v1/checkout-settings`, com autenticação do tenant e `If-Match`, acrescentou quatro regras ao array originalmente vazio. A configuração vigente da loja de QA é desconto máximo de 5% e margem mínima de 30%; ambos foram preservados. Esses valores são da loja sintética e não alteram os 10%/38% da Athom.

| Exemplo | Condições em conjunto | Desconto | Teto por pedido |
| --- | --- | --- | --- |
| Progressivo: primeira faixa | Produtos a partir de R$ 100 | 1% | R$ 10 |
| Progressivo: segunda faixa | Produtos a partir de R$ 180 | 3% | R$ 15 |
| Progressivo: terceira faixa | Produtos a partir de R$ 300 | 5% | R$ 25 |
| Regra avançada | Produtos a partir de R$ 150, pelo menos dois itens e pagamento por Pix | 5% | R$ 15 |

São faixas por valor implementadas em regras avançadas determinísticas, distintas do incentivo de IA com duas etapas de matrícula/preparação do pagamento. O checkout usa a primeira regra compatível por prioridade: Pix tem prioridade sobre as faixas; entre faixas, o maior patamar tem prioridade. Os descontos não se somam automaticamente. A criação dos exemplos não acionou checkout, LLM, pagamento ou nova aprovação; snapshots confirmaram preservação dos controles financeiros. A estratégia v2 permanece retirada, o motor de QA desligado e o cupom anterior pausado. As quatro regras permanecem habilitadas na loja de teste para revisão.

O candidato `c0115f128264e7d3d398a18b1c797671b7501dc1` acrescenta `BuyerBenefits.conditions`: condições comerciais habilitadas, inclusive as ainda não atingidas, sem declarar elegibilidade ou conceder benefício. A projeção conserva consentimento e isolamento por comprador/loja, compartilha a leitura de regras com `available` e não expõe códigos de cupons. Tetos inválidos excluem a descrição de desconto. O Hub lista os termos em “Condições das ofertas”, separado dos benefícios aplicados. Ausência de snapshot do carrinho não vira um valor faltante inventado.

| Validação final | Resultado | Evidência local |
| --- | --- | --- |
| API local: regras não atingidas, valores inválidos e gates | 17/17; build Nest concluído | Execuções focais e build registrados nesta sessão |
| Interface local com exemplos, 390/1440 px e temas claro/escuro | 28/28; typecheck e build storefront concluídos | `.audit/conditional-offers-ui-20261005.log`, `.audit/revenue-hub-rule-examples-storefront-build.log`; typecheck registrado nesta sessão |
| API publicada `966f11fb-9040-4379-93cc-ddf6995837f1` | SUCCESS; 12 fontes equivalentes ao commit por CRLF/LF; nove verificações de compilados; `/ready` 200, banco conectado | `.audit/hub-source-sandbox-c0115f1-966f11fb.json` |
| Storefront publicada `4f25918c-b286-413d-8b99-7a3a2bacfa8d` | SUCCESS; artefatos com os textos de condições, sem estouro horizontal em 390/1440 px | `.audit/revenue-hub-sandbox-public-artifacts.json` |
| GET oficial dos três compradores | Quatro condições e zero concessões/qualificações em cada conta | `.audit/sandbox-revenue-planner-20261005/reject.rule-examples.benefits.public.json` |
| Navegador autenticado contra API/storefront publicadas | 6/6; percentuais, tetos e condições reais; zero erros HTTP/console/página | `.audit/sandbox-revenue-planner-20261005/benefits-browser-2026-10-06T00-09-10-834Z/report.json` |

A rodada final ocorreu às 21:09 de 05/10 em São Paulo (00:09 de 06/10 UTC). Os testes locais usam exemplos sintéticos e não substituem o ensaio publicado. O navegador usa login oficial, sem interceptar respostas; abriu sessões/eventos normais e registrou recusa de contatos opcionais, sem mensagens à LLM ou operações financeiras. As capturas de revisão usam altura ampliada para mostrar a lista, preservando o componente real; os cenários responsivos também passaram nas alturas normais. A prévia local em `.audit/loyalty-rule-examples-review.html` contém somente capturas e tabela de exemplos, sem credenciais.

## Histórico e limites

Uma tentativa anterior foi interrompida por substituições concorrentes da API (`64849faf`, `1f63f2e8`) durante a validação. A fixture anterior `504053ee-e2b5-4492-9d46-ab16741999f8` foi retirada e preservada; não foi reaberta. O ensaio novo acima confirmou a interface contra a API integrada estável.

Esta entrega não demonstra pagamento externo, receita incremental, lucro ou vencedor estatístico, nem todas as lojas de produção. O motor e seus termos comerciais continuam descritos na [arquitetura](../architecture/revenue-intelligence.md). Arquivos privados, senhas e tokens ficam apenas em `.audit` ignorado e não integram documentação, commits ou uploads.
