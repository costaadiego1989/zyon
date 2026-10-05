# Buyer Hub: benefícios e conversas, 05/10/2026

**Estado deste registro: código local validado; validação da nova entrega no sandbox ainda pendente.** Este documento não confirma publicação em produção nem substitui o [registro anterior do motor](revenue-intelligence-sandbox-2026-10-05.md). O fluxo desta entrega deve concluir a sequência candidato publicado no sandbox, verificação do código em execução, ensaio real e só então promoção.

**Verificação parcial em 05/10, 19h12 de São Paulo:** a API integrada `38e92fd8-4743-40ba-ad65-aff46d5aba33` passou na comparação de 18 fontes com normalização exclusiva de CRLF/LF, nove arquivos compilados e `/ready` HTTP 200. A storefront `d4250107-365a-469d-a037-a683faa7dacd` entregou os novos artefatos em 390/1440 pixels, sem estouro horizontal. O checkout oficial aplicou R$ 5 somente no tratamento; controle e holdout ficaram sem benefício. Login oficial e GET de benefícios confirmaram uma oferta no tratamento, zero nos demais, leituras estáveis e isolamento de outra loja. O cupom estava ausente das saídas gerais e públicas nesse código.

**Validação autenticada da interface ainda não aprovada:** às 19h13 de São Paulo, outra sessão restaurou a API anterior por `64849faf-1119-4e90-a115-a06bad45dda2`. Fontes e compilados corresponderam à imagem antiga, sem leitor de benefícios. O navegador então recebeu o comportamento anterior. Outro envio concorrente (`1f63f2e8-b650-42dc-9cd5-ff3ac0fe3d8e`) também entrou na fila. Esses resultados não demonstram uma falha do novo leitor nem permitem promover o candidato: é necessário estabilizar o ambiente e repetir a interface autenticada com a API integrada confirmada. Nenhum envio desta entrega para produção ocorreu nesta etapa.

A estratégia sintética `504053ee-e2b5-4492-9d46-ab16741999f8`, execução `1c77cfb5-3973-41db-851c-e7644ff7877f`, foi retirada e a geração da loja de QA pausada pelos endpoints oficiais. O histórico foi preservado. A leitura posterior retornou zero ofertas para os três compradores; como a API já havia sido substituída, esse negativo não é apresentado como prova do novo leitor. Uma retomada deve criar um ciclo sintético novo e exigir nova aprovação, preservando a retirada e o orçamento fechado desta tentativa.

## Candidato e escopo

| Parte | Revisão |
| --- | --- |
| API, leitura de benefícios e metadados de conversas | `80087daf5be47abb8c61d3d5e56acdd5e25cefbb` |
| Storefront, apresentação de benefícios e navegação de conversas | `7f2bd121e6f4e407ce3a99ef9a07190c368f3be0` |

O Buyer Hub passa a apresentar o incentivo efetivamente aplicado ao comprador na compra correspondente: valor atual, limite, condições, validade e código quando houver cupom. A consulta é autenticada, vinculada à loja selecionada e somente de leitura. Abrir a conta não matricula o comprador em experimento, não reserva orçamento nem concede desconto. A apresentação preserva as regras existentes de consentimento, audiência, controle, holdout, validade e encerramento. Os termos completos do motor permanecem descritos na [arquitetura de Revenue Intelligence](../architecture/revenue-intelligence.md).

Cupons vinculados a estratégias deixam de aparecer nas três saídas genéricas: lista pública de cupons da loja, ferramenta `list_promotions` e ofertas usadas para gerar intervenções genéricas no chat. Cupons comuns continuam nessas saídas quando válidos e com usos restantes; o painel administrativo mantém acesso aos cupons de estratégia.

A aba Conversas troca o identificador técnico da loja por um título derivado da primeira mensagem do comprador, com alternativa legível usando o nome da loja. Linhas compactas exibem loja, data, quantidade de mensagens e estado; o histórico continua expansível e as mensagens do comprador são identificadas como “Você”. As avaliações permanecem disponíveis. A antiga projeção de suporte por chaves globais do navegador foi removida desta aba porque não comprovava comprador, loja ou estado do ticket; o painel de Suporte permanece existente.

