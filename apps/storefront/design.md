# Storefront e checkout widget_v2 AACP/Zyon: neumorphism com layout preservado

> Decisão de design: adotada em 13/09/2026.
> Status: material implementado; verificações locais concluídas em 14/09/2026, com limites registrados no relatório.
> Escopo: apps/storefront e apps/widget_v2, incluindo suas telas, componentes e superfícies auxiliares.
> Referência de identidade: loja Athom Technologies, assistente Zyon.
> Registro: produto.

## 1. Decisão central

Aplicar neumorphism aos botões, cards, containers, campos, controles e ícones existentes, preservando a estrutura atual da UI.

A decisão vale igualmente para o storefront e para todo o `widget_v2`, aplicação responsável pelo checkout. Cada aplicação conserva seu próprio layout atual. O checkout segue esta diretriz em qualquer integração suportada, e não apenas quando aberto pelo storefront.

O comprador deve reconhecer a mesma loja e encontrar cada função no mesmo lugar. A transformação será percebida no material das superfícies, nas sombras, nas bordas e no feedback dos controles.

A imagem conceitual aprovada na conversa orienta a aparência dos elementos. Sua composição em vários painéis, proporções e organização das telas não constituem especificação de layout. O print da Athom fornecido pelo usuário é a referência visual inicial de estrutura; antes de implementar, registrar as demais telas da versão que será alterada.

A orientação expressa do usuário é: “não quero que mude o layout só transforme os elementos botões, cards, containers, ícones e etc nesse estilo”.

## 2. Precedência e limites

Esta decisão prevalece sobre propostas de reorganização presentes no [DESIGN.md geral](../../DESIGN.md) dentro deste escopo. Os princípios de clareza, identidade do merchant e acessibilidade do [PRODUCT.md](../../PRODUCT.md) continuam aplicáveis.

A proposta anterior de Transaction Dock, novo palco conversacional, substituição dos FABs, reorganização de sheets e nova tipografia não faz parte desta atualização. Também não se exige migração de arquitetura, novo contrato de tema ou refatoração do fluxo para adotar o estilo.

Este documento registra a decisão aplicada ao código e os refinamentos aprovados durante a revisão. As evidências locais não comprovam comportamento em produção.

## 3. Estrutura que deve ser preservada

| Área | Elementos e comportamento a preservar |
| --- | --- |
| Entrada da loja | Modos de entrada existentes, conteúdo, ordem e transição para a conversa. |
| Header | Logo, identificação da loja, status Online e controles de voz, tema, conta e suporte em suas posições atuais. |
| Conversa | Ordem das mensagens, alinhamentos, largura das bolhas, avatar/orb do agente e rolagem. |
| Respostas rápidas | Mesmos atalhos, textos, ordem, distribuição, espaçamento e quebra de linha no mesmo viewport. |
| Catálogo no chat | Cards e carrosséis inseridos na conversa, com suas mídias, informações, variantes e ações. |
| Produto | Overlay atual, galeria, detalhes, avaliações, variantes e ação de adicionar ao carrinho. |
| Carrinho | FAB, abertura em sheet, itens, quantidades, resumo financeiro e CTA existentes. |
| Identificação | Diálogo e sequência atual de autenticação, campos, ações e retorno ao fluxo. |
| Checkout integrado | Distribuição atual de conversa e resumo, etapas, formulários, métodos de pagamento e adaptação mobile. |
| Superfícies auxiliares | Conta, suporte, pedidos, políticas e seus mecanismos atuais de abertura e fechamento. |
| Composer e rodapé | Posição do campo, ação de envio, identidade legal e área disponível para leitura. |

Manter hierarquia do DOM, ordem de foco, medidas, padding, margin, gap, proporções, alinhamentos, limites de largura, posicionamento e breakpoints. Preservar fontes, tamanhos, pesos e entrelinhas para evitar mudanças de métricas e de quebra de texto.

Classes e variáveis de estilo podem ser adicionadas aos elementos existentes. Não inserir wrappers nem substituir componentes para obter o efeito. Preservar handlers, propriedades funcionais, validações, rotas, estados e condições de renderização.

## 4. Linguagem visual

