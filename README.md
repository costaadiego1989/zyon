# Zyon

Zyon é uma plataforma de loja autônoma para pequenas e médias empresas. Ela conecta catálogo, atendimento, checkout e operação em uma experiência contínua: o cliente encontra produtos, tira dúvidas, recebe recomendações e avança para a compra, enquanto o merchant mantém as regras comerciais sob controle.

Autonomia significa operação assistida por IA dentro de limites definidos pelo negócio. A IA conversa e sugere; preços, margem, descontos, pagamento e entrega seguem regras configuradas pelo merchant.

## Capacidades

- **Loja conversacional** — storefront próprio com catálogo, descoberta de produtos e atendimento por IA.
- **Motor de decisão** — contexto da conversa, catálogo e regras comerciais orientam o próximo passo da jornada.
- **Operação com controle** — cada empresa define limites de desconto, elegibilidade de frete e tom da marca.
- **Checkout e pedidos** — carrinho, pagamento, acompanhamento e recuperação de vendas conectados à conversa.
- **Protocolos agentic commerce** — descoberta UCP, sessões de checkout ACP e mandatos AP2 são expostos pela API pública quando habilitados.
- **Painel da empresa** — catálogo, pedidos, clientes, regras e planos em um só lugar.
- **Conhecimento e voz** — busca por intenção, materiais da loja e conversa por voz, conforme o plano e a configuração.
- **Inteligência comercial** — Revenue Manager e experimentação A/B para avaliar estratégias; resultados dependem de dados e critérios de medição válidos.

## Motor de inteligência comercial

O Revenue Manager analisa os dados de cada loja elegível uma vez por semana, distribuindo as análises pela madrugada e respeitando limites diários de processamento e consumo de IA. O motor pode recomendar comunicação, desconto percentual, valor fixo, cupom, desconto no frete ou etapas progressivas; também pode manter a estratégia atual ou aguardar mais dados. O dashboard notifica o merchant, que revisa uma proposta pronta, aprova, recusa ou pede uma alternativa; uma nova versão exige nova aprovação.

No modo automático, o lojista não precisa preencher orçamento, desconto por compra e quantidade de usos. O motor calcula esses valores com custos, margem e amostra viável, e os apresenta na própria proposta. A LLM usa a ferramenta `submit_revenue_strategy` para selecionar uma opção previamente simulada pelo servidor e explicar a escolha. A ferramenta cria uma proposta para revisão, sem ativar descontos. Tetos manuais continuam disponíveis como configuração avançada e nunca são aumentados silenciosamente; a opção de desativar propostas financeiras é preservada.

O limite diário de IA é uma proteção para o consumo variável das APIs LLM, não uma cobrança fixa por loja ou por dia. Gerar recomendações e respostas pode consumir tokens; coletar métricas, verificar margens e aplicar regras são operações determinísticas, sem uma chamada à LLM por medição. O gasto efetivo depende do uso e da tarifa configurada, e o teto não obriga gastar o valor reservado.

As condições comerciais são calculadas pelo servidor e verificadas pelas regras de margem, pelo orçamento e pelo estado atual do checkout. Aprovar uma comunicação não autoriza um desconto: o incentivo tem aprovação específica. Se um benefício expirar antes do pagamento, o comprador vê o novo total e precisa confirmar novamente.

Depois da aprovação comercial, o motor autoriza exatamente a exposição mostrada, cria e aplica o benefício aos compradores elegíveis, controla prazo, limite por compra e quantidade de usos, registra reservas e pagamentos e apresenta as métricas. Cupons criados pela estratégia ficam vinculados a esses controles. Descontos progressivos usam etapas aprovadas e eventos internos do checkout, com reserva pelo teto e gasto pelo desconto efetivamente utilizado. O merchant não precisa cadastrar o cupom nem ajustar o motor para cada comprador. A IA não aumenta uma exposição aprovada nem substitui as regras de margem e frete da loja.

