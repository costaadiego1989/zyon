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

Por padrão, o seed resolve `costaadiego1989@gmail.com`; `AACP_DEMO_MERCHANT_EMAIL` ou `AACP_DEMO_MERCHANT_ID` permitem apontar outro merchant. Ele só recria o produto reservado `apl_showcase_*` e sua variante demonstrativa. Ao terminar, imprime a rota `/store/<slug>?show=content&product=<id>` para a prévia.

A rota /store/demo é a única storefront permitida para incorporação pelas origens da Zyon; as demais lojas mantêm proteção contra framing.

O estado “Loja ao vivo” depende de uma mensagem do iframe com origem verificada e de uma configuração real do merchant retornada pela API. A tela de fallback local da storefront não ativa esse estado. Para disponibilizar a demonstração, é necessário publicar a correção da storefront, garantir acesso às rotas públicas da API e executar o seed na base de destino. A existência do seed no repositório não significa que ele tenha sido executado em produção.

## Planos

Os planos configurados são Free, Growth e Scale. Valores, limites, recursos e taxas de transação vêm do catálogo de planos da API; a landing reflete a configuração atual:

- **Free**: R$ 0/mês; 100 pedidos e 100 conversas com IA por mês.
- **Growth**: R$ 249/mês; 500 pedidos, 5.000 conversas com IA e recursos avançados.
- **Scale**: R$ 599/mês; pedidos e conversas sem limite, domínio próprio, Revenue Manager e testes A/B.

Taxas de transação da loja: R$ 2,99 no Free (após os primeiros 14 dias), R$ 1,49 no Growth e R$ 0,99 no Scale. O comprador paga R$ 0,99 de serviço por compra. Taxas dos provedores de pagamento são cobradas separadamente.

## Site e identidade

`apps/web/index.html` apresenta o produto, motor de decisão, controle de margem, busca por intenção, conhecimento, voz, Revenue Manager, protocolos UCP/ACP/AP2 e os planos. Estilos e interações ficam em `assets/landing.css` e `assets/landing.js`.

O hero compartilha a imagem do cadastro do dashboard (`bg-hero.webp`) e usa waves que respeitam a preferência por movimento reduzido. A imagem do motor está em `engine-core.webp`. Gráficos e exemplos comerciais são identificados como ilustrativos; não representam resultados de clientes.

## Princípios

- A IA não autoriza condições comerciais fora das regras do merchant.
- Dados de tenant, pagamentos e jornadas financeiras permanecem isolados.
- A comunicação de marketing deve refletir recursos realmente entregues e configurações habilitadas.
- Antes de publicar, confirme o projeto Vercel vinculado: os arquivos .vercel/project.json existentes podem apontar para aplicações diferentes da Zyon.