| Estado apresentado | Evidência utilizada | Ações |
| --- | --- | --- |
| Em andamento | Carrinho não expirado, ou conversa atual já aberta no contexto local | Ver mensagens; “Continuar conversa” somente para a sessão atual |
| Finalizada | Pedido encerrado vinculado ao checkout do mesmo comprador e loja, com precedência sobre o carrinho; ou carrinho expirado | Ver mensagens |
| Histórico | Sem evidência suficiente de atividade ou encerramento | Ver mensagens; se for a sessão atual válida, ela pode ser apresentada como em andamento |

“Continuar conversa” verifica novamente o registro autenticado, a loja, a sessão atual e o estado. Também exige a credencial existente da conversa vinculada à origem do storefront. O retorno preserva o mesmo atendimento e suas mensagens, sem chamar a inicialização que substituiria o conteúdo por uma saudação. Sessões com compra encerrada ou carrinho expirado não são retomadas. Esta entrega não oferece restauração genérica de outras conversas nem emite uma credencial a partir de um ID de histórico.

As rotas de lista, detalhe e avaliação respeitam comprador e loja. A lista e o detalhe usam `private, no-store`; troca de conta/loja e respostas atrasadas não devem repovoar o histórico anterior. Nenhuma migração nova integra esta entrega.

## Evidência local conferida

As contagens abaixo pertencem a execuções diferentes e não devem ser somadas como casos únicos.

| Verificação | Resultado | Registro local |
| --- | --- | --- |
| API de conversas, isolamento, estados e regressão do escopo de benefícios | 17/17 passaram | `.audit/conversations-api-tests.log` |
| Leitor de incentivos, integração PostgreSQL | 5/5 passaram | `.audit/buyer-incentive-reader-integration.log` |
| Leitor de incentivos e regressões relacionadas | 60/60 passaram | `.audit/buyer-incentive-reader-tests.log` |
| Filtros de cupom nas saídas genéricas, repetição final | 6/6 passaram | `.audit/strategy-coupon-publicity-final.log` |
| Conversas em Playwright local, 390 e 1440 pixels | 7/7 passaram | `.audit/conversations-browser.log` |
| Typecheck do storefront | Saída zero | `.audit/conversations-storefront-tsc.log` |
| Build do storefront | Concluído, rotas e artefatos gerados | `.audit/revenue-hub-storefront-build.log` |
| Integração completa de execução e benefícios no PostgreSQL isolado | 32/32 passaram | `.audit/revenue-hub-runtime-integration.log` |
| Benefícios no Playwright local, 390 e 1440 pixels | 9/9 passaram | Fixture local de ofertas personalizadas |

Os testes de conversas cobrem título legível, papel do comprador, expansão e fechamento do histórico, retorno à conversa atual, bloqueio de compra já encerrada, revalidação de um estado anteriormente ativo, troca de loja, saída da conta, resposta tardia e erro de carregamento com tentativa novamente. A precedência de pedido encerrado sobre carrinho ainda válido foi conferida no teste de repositório. Os testes locais de UI usam uma fixture com respostas controladas; não comprovam a API publicada.

Capturas locais da lista:

- `apps/storefront/test-results/buyer-conversations-readab-a8d5f-and-current-resume-at-390px/conversations-390.png`.
- `apps/storefront/test-results/buyer-conversations-readab-7a07e-nd-current-resume-at-1440px/conversations-1440.png`.

## Preparação do sandbox e evidência ainda necessária

Na coordenação desta rodada foram informados os deployments de storefront `d4250107-365a-469d-a037-a683faa7dacd` e de API `38e92fd8-4743-40ba-ad65-aff46d5aba33`. Eles são alvos de verificação, não registros de aprovação: readiness e proveniência precisam ser confirmados depois que terminarem. Um envio concorrente anteriormente substituiu o código esperado da API; por isso, o estado `SUCCESS` isolado não comprova a presença desta revisão.

A loja sintética utilizada é `sbx-revenue-planner-20261005-reject`. A preparação comunicada pela coordenação registrou aprovação pela API oficial da estratégia `504053ee-e2b5-4492-9d46-ab16741999f8`, execução `1c77cfb5-3973-41db-851c-e7644ff7877f` e criação das contas sintéticas de tratamento, controle e holdout. No momento de preparação deste registro ainda não havia resultado do checkout desta nova execução. Essa aprovação não é uma decisão comercial para a Athom.

Antes de declarar o ensaio aprovado, registrar:

1. Deployments saudáveis, código e configuração exatos em execução, API `/ready` e frontend ligado à API sandbox correta.
2. PATCH/GET pelo checkout normal aplicando benefício somente ao tratamento, com controle e holdout sem concessão. Conferir atribuição, reserva e ausência de duplicação.
3. Login oficial dos compradores e leitura autenticada de benefícios repetida, sem novas reservas ou concessões causadas pelo GET; verificar isolamento da loja e do comprador.
4. Navegação real nas abas Fidelidade e Conversas do storefront publicado em 390 e 1440 pixels, com relatórios, screenshots, erros de console/rede e requests produzidos pelo navegador.
5. Encerramento da estratégia sintética e pausa da fixture pelos endpoints normais, preservando histórico e verificando que a leitura deixa de oferecer o incentivo retirado.

As evidências parciais desta tentativa estão em `.audit/hub-source-sandbox-7f2bd12-38e92fd8.json`, `.audit/revenue-hub-sandbox-public-artifacts.json`, `.audit/revenue-hub-sandbox-checkout.log` e `.audit/revenue-hub-sandbox-benefits.log`. O diagnóstico da substituição está em `.audit/hub-source-sandbox-7f2bd12-64849faf.diagnostic.json`. A tentativa de navegador não passou e permanece separada dessas provas positivas; os artefatos privados de depuração não integram a publicação.

### Roteiros locais preparados

Os scripts e os relatórios ficam em `.audit/sandbox-revenue-planner-20261005`, fora do Git. O runner `.audit/run-benefits-sandbox.mjs` transporta scripts e credenciais por pipes SSH e salva o bundle somente em arquivo privado ignorado. Não copiar senha, token, payload privado ou arquivo `.private.json` para este documento.

- `benefits-fixture.cjs`, `benefits-api.cjs` e `benefits-browser.mjs`: preparação da estratégia sintética, autenticação oficial, autorização e leitura dos benefícios. A aplicação do desconto acontece pelo checkout normal, não por esses leitores.
- `benefits-conversations-fixture.cjs seed`: utiliza os mesmos compradores sintéticos, obtém uma sessão e credencial pelo endpoint oficial de conversas e prepara três históricos por comprador: atual, expirado e sem estado conhecido. Cria carrinhos sintéticos vazios para os estados atual/expirado. Não envia mensagem à LLM, não altera incentivo e não cria pagamento.
- `conversations-browser.mjs`: usa login oficial por senha e credencial de conversa emitida pelo servidor, sem interceptar respostas. Restaura o estado local sintético pelo mecanismo existente do storefront, consulta a API de histórico, confere os estados, abre mensagens e retorna ao atendimento atual. Registra seis combinações de comprador/largura e captura o chat após o retorno.

O script de Conversas exige que a origem da credencial seja exatamente a origem HTTPS sandbox utilizada no navegador. Um bundle sem a preparação de Conversas é recusado antes do ensaio. O histórico preparado usa mensagens sintéticas; a prova confirma leitura e navegação, não geração dessas mensagens pela LLM. O estado “Finalizada” do roteiro real é exercitado com carrinho expirado. Pedido encerrado e revalidação após encerramento estão cobertos localmente, sem alegar pagamento no sandbox.

O navegador aguarda a hidratação e, quando o diálogo de privacidade inicial aparecer, escolhe “Não aceito” somente para essas contas sintéticas. Essa ação pode registrar preferências de contato desativadas pela API normal; não habilita comunicações. O acesso por senha é realizado pelo endpoint oficial e a sessão retornada é instalada nas chaves normais do frontend: isso não comprova entrega ou verificação de OTP pela interface.

Se os roteiros forem repetidos depois da expiração da credencial/carrinho, devem preservar os registros e falhar explicitamente quando os pré-requisitos deixarem de valer. Não renovar validade de incentivo, reabrir orçamento ou alterar os resultados da fixture para satisfazer uma asserção.

## Limites desta validação

Não foram demonstrados nesta entrega pagamento externo, liquidação, receita incremental, vencedor estatístico, envio de comunicação ou funcionamento de todas as lojas de produção. Os dados do ensaio são sintéticos; aprovação, checkout, isolamento e leitura precisam ser comprovados nas respectivas APIs reais. Preencher os resultados pendentes acima com as evidências efetivamente obtidas antes de registrar a conclusão do sandbox ou a publicação em produção.