Os valores usados nas análises e nos testes internos servem para simulação e não geram cobrança ao merchant. Sugerir ou configurar os limites não cobra valores nem inicia uma promoção. Ao aprovar uma estratégia para vendas, o merchant autoriza os descontos reais apresentados na proposta; quando utilizados, eles reduzem o valor recebido pela loja e não representam uma cobrança da Zyon. Sem dados suficientes, custo conhecido ou viabilidade de amostra, não há opção financeira para aprovar. A loja ainda pode receber sugestões de comunicação quando existir evidência suficiente para esse teste.

O comprador vê no checkout o desconto efetivamente aplicado, com percentual e teto em reais quando cabíveis. No hub, “Cupons da loja” reúne cupons gerais; “Oferta para este pedido” aparece somente para um benefício ativo já concedido ao comprador naquele checkout. A leitura não cria descontos nem reserva orçamento. Cupons de estratégias ficam fora da lista pública e dos grupos de controle; pagamento, expiração, retirada, consentimento e regras comerciais continuam sendo verificados pelo servidor.

A aba Fidelidade prioriza benefícios e condições de uso. Com um carrinho confirmado pela API, mostra quanto falta em reais ou itens para a próxima condição, conforme a regra da loja; sem carrinho confirmado, mostra somente o mínimo exigido. Atingir o valor mínimo de um cupom ou frete não significa aplicação garantida: produtos, entrega, pagamento e limites continuam sujeitos à validação do checkout. O resumo de compras fica disponível como histórico, sem inventar pontos ou níveis.

Cada estratégia tem métricas de execução, conversão e cobertura de custos. O Revenue Lift complementa essa leitura com a comparação entre grupos, sem tratar ausência de dados como ganho zero ou aumento de receita como lucro comprovado. O aprendizado entre lojas usa somente evidência madura e agregada de pelo menos cinco lojas independentes e compatíveis; com apenas uma loja, não há transferência de aprendizado.

No hub do comprador, as conversas aparecem com título, nome da loja e estado verificado pela API. O comprador pode consultar mensagens e avaliações do histórico e continuar a conversa atual quando ela permanece em andamento. Conversas encerradas ou expiradas ficam disponíveis para consulta; a lista não troca silenciosamente de sessão nem recria uma conversa antiga.

A aba Rastreio apresenta somente entregas de produtos físicos com código de rastreamento válido. Compras digitais, serviços, retirada e códigos internos de preparação não aparecem como entregas rastreáveis; todos os itens continuam no histórico de Pedidos. Em compras mistas, o rastreio descreve apenas os itens físicos. A leitura usa a loja e o comprador autenticado, com status, transportadora e eventos recebidos da operação, sem inventar previsão de entrega ou transportadora.

A entrega de benefícios e navegação do hub tem um [registro próprio de validação](docs/product/revenue-buyer-hub-sandbox-2026-10-05.md). No sandbox publicado, o checkout aplicou R$ 5 somente ao comprador elegível, com isolamento de loja, controle e holdout. O novo layout de Fidelidade passou em celular e desktop com o carrinho real indicando o valor que falta para atingir a condição de um cupom. Conversas passou na consulta de mensagens, apresentação dos estados e retorno à sessão atual. Condições de ofertas avançadas também podem aparecer antes de serem atingidas, sem representar um benefício concedido. O código foi promovido em `29ebd92` após essa validação: API com fontes/compilados conferidos e banco conectado, storefront READY e artefatos do Hub entregues no domínio público da Athom em 390/1440 px. Os exemplos de descontos progressivos por faixa e regra de Pix ficaram somente na loja sintética do sandbox para revisão visual; não foram criados na Athom.

Consulte a [arquitetura do Revenue Intelligence](docs/architecture/revenue-intelligence.md) para fluxos, módulos, tabelas, configurações, limites de medição, observabilidade e rollback. Os recursos dependem das flags e da elegibilidade da loja; a existência do código não confirma sua ativação em produção.