Uma pessoa compra no celular, alternando entre luz natural e ambientes internos, e precisa ler mensagens, preços e ações com rapidez. O material suave deve continuar legível nessas condições.

- Superfícies claras com aparência de porcelana, em neutros discretamente tingidos pela identidade da loja.
- Luz consistente vindo do canto superior esquerdo: realce suave nesse lado e sombra no inferior direito.
- Relevo baixo, sem aparência de plástico inflado, metal ou objeto 3D.
- Verde da Athom como acento nas ações e seleções existentes; logo azul e identidade original preservados.
- Texto escuro e nítido, sem sombra, relevo ou gradiente nas letras.
- Separadores discretos, mantidos onde ajudam a ler mensagens, campos e valores.
- Ações em pílula, ícones arredondados e abas planas conforme a seção 11. Preservar os recortes da mídia e os raios dos demais containers.

O material deve parecer contínuo entre as telas. Isso não obriga todos os elementos a receber a mesma intensidade de sombra.

## 5. Aplicação por componente

| Componente | Tratamento visual |
| --- | --- |
| Shell e header | Superfície neutra uniforme; separação suave usando bordas existentes e relevo discreto. |
| Bolhas do agente | Relevo baixo que conserva leitura e distinção entre mensagens. Não dar a um texto estático aparência de botão. |
| Bolhas do comprador | Preservar distinção de autoria e identidade cromática, com contraste de texto validado. |
| Orb do agente | Harmonizar sua moldura e luz com as superfícies; preservar identidade, tamanho, posição e comportamento. |
| Quick replies e botões secundários | Superfície elevada com sombra dupla curta; aparência pressionada durante a interação. |
| Botão primário | Acento sólido da loja, texto contrastante e relevo contido. Preservar a hierarquia atual das ações. |
| Botões de ícone | Relevo curto e forma arredondada no botão existente; controles de fechar seguem o material do header, preservando ícone e alvo. |
| Ícones informativos | Preservar desenho e significado; ajustar cor se necessário. Não criar molduras clicáveis para ícones estáticos. |
| Cards de produto | Elevação média no card externo; mídias, textos e preços mantêm dimensões, recortes e posições. |
| Variantes e seleções | Opção selecionada com rebaixo, borda e indicador existente; opções disponíveis com relevo leve. |
| Inputs e composer | Superfície rebaixada com sombra interna curta e contorno legível. Campo e botão de envio conservam medidas. |
| Carrinho e demais sheets | Superfície coesa com elevação externa mais marcada; linhas internas e ledger com pouca decoração. |
| Diálogo de identificação | Mesmo material das sheets, campos rebaixados e ações consistentes com o storefront. |
| Métodos de pagamento | Seleção perceptível por contorno e indicador, além do relevo. Preservar sinais de processamento, erro e confirmação. |
| Badges e avisos | Baixa elevação e semântica atual. Online, estoque, oferta ou sucesso só refletem estados reais. |

Se já houver containers aninhados, manter a estrutura e reduzir o relevo das camadas internas. Não adicionar novas caixas decorativas. Fotografias, logotipos, QR Codes e conteúdo de pagamento permanecem sem filtros, distorções ou sombras internas sobre a mídia.

## 6. Tokens e integração

O storefront já utiliza variáveis `--aacp-*`. Evoluir a camada existente, com valores semânticos centralizados, em vez de espalhar sombras e cores por componente.

Pontos de integração conferidos no código:

| Arquivo | Responsabilidade |
| --- | --- |
| [globals.css](src/app/globals.css) | Cores, fontes, raios e sombras base do storefront. |
| [theme-tokens.ts](src/components/conversation/theme-tokens.ts) | Valores dos modos claro e escuro na conversa. |
| [page.tsx](src/app/store/[slug]/page.tsx) | Cores derivadas e variáveis aplicadas a partir da configuração da loja. |
| [ConversationShell.tsx](src/components/ConversationShell.tsx) | Composição da experiência e abertura de superfícies. |
| [ProductCardBlock.tsx](src/components/blocks/ProductCardBlock.tsx) | Apresentação dos produtos na conversa. |
| [RichProductDetailsPanel.module.css](src/components/blocks/RichProductDetailsPanel.module.css) | Aparência do detalhe rico do produto. |
| [CartSummaryBlock.tsx](src/components/blocks/CartSummaryBlock.tsx) | Apresentação do resumo do carrinho. |
| [BuyerAuthGate.tsx](src/components/BuyerAuthGate.tsx) | Superfície de identificação. |
| [CheckoutPanel.tsx](src/components/CheckoutPanel.tsx) | Entrada no checkout integrado. |
| [CheckoutLayout.tsx](../widget_v2/src/layouts/CheckoutLayout.tsx) | Paleta local e aliases de tema do checkout V2. |

