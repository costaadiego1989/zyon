# Validação local do material neumórfico

Data: 14/09/2026. Escopo: storefront, widget_v2 e carrinho compartilhado de checkout-ui.

A atualização aplica o material aos elementos existentes. A navegação do Hub usa abas planas com o indicador inferior original; ações usam formato de pílula, controles de fechar seguem o header e o composer do storefront tem um único contorno de foco.

## Implementação conferida

- Paleta e sombras centralizadas no widget_v2, compartilhadas com o storefront e distribuídas pelo skin existente. Nenhuma dependência gráfica adicionada.
- Botões, cards, campos, bolhas, carrinho, identificação, conta, suporte, produto e containers de pagamento receberam papéis de material nos elementos atuais.
- Tema escuro corrigido no carregamento inicial: a raiz controla o tema, evitando que um atributo hidratado com o valor claro produza halos brancos.
- Textos pequenos usam acento próprio para texto. O acento de fundo dos botões continua respeitando a configuração do merchant.
- Mídias preservam seu recorte; links de compartilhamento recebem o tratamento de ação e títulos de conteúdo expansível permanecem planos.

Três correções localizadas acompanharam a revisão: abas do Hub respeitam a largura natural dos rótulos dentro do trilho rolável existente; a camada do Hub fica acima do FAB do carrinho; o suporte mobile respeita os valores já existentes de abertura e fechamento, removendo uma regra que o mantinha fora da tela. A organização das telas foi preservada.

## Evidências executadas

| Verificação | Resultado e alcance |
| --- | --- |
| Estrutura JSX | 75 arquivos comparados com o conteúdo anterior à tarefa. Nenhuma alteração de tags, textos ou atributos funcionais detectada; atributos de material e estilos foram excluídos dessa comparação. |
| Comparação visual e geométrica | 30 estados antes/depois, em 390 × 844 e 1440 × 900, nos temas claro e escuro. Sem diferenças de posição ou tamanho acima de 0,25 px nos elementos medidos; fonte e família preservadas. Sem overflow horizontal nesses estados. |
| Estados auxiliares | 37 capturas e 21 verificações: carrinho preenchido, identificação, login, OTP, erro simulado, início de cadastro, suporte, foco, carregamento, alto contraste e movimento reduzido. Sem erros JavaScript capturados. |
| Hub e produto | 40 capturas e quatro percursos em desktop/mobile e claro/escuro: sete abas do Hub, edição de perfil, conteúdo de produto, galeria, variante indisponível e fechamento. Sem erros JavaScript ou de hidratação capturados. |
| Larguras adicionais | 320, 639, 640 e 720 px sem overflow horizontal nos estados verificados; alternância de tema por teclado conferida. |
| Contraste dos tokens Athom | Pares de fg/muted/faint/accent-text sobre bg/surface/card/surface-3 medidos no navegador. Menor razão: 4,625:1 no claro e 4,709:1 no escuro. É uma medição dos pares de tokens, não uma certificação de toda a interface. |
| Personalização | Acento alternativo #7040b5 simulado no CTA existente, sem mudança de geometria do header. Não representa validação de outra loja em produção. |
| Testes existentes do widget_v2 | 14 testes Playwright aprovados em theme-branding, mobile-layout, cart-quantity-controls e native-cart-contract. |
| Testes existentes do storefront | Dois testes de commerce-rules aprovados, cobrindo avisos, valores aplicados e cross-sell em desktop/mobile. |
| Builds finais | Storefront Next, biblioteca widget_v2 com TypeScript e aplicação standalone widget_v2 com Vite aprovados. |
| Integridade da edição | git diff --check focado nos arquivos da tarefa aprovado. Conteúdo anterior preservado em registro local para distinguir alterações concorrentes. |

As 107 capturas atuais representam estados de teste, não 107 telas distintas do produto. As 30 comparações medem os elementos selecionados; os ajustes específicos do Hub e do suporte estão registrados separadamente acima.

## Como reproduzir os checks do projeto

Na raiz do monorepo:

```sh
pnpm --filter @zyon/widget-v2 build
pnpm --filter @zyon/storefront build
```

No diretório apps/widget_v2, com a configuração de Playwright e servidor de teste disponíveis:

```sh
node node_modules/@playwright/test/cli.js test e2e/theme-branding.spec.ts e2e/mobile-layout.spec.ts e2e/cart-quantity-controls.spec.ts e2e/native-cart-contract.spec.ts --workers=2 --reporter=list
node node_modules/vite/bin/vite.js build --mode app --outDir <diretorio-temporario>
```

No diretório apps/storefront:

```sh
node node_modules/@playwright/test/cli.js test --config e2e/commerce-rules.playwright.config.ts
```