**Ativação anterior em 05/10/2026, às 18:27 UTC:** API e dashboard publicados e verificados, com geração semanal, planejador por ferramenta, limites sugeridos e operação de comunicação/cupons/descontos/frete/progressivos habilitados somente para a Athom. A loja usa o modo automático: a IA propõe os limites e a aprovação autoriza os termos exatos. Permanecem desconto máximo de 10% e margem mínima de 38%. O experimento antigo foi encerrado por autorização do proprietário. A loja continua sujeita aos critérios de dados, amostra e aprovação de cada estratégia; nenhum novo teste comercial foi iniciado na publicação. Veja o [registro de ativação](docs/product/revenue-intelligence-activation-2026-10-05.md) para distinguir configuração publicada, validação local e execução comercial real. O [registro de 29/09](docs/product/revenue-intelligence-production-2026-09-29.md) permanece como histórico.

**Publicação anterior do motor, verificada em 05/10/2026 às 21:12 UTC:** revisão `cb50ba9` publicada em produção depois da validação de sandbox, com API saudável e dashboard entregue. Foram preservados o modo automático, o escopo da Athom, o desconto máximo de 10% e a margem mínima de 38%. O limite produtivo permanece em uma análise iniciada por dia, USD 0,05 por dia e por ciclo e USD 1 por mês. A inspeção somente leitura encontrou zero novas estratégias, aprovações ou execuções comerciais; não foi iniciado checkout nem teste comercial em produção para verificar a entrega. As evidências e seus limites estão no [registro de sandbox e publicação](docs/product/revenue-intelligence-sandbox-2026-10-05.md).

### Publicação do motor

Toda alteração do motor segue esta ordem: **publicar no sandbox → validar o fluxo real no ambiente publicado → promover para produção**. Registre a revisão candidata, os deployments, as migrações e a configuração relevante; valide no navegador a notificação, os detalhes da proposta, a decisão do merchant e as métricas aplicáveis, usando dados sintéticos e sem PSP real. Build, testes locais e `/ready` complementam essa evidência, mas não encerram a validação do fluxo.

Promova somente a revisão e o escopo efetivamente validados. O sandbox pode conter trabalho concorrente: não copie todo o ambiente nem promova migrações extras sem revisão. Mudanças no candidato ou na configuração relevante exigem repetir a validação afetada. Após publicar, confirme a revisão em execução, a saúde da API e os artefatos do dashboard. O [registro de sandbox de 05/10](docs/product/revenue-intelligence-sandbox-2026-10-05.md) distingue o que já passou das pendências; a publicação anterior do motor ocorreu antes dessa rodada de validação em sandbox.

**Validação de 05/10:** o candidato integrado `cb50ba9` passou no sandbox com geração e revisão reais, decisões do merchant, proveniência conferida, dashboard em 1440/390 pixels e checkout repetido na API integrada. O ensaio usou dados sintéticos, sem pagamentos, e preservou o histórico após seu encerramento. O envio ao `master` ocorreu depois desse PASS; a publicação de produção foi confirmada por proveniência da API, saúde e artefatos públicos do dashboard. Não houve login de merchant ou fluxo comercial em produção nessa inspeção.

## Estrutura

~~~text
apps/
  api/          NestJS + Prisma + PostgreSQL; regras, catálogo e operação
  dashboard/    Console do merchant em React
  storefront/   Loja pública conversacional em Next.js
  web/          Landing page institucional estática
  widget_v2/    Widget embarcável de atendimento e compra

packages/
  shared-types/          Contratos TypeScript compartilhados
  rules-engine/          Regras comerciais determinísticas
  decision-engine/       Próximo passo da conversa
  conversation-engine/   Orquestração e segurança do agente
  shipping-engine/       Regras e cotações de entrega
~~~

Leia a [documentação do produto](docs/README.md) antes de alterar jornadas comerciais. O posicionamento atual da marca e da landing está em [docs/product/autonomous-store-positioning.md](docs/product/autonomous-store-positioning.md).

## Desenvolvimento

Pré-requisitos: Node.js atual, pnpm, PostgreSQL e as variáveis de ambiente de cada aplicação.

~~~bash
pnpm install
pnpm --filter @zyon/api dev
pnpm --filter @zyon/dashboard dev
pnpm --filter @zyon/storefront dev
~~~