O checkout V2 também usa aliases como `--bg`, `--tx`, `--bd`, `--card` e `--chip`. Sua paleta local precisa ser considerada: alterar apenas o CSS global do storefront não garante continuidade visual.

Preservar o contrato de personalização do merchant. O verde Athom não deve ser fixado para todas as lojas. Novas cores neutras e de sombra devem ser definidas por tema, preferencialmente em OKLCH, sem alterar a escolha atual do modo claro ou escuro.

### Papéis de elevação implementados

| Token | Uso |
| --- | --- |
| `--aacp-neu-raised-sm` | Quick replies, botões secundários e botões de ícone. |
| `--aacp-neu-raised-md` | Cards e superfícies de conteúdo que já existem. |
| `--aacp-neu-inset` | Campos, composer e superfície selecionada. |
| `--aacp-neu-pressed` | Feedback temporário de botão pressionado. |
| `--aacp-neu-overlay` | Contorno externo das sheets e diálogos existentes. |

Esses tokens estão implementados no material compartilhado do widget_v2. Usar os tokens semânticos de cor para texto, borda, acento e estados.

Calibrar intensidade e alcance das sombras com as telas reais. Em controles próximos, reduzir a sombra para que não invada o vizinho. Não aumentar espaçamento, padding ou dimensões para acomodar o efeito. Manter a espessura de bordas existentes; usar outline ou sombra interna quando precisar reforçar um estado sem alterar geometria.

## 7. Estados de interação e temas

- **Padrão:** relevo proporcional ao papel do componente e rótulo sempre legível.
- **Hover:** pequena variação de sombra ou superfície, sem deslocar, ampliar ou redimensionar o elemento.
- **Pressed:** reduzir elevação ou aplicar sombra interna temporária. Não confundir pressionado com selecionado.
- **Focus-visible:** contorno explícito que continua visível além do efeito de luz e sombra.
- **Selecionado:** manter indicador, rótulo e semântica atuais; complementar com contorno e rebaixo.
- **Disabled:** reduzir relevo, preservar legibilidade e respeitar o bloqueio funcional existente.
- **Loading:** preservar indicador, texto, medidas e comportamento atuais; não usar a atualização visual para trocar o mecanismo de carregamento.
- **Erro, aviso e sucesso:** preservar mensagem e sinalização semântica. O relevo não substitui essas informações.

No modo escuro, usar superfícies escuras com realces contidos e separação legível. Não inverter simplesmente as cores do modo claro nem usar brilho branco intenso. Preservar seleção e persistência do tema atual.

Manter as animações funcionais existentes. Novas transições de cor ou relevo devem ser curtas, discretas e respeitar movimento reduzido; não animar dimensões ou espaçamentos.

## 8. Legibilidade e acessibilidade

Cumprir os objetivos de acessibilidade do PRODUCT.md. Sombras suaves são decoração complementar, nunca a única forma de reconhecer campo, botão, seleção ou estado.

- Validar contraste de texto, ícones, contornos e foco nos temas aplicáveis.
- Preservar labels, nomes acessíveis, roles, mensagens de erro, ordem de tabulação e retorno de foco.
- Manter preços, totais, taxas, descontos e condições com leitura imediata.
- Testar zoom de 200%, teclado, toque, movimento reduzido e alto contraste.
- Em forced colors ou quando sombras não estiverem disponíveis, manter controles reconhecíveis por contorno e indicadores.
- Não reduzir alvos de interação existentes. Se a revisão encontrar uma deficiência anterior que exija mudar medidas ou estrutura, registrá-la como correção separada.
- Evitar sombra extensa em cada mensagem ou linha financeira; reduzir custo de pintura e ruído visual.

## 9. Aplicação integral ao checkout widget_v2

