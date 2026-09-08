# Experiência de produto sobre o chat — 2026-09-08

Status: implementação visual validada localmente. A compra completa com pagamento Stripe sandbox permanece pendente; este relatório não declara o checkout inteiro pronto para produção.

## Decisão e comportamento entregue

O produto abre em um painel sobre a conversa, dentro dos mesmos limites do chat. A organização é vertical e contínua: galeria, descrição, preço, variações e opcionais, blocos publicados, perguntas frequentes, avaliações e vídeos. O conteúdo foi reorganizado a partir da referência de navegação solicitada pelo usuário: [página de produto Barba de Respeito](https://barbaderespeito.com.br/products/blendzao-original-para-crescimento-de-barba-100-ml). Cópias e identidade visual pertencem ao catálogo e ao tema da loja.

- Cabeçalho permanece visível com Voltar à esquerda e Fechar à direita; ambos restauram a conversa. Escape também fecha. A conversa mantém suas mensagens e estado.
- A área de conteúdo tem rolagem própria e suave. O rodapé de compra permanece visível, apresenta a escolha e seu valor em reais e respeita a área segura do dispositivo.
- A abertura e o fechamento têm movimento sutil. A preferência por movimento reduzido desativa a animação e a rolagem suave.
- O foco permanece dentro do painel; a conversa fica inerte enquanto ele está aberto. Ao fechar, o foco retorna à interface de origem.
- Fontes e cores usam os tokens da loja. Os temas claro e escuro preservam a cor do lojista. Fundos brancos das fotografias permanecem nas imagens originais, conforme preferência do usuário.
- O contrato atual do agente, `product_card`, abre o painel quando a API pública confirma conteúdo avançado publicado e disponível para a loja. Produtos sem esse conteúdo mantêm seus cards. O contrato `product_content` e a ação de explorar detalhes também abrem o painel.

## Narração

Um resumo curto utiliza nome, descrição e opções reais do catálogo. A voz padrão usa a síntese de fala do navegador em português; não há geração por LLM nem provedor profissional de voz configurado nesta entrega. A interface `ProductVoiceProvider` permite acrescentar outro provedor preservando os controles e o ciclo de reprodução.

A reprodução é tentada ao abrir. Quando o navegador bloqueia a reprodução automática, o botão Ouvir resumo permite iniciar manualmente. O resumo também pode ser lido. Há controle de parada; fechar o produto, ocultar a página ou iniciar um vídeo interrompe a narração. Navegadores sem suporte continuam mostrando o resumo textual. Os testes automatizados verificam esse ciclo com um provedor simulado; não avaliam a qualidade acústica das vozes de cada dispositivo.

## Correções encontradas durante a revisão

1. A preferência de idioma do navegador podia solicitar conteúdo em inglês em uma loja exibida em português, deixando os blocos vazios. A busca agora envia o idioma do documento.
2. Os controles da galeria podiam ter fundo escuro e texto escuro no tema claro. Passaram a usar a superfície do tema atual.
3. Falha temporária ao buscar o conteúdo agora oferece Tentar novamente, mantendo a possibilidade de retornar ao chat.
4. O atalho flutuante do carrinho cobria parte do total quando a gaveta estava aberta. Ele fica oculto durante essa exibição e reaparece ao fechar.
5. Metadados internos de comandos de adicionar produto apareciam na mensagem do comprador. A apresentação oculta os identificadores reconhecidos; o comando original continua no histórico e na requisição à API.

## Evidências locais

Ambiente: storefront em `http://localhost:3001`, API em `http://localhost:3009`, loja demonstrativa `showroom-mrc-rtp-test-store`, produto `apl_showcase_mrc-rtp-test-store`.

- `pnpm --filter @zyon/storefront typecheck`: aprovado, inclusive após os ajustes finais do carrinho.
- `pnpm exec playwright test e2e/advanced-product-layout.spec.ts --project=apl --workers=1`: **8 testes aprovados**. Cobertura: contrato público, painel desktop, navegação mobile, temas, narração, carrinho, tela de 320 px com movimento reduzido e recuperação de erro, abertura pelo contrato atual do agente.
- Após tornar a captura do tema escuro dependente da decodificação da foto, o teste de tema foi repetido: **1 aprovado**. Dimensões da imagem disponíveis antes de sua decodificação não eram prova de que ela já aparecia na captura.
- Após os ajustes do carrinho e da mensagem, o teste de compra mobile foi repetido: **1 aprovado**. Verificou também a ausência do atalho sobre o total e sua reabertura após fechar a gaveta.
- Fluxo com API local real: selecionar 50 ml → R$ 189,90 → adicionar → confirmação do carrinho retornado pelo servidor → Ver carrinho → Finalizar pedido → identificação por e-mail. O teste não envia OTP nem submete pagamento.
- A abertura pelo agente usa uma resposta de modelo simulada e determinística; criação da conversa e consulta do conteúdo usam a API local.
- Revisão manual de capturas em desktop e mobile, temas claro e escuro, FAQ, avaliações, vídeos e carrinho. Capturas preservadas em `.audit/product-experience/` para não depender da pasta temporária do Playwright.

Preview local: `http://localhost:3001/store/showroom-mrc-rtp-test-store?show=content&product=apl_showcase_mrc-rtp-test-store`.

## Limites e próximas correções funcionais

A [validação da API](./2026-09-08-advanced-product-purchase-api-validation.md) registra 83 testes de layout/regras/opcionais e 23 de OTP/ofertas aprovados. A persistência das regras nesses testes usa memória, e não prova gravação e releitura no PostgreSQL. O fluxo de comida não foi exercitado até pagamento pelo navegador nesta rodada.

Permanecem: implementação financeira de compre 1 e ganhe 1 (atualmente rejeitada), aplicação da margem mínima com custo real no carrinho storefront (a avaliação atual pode estimar custo em 50%), atualização das fixtures antigas de compra que falham por ausência da autoridade do carrinho e execução de pagamento Stripe sandbox completo, incluindo webhook e confirmação persistida. Nenhuma proteção de runtime da API foi removida para fazer testes passarem.

Esta etapa não executou commit nem deploy. O layout pode ser revisado pelas capturas locais; a publicação deve considerar as pendências funcionais acima.