No Windows, usar cmd /c pnpm quando o PowerShell bloquear pnpm.ps1. O build local do storefront utilizou AACP_API_URL apontando para uma API de demonstração em 127.0.0.1:3009.

## Capturas e limites

A galeria desta estação está em `C:\Users\Admin\Desktop\Cura Viva\previas-neumorphism\index.html`, com comparação antes/depois, temas, viewports e download de cada captura. Os JSONs junto às imagens registram medidas e verificações.

A revisão utilizou identidade Athom com produtos, conta e respostas de API de demonstração. Não executou autenticação de produção, cobrança, liquidação, frete ou estoque reais. O conteúdo interno de iframes de pagamento não pode ser alterado pelo CSS externo e não foi certificado nesta revisão. O fluxo completo storefront → provedor pago permanece fora desta evidência local.

Teclado físico e eventos de foco foram exercitados no navegador automatizado; teclado virtual em aparelho físico e zoom real de 200% ainda precisam de conferência. A variação de marca foi simulada, sem uma segunda loja real. A cobertura registrada não garante todos os estados de erro dos provedores ou todas as integrações externas.

As alterações permanecem locais, sem commit, push ou deploy nesta tarefa.


## Rodada após feedback da demo, 14/09/2026

A revisão seguinte corrigiu espaços dos atalhos, o material do campo principal, a aparência do status Online e a abertura do componente de produto. As 12 capturas antes/depois desta rodada cobrem conversa, foco e detalhe em 390 × 844 e 1440 × 1000, nos temas claro e escuro. A API local e o catálogo da demo foram usados na captura. O novo painel abriu nas quatro combinações, sem erros JavaScript capturados; o campo preservou suas dimensões e um único contorno de foco.

Os dois testes de `e2e/product-detail-routing.spec.ts` passaram: dados de compra sem blocos editoriais abrem o painel e devolvem foco ao chat; uma resposta pública 404 mantém o card na conversa. Dez testes existentes de tema e layout mobile do widget_v2 passaram. O build da biblioteca widget_v2 e o typecheck do storefront também passaram. Não foi necessário reiniciar o storefront para essa rodada.

Galeria desta rodada: `C:\Users\Admin\Desktop\Cura Viva\previas-neumorphism\revisao-demo\index.html`. As limitações de pagamentos e serviços externos registradas acima permanecem. Os ajustes de espaçamento e seleção da apresentação do produto desta rodada são posteriores à comparação geométrica original.


## Rodada de controles compostos e polimento, 14/09/2026

Corrigida a aplicação global de pílulas a seletores, upload e indicadores. O seletor de avaliação tem um trilho único e uma face selecionada neutra. Ajustados os campos do formulário e do Hub, os links contextuais, interruptores, sombras compartilhadas e barra fixa de compra. Opções compostas do checkout preservam espaço para título, descrição e preço.

A inspeção visual revelou também conflitos de layout no widget: CSS de drawer lateral posicionava a sheet no canto superior; os breakpoints divergiam entre 640 e 768 px; suporte e convite se sobrepunham ao composer e ao carrinho. As correções removem a regra antiga, unificam o breakpoint e medem o composer para posicionar as ações flutuantes. O conteúdo e as regras de consentimento existentes não foram alterados.

Validação executada: 6 cenários de review-controls.spec.ts, em 320, 390 e 1440 px nos dois temas, com troca de modo por teclado, persistência dos campos, rejeição de arquivo não MP4 e acesso à conta sem publicar avaliação. Os 2 cenários de product-detail-routing.spec.ts passaram. Passaram 13 testes de tema e layout mobile do widget, incluindo posição real da sheet, abertura do suporte, preferências expandidas e carrinho em 640 e 768 px. Build da biblioteca widget_v2 e typecheck do storefront concluídos.

Capturas reais do navegador cobrem produto, avaliação, vídeo, conversa, conta, suporte, escolha de canal, opções de frete/pagamento e carrinho nos dois temas em desktop e celular. A loja demo usa a API local; respostas de checkout e da conta autenticada foram simuladas para a inspeção visual. Não houve cobrança, envio de código por e-mail ou publicação de avaliação. O conjunto observado não apresentou erros JavaScript nem overflow horizontal de página.

Galeria desta rodada: C:/Users/Admin/Desktop/Cura Viva/previas-neumorphism/refinamento/index.html. As capturas anteriores são mantidas para comparação. Os testes não certificam autenticação de produção, provedores de pagamento, teclado virtual em aparelho físico ou todos os estados possíveis das integrações. Não foi executado um novo build completo do storefront nesta rodada.


## Rodada de envio, Online, balões e FAB, 14/09/2026

