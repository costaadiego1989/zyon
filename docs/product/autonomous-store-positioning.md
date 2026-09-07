# Zyon — loja autônoma para pequenas e médias empresas

Atualizado em 7 de setembro de 2026. Escopo: README, site público (`apps/web`), cadastro do dashboard e demonstração do storefront.

## Posicionamento

A Zyon é uma loja autônoma para pequenas e médias empresas que querem automatizar suas vendas com inteligência artificial. Reúne catálogo, atendimento, negociação, checkout e gestão da operação. A empresa define sua identidade e suas regras comerciais; a IA ajuda o cliente a encontrar produtos e avançar na compra dentro desses limites.

Mensagem principal: **Sua loja vende. Você vai além.**

O checkout é parte da loja. A comunicação começa pelo benefício para quem administra um negócio, sem exigir conhecimento de arquitetura. Busca por intenção, conhecimento, voz, Revenue Manager e protocolos têm seções próprias que relacionam a tecnologia com sua utilidade comercial. Não anunciar integrações com plataformas de terceiros.

## Voz e promessas

- Clara, atenta e segura. Português brasileiro, termos familiares a pequenas e médias empresas.
- Mostrar a experiência real antes de pedir cadastro; CTA principal “Criar minha loja”.
- Explicar o controle do lojista sobre catálogo, condições e limites da IA.
- Não publicar métricas inventadas, depoimentos fictícios, selos, garantias de resultado ou prazos de ativação não comprovados.
- Autonomia não significa descontos irrestritos nem operação sem configuração. Recursos de recuperação, pagamentos e canais dependem dos serviços habilitados e das configurações de cada loja.

## Direção visual

Cena: a pessoa que administra uma pequena empresa abre o site no notebook ao final do expediente e quer experimentar o produto antes de dedicar tempo à implantação.

Manrope conduz a tipografia, com verde mineral, superfícies claras e cenas de produto em verde profundo. Cada capítulo tem uma composição própria: motor com imagem tridimensional, descoberta com fluxo de contexto, voz com esfera e forma de onda, experimentação com gráfico e protocolos em linhas amplas. O objetivo é dar substância ao produto e variedade à leitura sem inventar resultados.

- Hero com a imagem `bg-signup.webp` já usada no cadastro, copiada como `bg-hero.webp`, e waves visíveis.
- Loja ao vivo em uma janela interativa com altura útil, link de abertura externa e estados de conexão explícitos.
- Tipografia ampla, bordas precisas, cantos moderados e movimento com suporte a preferência reduzida.
- Cadastro com os mesmos materiais e mensagem, mantendo autenticação, OAuth e o fluxo existente.
- Planos com descrição de público, recursos, limites e taxas. Growth em superfície clara com CTA verde escuro.
- Mobile com navegação entre capítulos, gráficos legíveis e planos completos em sequência.

## Demonstração

- Tenant exclusivo `mrc_zyon_demo`, slug `demo`, catálogo inicial em português e preços em centavos de reais.
- Seed separado, transacional e repetível; sem apagar lojas, criar contas de acesso ou conectar meios de pagamento.
- Identificar produtos e loja como demonstração. Catálogo e conversa usam os contratos reais do storefront.
- A incorporação deve ser liberada somente para a rota da demo e origens Zyon explícitas. Outras lojas mantêm proteção contra incorporação.
- Verificar a origem e o handshake do iframe; evento de load, isoladamente, não prova que a demo está funcional.

## Infraestrutura verificada

Na Vercel, `zyon-storefront` atende `https://zyon-storefront.vercel.app`; `zyon-dashboard` atende `https://app.zyon-payments.com.br`; `zyon-agentic-checkout`, com raiz `apps/web`, atende `https://www.zyon-payments.com.br`.

O vínculo local `apps/web/.vercel/project.json` aponta para o projeto `web`, associado a Cura Viva. Não usar esse vínculo para publicar a Zyon. Conferir explicitamente o projeto de destino antes de qualquer deploy.

### Diagnóstico da demonstração em 7 de setembro

A consulta inicial encontrou HTTP 500 na storefront e `X-Frame-Options: DENY`. Os logs indicaram conflito de carregamento CommonJS/ES Module. A correção publicada remove a dependência de jsdom no SSR e sanitiza HTML com DOMPurify no navegador, preservando a hidratação. Após a publicação, `/store/demo?embed=1` respondeu 200, sem o cabeçalho DENY e com frame-ancestors restrito às origens Zyon.

A rota `/storefront/demo/config` ainda retorna 404 genérico. A API ativa usa o commit `0518330`, que marca o controller como NonProductionRoute. Os deploys posteriores falharam por um erro de sintaxe em storefront.module.ts: um provider foi inserido dentro de outra factory. A correção foi preparada em uma cópia isolada. A existência da loja ainda não foi consultada na base; nenhum seed foi executado em produção nesta etapa.

A Vercel CLI foi autenticada. Landing, storefront e cadastro foram publicados nos projetos corretos. A publicação da API e execução do seed remoto aguardam a autenticação da Railway CLI. Registro detalhado dos deploys em `.audit/zyon-release/RELEASE.md`.

O handshake de disponibilidade exige configuração real do merchant e origem da janela verificada. A rota `/store/demo` admite incorporação somente pelas origens explícitas da Zyon; não há liberação geral para projetos Vercel.

## Critérios de revisão

README coerente com o código atual; navegação e CTA de cadastro funcionais; demo real com seed repetível; iframe com retorno de disponibilidade e alternativa externa; desktop, tablet e mobile sem overflow; foco visível, contraste legível e waves estáticas em movimento reduzido. Publicação é uma etapa posterior à validação local.