O `apps/widget_v2` adota a mesma decisão de design em toda a sua UI: botões, campos, cards, containers, ícones, conversa, carrinho, formulários e superfícies auxiliares. Sua composição, dimensões, espaçamentos, tipografia, sequência de etapas e comportamento responsivo atuais permanecem como referência.

A referência local está em [design.md do widget_v2](../widget_v2/design.md). Os papéis de elevação, estados de interação, temas e critérios de aceite deste documento também governam o checkout. Preservar a distribuição atual entre conversa e resumo no desktop e os mecanismos atuais de carrinho e navegação no mobile.

Esta atualização não altera cálculos, preços, descontos, frete, estoque, consentimentos, autenticação, integração com provedores ou estados de pagamento. Também não adiciona promessas comerciais ou de segurança.

As telas de pagamento mostradas na imagem conceitual ilustram o tratamento visual. A implementação real e os estados disponíveis precisam ser conferidos no fluxo antes de estilizar cada etapa. A validação do documento não equivale a executar um pagamento.

## 10. Critérios de aceite e manutenção

1. Registrar capturas de referência, com os mesmos dados, estado, fontes carregadas e viewport antes e depois.
2. Comparar posições e dimensões do header, mensagens, atalhos, cards, FAB, composer, sheets e formulários. Diferenças devem se limitar ao material visual.
3. Confirmar preservação de quebras de texto, rolagem, teclado virtual, áreas fixas e responsividade.
4. Revisar entrada, conversa, catálogo, produto, carrinho, identificação, checkout e superfícies auxiliares nos estados acessíveis.
5. Conferir os temas claro e escuro, a identidade Athom e outro tema de merchant disponível.
6. Exercitar os controles afetados com teclado e toque, incluindo foco, seleção, indisponibilidade e carregamento.
7. Revisar pelo menos 390 × 844 e 1440 × 900, além da menor largura suportada e das transições de breakpoint existentes. Esses são viewports de verificação, não novos breakpoints.
8. Executar as verificações pertinentes às aplicações alteradas. Registrar telas ou estados que não puderam ser comprovados.
9. Confirmar que as mudanças de código se restringem à apresentação e não introduzem dependências gráficas ou wrappers desnecessários.
10. Comparar o resultado com o print real da loja para estrutura e com a imagem conceitual somente para materialidade.

**Resultado esperado:** o storefront Athom/Zyon e o checkout widget_v2 mantêm suas UIs reconhecíveis, cada um com os mesmos elementos e funções nos mesmos lugares, agora apresentados em neumorphism suave, consistente e legível.


## 11. Refinamentos aprovados durante a implementação

- **Ações:** botões com texto em formato de pílula, com `border-radius: 999px`. O arredondamento não muda largura, altura ou padding.
- **Fechar painéis e chat:** material neutro dos controles do header, com a mesma superfície, cor do ícone, borda discreta e relevo curto. Preservar os alvos e posições existentes.
- **Tabs do Hub:** navegação plana, sem pílulas, sem elevação e sem fundos individuais. Ícone e rótulo permanecem alinhados; a seleção usa o indicador inferior existente e cor de texto legível. Os rótulos cabem em sua largura natural, dentro do mesmo trilho horizontal com rolagem.
- **Composer do storefront:** um único container rebaixado e um único contorno de foco. O input interno fica transparente, sem borda, sombra ou outline próprios.
- **Campos independentes do checkout:** mantêm sua superfície rebaixada e foco próprio. Não remover o foco quando não há um container que o substitua.
- **Hierarquia:** ações recebem relevo; navegação, links de texto, fotografias, thumbnails, player de vídeo e QR Codes conservam sua apresentação apropriada. O estilo dos botões não deve recortar mídia.
- **Tema escuro:** sombras escuras e realces contidos também no primeiro carregamento e depois de recarregar a página. Evitar halos brancos.
- **Contraste:** `--aacp-accent-text` fornece um tom legível para textos pequenos da marca; os botões principais usam superfície neutra, relevo e texto no acento legível do merchant (seção 16). Textos neutros usam `--aacp-fg`, `--aacp-muted` e `--aacp-faint`.

## 12. Implementação e verificação