Corrigidos os quatro elementos apontados no uso: envio desabilitado perdia todo o relevo, Online não acompanhava o material do header, balões mantinham cantos assimétricos e o FAB continuava visualmente plano. O envio e o FAB usam a face neutra; o badge Online acompanha a altura dos controles; balões têm cantos uniformes e o comprador tem superfície tingida. O suporte e o widget_v2 recebem o mesmo tratamento.

Passaram os 6 cenários de conversation-actions.spec.ts em 320, 390 e 1440 px, nos dois temas: vazio/espaços bloqueiam envio, conteúdo habilita, teclado envia uma única vez, espera bloqueia o composer, resposta o libera e o carrinho com um item abre e fecha. As respostas da conversa e o item foram simulados no navegador, sem mutação comercial real. Passaram os 13 testes de tema e layout mobile/tablet do widget. Build da biblioteca widget_v2 e typecheck do storefront passaram.

As capturas da conversa cobrem vazio, pronto para enviar, digitação e resposta em 390 × 844 e 1440 × 1000 nos dois temas. A API e o catálogo locais continuam disponíveis. Capturas do widget usam respostas simuladas e não comprovam cobrança ou autenticação de produção. Galeria: C:/Users/Admin/Desktop/Cura Viva/previas-neumorphism/conversa/index.html.


## Contornos, ações e camadas, 14/09/2026

Correções: Voltar com 12 px antes do formulário e maior respiro no header de produto; ações primary com face neutra, texto na marca e relevo compartilhado; composer sem sombra ou moldura interna. O shimmer foi consolidado como gradiente de ângulo animado, máscara fixa de 1 px e ciclos independentes de 4 s no container e 5 s no campo. A camada decorativa fica abaixo do conteúdo para não atravessar Hub, suporte, autenticação ou carrinho. Hub e suporte usam o token opaco de painel.

Validação executada:

- 8 testes de conversa e roteamento de produto passaram após as mudanças de ações, campo e espaçamento.
- 4 testes em e2e/shimmer-panels.spec.ts passaram no material final, em claro e escuro. Comparação de capturas comprova movimento real nos dois contornos; com movimento reduzido, a animação é desativada. Testes de cobertura comparam pixels dos painéis enquanto o contorno atrás deles muda de cor. Um controle adicional reproduz a antiga camada acima do painel e confirma que o teste detecta a falha. Diferenças pequenas de rasterização não contam como vazamento visual.
- 13 testes de tema, identidade e layout mobile do widget_v2 foram executados novamente após a correção de shimmer e fundos.
- Build da biblioteca widget_v2 e typecheck do storefront passaram.
- Capturas reais da loja local em 390 e 1440 px, claro e escuro: Hub e suporte com fundo opaco, sem erros JavaScript ou overflow horizontal. Gravação inclui o shimmer com e sem foco e a abertura dos dois painéis.

Artefatos locais: C:\Users\Admin\Desktop\Cura Viva\previas-neumorphism\shimmer\index.html e shimmer-e-paineis.webm no mesmo diretório. A galeria contém 12 capturas. As galerias anteriores registram etapas anteriores do acabamento; esta é a referência mais recente para shimmer e painéis.

Dados da demo local e respostas de teste não comprovam produção ou liquidação por provedores. Nenhum pagamento, envio de e-mail, publicação ou alteração de regra comercial foi realizado nesta revisão visual.


## Preferência de animações do Windows, 14/09/2026

O ambiente local foi consultado por System.Windows.SystemParameters: ClientAreaAnimation=False e MinimizeAnimation=False. A condição equivalente no navegador (prefers-reduced-motion: reduce) reproduziu os dois contornos parados, com animation=none, duração 0 s e ângulo 0 graus em amostras consecutivas. Os testes anteriores usavam movimento normal para conferir a animação e esperavam que o modo reduzido a desativasse; isso não correspondia ao movimento solicitado pelo usuário nesta máquina.

Correção específica: shimmer continua ativo no modo reduzido, com ciclos de 8 s e 10 s. A regra é restrita ao elemento decorativo, prevalece sobre os resets genéricos do checkout e mantém as demais preferências de movimento existentes. Nenhuma configuração do Windows foi alterada.

Validação final: 6 testes do storefront e 2 do widget_v2 passaram. As capturas de pixels comprovam movimento dos dois contornos em ambos os temas, incluindo redução de movimento ativa; a regressão dos fundos/camadas do Hub e suporte continua passando. Na condição antes parada, o navegador passou a computar animação contínua, ciclos de 8 s/10 s e ângulos diferentes a cada amostra. Esta seção substitui a expectativa anterior de shimmer estático no modo reduzido.