Execute verificações por aplicação:

~~~bash
pnpm --filter @zyon/api typecheck
pnpm --filter @zyon/api test
pnpm --filter @zyon/dashboard build
pnpm --filter @zyon/storefront build
~~~

## Loja demo

A landing incorpora a loja de demonstração em:

~~~text
https://zyon-storefront.vercel.app/store/demo?embed=1
~~~

Para criar ou atualizar os dados da demo em uma base permitida, configure DATABASE_URL para essa base e execute:

~~~bash
pnpm --filter @zyon/api seed:demo-store
~~~

O seed é idempotente e usa o merchant mrc_zyon_demo. Ele cria categorias, seis produtos, estoque, mídia e regras comerciais sem desconto. Não aponte DATABASE_URL para uma base que não deva receber os dados da demo.

## Showroom de layout avançado

Para criar uma página de produto preenchida com blocos, FAQ, avaliações e vídeos no merchant do owner configurado, execute em uma base permitida:

~~~bash
pnpm --filter @zyon/api seed:advanced-layout
~~~

Por padrão, o seed resolve `costaadiego1989@gmail.com`; `AACP_DEMO_MERCHANT_EMAIL`, `AACP_DEMO_MERCHANT_ID` ou `AACP_DEMO_MERCHANT_SLUG` permitem apontar outro merchant. Ele só recria os três itens reservados `apl_showcase_*` e `apl_crosssell_*`, suas variantes e promoções complementares. Ao terminar, imprime a rota `/store/<slug>?show=content&product=<id>` para a prévia.

A rota /store/demo é a única storefront permitida para incorporação pelas origens da Zyon; as demais lojas mantêm proteção contra framing.

O estado “Loja ao vivo” depende de uma mensagem do iframe com origem verificada e de uma configuração real do merchant retornada pela API. A tela de fallback local da storefront não ativa esse estado. Para disponibilizar a demonstração, é necessário publicar a correção da storefront, garantir acesso às rotas públicas da API e executar o seed na base de destino. A existência do seed no repositório não significa que ele tenha sido executado em produção.

## Planos

Os planos configurados são Free, Growth e Scale. Valores, limites, recursos e taxas de transação vêm do catálogo de planos da API; a landing reflete a configuração atual:

- **Free**: R$ 0/mês; 100 compras confirmadas por mês.
- **Growth**: R$ 349/mês; 500 compras confirmadas por mês, domínio próprio, voz e recursos avançados.
- **Scale**: R$ 599/mês; compras sem limite mensal, Revenue Manager e testes A/B. Alto consumo e integrações especiais sob consulta.
- **Anual**: desconto configurável na API (15% por padrão), pago de uma vez; cotas de compras continuam mensais. Consulte [operação do faturamento anual](docs/annual-billing.md).

Taxas de transação da loja: R$ 2,99 no Free (após os primeiros 14 dias), R$ 1,49 no Growth e R$ 0,99 no Scale. O comprador paga R$ 0,99 de serviço por compra. Taxas dos provedores de pagamento são cobradas separadamente.

## Site e identidade

`apps/web/index.html` apresenta o produto, motor de decisão, controle de margem, busca por intenção, conhecimento, voz, Revenue Manager, protocolos UCP/ACP/AP2 e os planos. Estilos e interações ficam em `assets/landing.css` e `assets/landing.js`.

O hero compartilha a imagem do cadastro do dashboard (`bg-hero.webp`) e usa waves que respeitam a preferência por movimento reduzido. A imagem do motor está em `engine-core.webp`. Gráficos e exemplos comerciais são identificados como ilustrativos; não representam resultados de clientes.

## Princípios

- A IA não autoriza condições comerciais fora das regras do merchant.
- Dados de tenant, pagamentos e jornadas financeiras permanecem isolados.
- A comunicação de marketing deve refletir recursos realmente entregues e configurações habilitadas.
- Antes de publicar, confirme o projeto Vercel vinculado: os arquivos .vercel/project.json existentes podem apontar para aplicações diferentes da Zyon.
