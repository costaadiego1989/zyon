# Checkout widget_v2: neumorphism com layout preservado

> Decisão de design: adotada em 13/09/2026.
> Status: material implementado; verificações locais concluídas em 14/09/2026, com limites registrados no relatório.
> Escopo: toda a UI de apps/widget_v2, responsável pelo checkout.

## Decisão compartilhada

O widget_v2 segue a mesma [decisão de design do storefront e checkout](../storefront/design.md): aplicar neumorphism aos elementos existentes, preservando a estrutura atual da UI.

Esse documento compartilhado é a fonte dos papéis de elevação, linguagem visual, estados de interação, temas, acessibilidade e critérios de aceite. Esta referência local explicita sua aplicação ao widget_v2 e evita manter duas especificações visuais divergentes.

A decisão vale para o checkout em todas as integrações suportadas, incluindo sua abertura pelo storefront. Dentro deste escopo, prevalece sobre propostas de reorganização do [DESIGN.md geral](../../DESIGN.md).

## Aplicação no checkout

- Aplicar o tratamento a botões, cards, containers, campos, ícones, conversa, carrinho, controles de etapa, seleções de pagamento e superfícies auxiliares existentes.
- Preservar o layout próprio do widget_v2: posições, dimensões, espaçamentos, tipografia, hierarquia do DOM, ordem de foco, rolagem e breakpoints.
- Manter a distribuição atual entre conversa e resumo no desktop e os mecanismos atuais de carrinho e navegação no mobile.
- Preservar etapas, textos, validações, autenticação, consentimentos, cálculos, integrações e estados de pagamento.
- Compartilhar a aparência dos elementos com o storefront, respeitando a marca de cada merchant e a preferência atual de tema.
- Validar cada tela contra sua própria captura anterior. A imagem conceitual orienta o material visual, não a organização do checkout.

## Pontos de integração

- [CheckoutLayout.tsx](src/layouts/CheckoutLayout.tsx): composição atual, paleta local e aliases de tema.
- [ChatPanel.tsx](src/components/ChatPanel.tsx): apresentação da conversa e controles relacionados.
- [SmartCart.tsx](src/components/SmartCart.tsx): apresentação dos itens e resumo financeiro.
- [InlineCheckout.tsx](src/InlineCheckout.tsx): composição do checkout integrado.

Alterar apenas estilos globais do storefront não garante o resultado no widget_v2. A implementação deve considerar sua própria paleta e os estilos dos componentes, mantendo o comportamento existente.

Aplicar os critérios de aceite da diretriz compartilhada às telas e estados pertinentes ao checkout, incluindo temas claro e escuro, desktop e mobile, teclado, foco, carregamento, erros e estados de pagamento disponíveis para validação. Registrar separadamente o que foi implementado, o que foi verificado e o que permaneceu sem comprovação.


## Refinamentos e validação

Aplicar também os refinamentos da seção 11 da diretriz compartilhada: ações em pílula, controles de fechar com o material do header, navegação plana e um único contorno de foco por campo ou container. O composer independente do checkout mantém seu próprio foco.

A implementação compartilha `src/design-system/neumorphism.ts` e `src/styles/neumorphism.css`, distribuídos pelo skin existente no checkout integrado e standalone. Consultar as [evidências e limitações da validação local](../storefront/neumorphism-validation.md).


## Refinamento dos campos, 14/09/2026

O rebaixo compartilhado passa a ser curto e discreto, sem cantos escuros profundos. O composer do checkout usa `--aacp-inset-bg`, com tom menos esverdeado no escuro, e conserva seu foco independente. Os placeholders usam o token de texto discreto com opacidade explícita. Ver também a seção 13 da diretriz do storefront.


## Controles compostos e sobreposições, 14/09/2026

Aplicar a seção 14 do design do storefront: ações em pílula; opções compostas com material choice; seletores e navegação com superfície apropriada; sombras curtas e sem camadas redundantes. Os formatos não são aplicados a qualquer botão por um seletor global.

No mobile, a posição do suporte e do carrinho acompanha o topo real do composer, inclusive quando as preferências de contato ou o modo de voz alteram a altura do rodapé. O convite de suporte fica ao lado do seu botão e não sobre o carrinho. A sheet do carrinho cobre os controles flutuantes e abre pela borda inferior, em toda a largura disponível.

O breakpoint de carrinho é 640 px, coerente com CheckoutLayout. Regras antigas de drawer lateral não podem sobrescrever a geometria da sheet. O suporte respeita a posição de abertura definida pelo componente e a altura disponível da viewport.


## Material da conversa, 14/09/2026

Aplicar a seção 15 do storefront: envio com papel send, balões message, carrinho floating e contador counter. O envio desabilitado mantém sua superfície; a cor do ícone ou texto comunica indisponibilidade. Balões do comprador usam o tom da marca sobre a superfície neutra. Chat e suporte compartilham o mesmo acabamento, sem alterar as funções de envio, pagamento ou carrinho.


## Ações e contornos contínuos, 14/09/2026

Aplicar a seção 16 do storefront: ações primary com face neutra, relevo médio e texto na cor legível da marca. Container e campo de conversa recebem contornos independentes de 1 px que percorrem todo o perímetro, com ciclos de 4 s e 5 s. O foco permanece no único contorno do campo, sem acrescentar outline ou sombra interna. O suporte usa o mesmo acabamento.

PerimeterBorder e perimeter-border.css recuperam o shimmer em gradiente no ShimmerBorder. Animar o ângulo com propriedade CSS exclusiva, sem girar o retângulo e sem compartilhar keyframes com outros efeitos. A camada decorativa fica abaixo do conteúdo e dos painéis opacos. Distribuir os estilos pelo pulse-skin.css também para os consumidores da biblioteca. Para o shimmer solicitado, movimento reduzido usa ciclos mais lentos de 8 s e 10 s, sem desativá-lo. Manter as regras de movimento reduzido dos demais elementos e as cores forçadas; não alterar etapas, validações ou ações comerciais para obter o efeito visual.