O material está centralizado em `apps/widget_v2/src/styles/neumorphism.css`, importado pelo skin existente para storefront e checkout. A paleta está em `apps/widget_v2/src/design-system/neumorphism.ts`. Os componentes usam papéis explícitos de material nos elementos atuais, sem wrappers ou dependências gráficas adicionais.

A aplicação inclui `packages/checkout-ui`, responsável pelo FAB e pela sheet de carrinho utilizados pelo storefront. Os controles de pagamento recebem o material em seus componentes e containers atuais; o conteúdo dos iframes dos provedores não é alterado por CSS externo.

Três correções pontuais acompanharam a revisão: o suporte mobile passou a respeitar os valores existentes de abertura e fechamento, pois uma regra antiga o mantinha fora da tela; as abas do Hub passaram a respeitar a largura de seus rótulos, evitando sobreposição sem mudar sua ordem ou mecanismo de navegação; a camada do Hub foi ajustada para ficar acima do FAB do carrinho.

Registrar os cenários executados e as limitações em [neumorphism-validation.md](neumorphism-validation.md). Capturas com dados de demonstração e builds locais não comprovam pagamentos ou comportamento em produção.


## 13. Refinamento após uso da demo local, 14/09/2026

- O composer usa a superfície semântica `--aacp-inset-bg`, com menos saturação no escuro. O rebaixo tem apenas 1 px de deslocamento e 2 px de desfoque, sem a sombra diagonal profunda nos cantos.
- O foco fica no container, por CSS; o input continua sem borda ou sombra internas. Placeholders usam a cor semântica de texto discreto, com opacidade explícita. O mesmo material de campo é compartilhado com o widget_v2.
- Respostas rápidas usam 8 px entre controles e linhas. A mensagem e os blocos relacionados têm 12 px de separação. O gutter horizontal da conversa passa a 14 px, alinhado ao header e ao composer. Esses ajustes pontuais de espaçamento atendem à revisão solicitada; posições gerais e estrutura das telas permanecem as mesmas.
- Online é um status informativo: superfície neutra do header, contorno discreto, realce curto e texto secundário. Apenas o ponto de presença usa a cor de sucesso.
- O detalhe de produto usa `RichProductDetailsPanel`, com narração, avaliações e conteúdo editorial, quando a API pública autoriza o conteúdo e fornece os dados de compra, mesmo sem blocos editoriais. Respostas negadas ou indisponíveis continuam preservando o card na conversa. Não se alteram permissões, preços ou disponibilidade para obter o visual.


## 14. Acabamento dos controles compostos, 14/09/2026

A direção continua sendo neumorphism suave, com precisão de alinhamento, hierarquia e estados. O formato acompanha a função do elemento. Evitar aplicar arredondamento e sombra indiscriminadamente a todo botão HTML.

- Ações independentes usam pílula pelos papéis control, icon, primary e animated-primary. Navegação, links de texto, upload e mídia mantêm sua geometria própria.
- Seletores de modo, como Avaliação escrita / Vídeo, usam segmented no trilho e segment nas opções. Um trilho de 13 px, respiro interno de 3 px e uma única face selecionada de 9 px formam o conjunto. Opções têm alvo mínimo de 44 px. A seleção usa superfície neutra, contorno e sombra curta; não duas cápsulas elevadas. O grupo conserva botões com aria-pressed e navegação nativa por teclado.
- Cards acionáveis com título, descrição ou preço usam choice. A geometria do card acomoda seu conteúdo; o relevo é menor que o das ações independentes. Aplica-se também à escolha de canal, frete e pagamento do widget_v2.
- Interruptores usam switch, com trilho discretamente rebaixado. Abas do Hub continuam planas, com indicador inferior e sem sombra.
- Áreas de upload têm um único contorno tracejado de 1 px. A ação ocupa o container sem sombra própria. Substituir vídeo e links contextuais são ações de texto; remover usa o material neutro dos ícones de fechar.
- Campos compostos de e-mail e código no Hub usam inset no container e um único foco. O campo interno fica transparente. Campos do formulário de avaliação usam a superfície semântica dos inputs e raio de 10 px.
- O relevo compartilhado tem deslocamentos menores e realces translúcidos. Sombras de barras fixas usam o token de sombra, evitando halos claros no tema escuro. Galerias não recebem sombras individuais em cada indicador.
- Alterações pontuais de respiro em controles compostos são permitidas para eliminar colisões. A ordem dos campos, navegação, conteúdo e organização geral permanecem preservados.

O acabamento depende também dos estados: revisar seleção, foco, erro de arquivo, carregamento, autenticação necessária, painéis abertos e largura de tablet. Registrar a evidência na validação do storefront.


## 15. Material da conversa e ações flutuantes, 14/09/2026

- Envio usa o papel send: mesma face neutra, contorno e relevo dos controles do header. O ícone usa o acento da marca quando disponível; vazio ou ocupado usa texto discreto. Não aplicar opacidade ao botão inteiro nem remover seu material no estado desabilitado. O estado continua bloqueando o envio.
- Online usa cápsula com altura mínima de 30 px, alinhada aos controles do header, fundo card e relevo curto. Somente o ponto de presença permanece verde; o texto é secundário. O badge continua informativo.
- Balões usam message, com quatro cantos de 18 px e sombra dupla curta. Isso inclui fala inicial, resposta, narração junto ao produto e indicador de digitação. Mensagens do comprador preservam o alinhamento à direita e usam uma superfície suavemente tingida pelo acento, com texto legível e contorno discreto.
- Carrinhos flutuantes usam floating: superfície neutra com relevo um pouco maior, ícone no acento legível e contorno do header. O contador usa counter, com acento e texto de contraste, sem a aparência de alerta vermelho. Dimensões, posição, quantidade e total continuam sob responsabilidade do componente.
- A animação de adição conserva o material do carrinho em todos os frames. Ações de hover existentes permanecem; a preferência por movimento reduzido desativa a animação do FAB e do contador.
- A mesma direção é aplicada ao chat e ao suporte do storefront e widget_v2. Não usar uma variação plana do envio ou cantos assimétricos nos balões auxiliares.


## 16. Ações principais e contornos contínuos, 14/09/2026

- Confirmar, Finalizar, Adicionar ao carrinho e demais ações primary compartilham a face neutra do header, formato de pílula, peso 600, texto no acento legível e relevo médio. O acento deixa de preencher toda a face. Hover, pressionado, foco e desabilitado usam o mesmo material; o estado indisponível preserva a superfície e reduz a ênfase do texto.
- Voltar precisa de espaço para seu próprio relevo: 12 px antes do formulário de autenticação; no header do produto, 10 px verticais e ao menos 12 px laterais. O rótulo do resumo é compacto no header para acomodar os controles sem colisões no celular.
- Container principal e composer têm contornos animados independentes, com espessura de 1 px. Cada traço percorre todo o retângulo arredondado, incluindo os quatro lados e cantos. Os ciclos são de 4 s no container e 5 s no input, sem girar uma camada retangular nem reutilizar nomes de keyframes de outros efeitos.
- O composer mantém apenas sua superfície e o contorno externo. Não somar borda interna, outline ou sombra no input. O foco reforça a cor do mesmo contorno, sem engrossá-lo; o traço móvel continua perceptível durante a digitação.
- O mesmo PerimeterBorder é usado pelo storefront e widget_v2. No checkout e suporte, o contorno envolve o campo existente; o envio conserva sua posição. O CSS é distribuído pelo skin compartilhado, inclusive no checkout integrado.
- Por decisão explícita de manter o shimmer em movimento, a preferência de movimento reduzido desacelera somente esse efeito: 8 s no container e 10 s no campo, em vez de removê-lo. As demais animações seguem as regras existentes. Em alto contraste, usar as cores do sistema e reforçar o foco. O brilho em gradiente é decorativo, sem interação ou conteúdo anunciado por leitores de tela. A máscara fixa limita o desenho a 1 px; apenas o ângulo do gradiente percorre 360 graus.

Esta seção substitui decisões anteriores sobre preenchimento das ações primary e sombra/rebaixo do composer principal. A estrutura geral, as etapas e as regras comerciais permanecem as existentes.

O shimmer usa a camada 0, abaixo do contexto de conteúdo e de seus painéis. Hub, suporte, autenticação e carrinho cobrem integralmente os contornos da conversa. Seus fundos usam a superfície opaca de painel; não aumentar o z-index da decoração acima deles.
