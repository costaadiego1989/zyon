# WhatsApp buyer hub and advanced shopping search

## Outcome

O WhatsApp deve permitir a compra e o acompanhamento completo sem exigir acesso ao painel do lojista. Os atalhos serão entradas para as mesmas operações do hub do comprador. A conversa natural continuará disponível em qualquer etapa. Este documento planeja essas entregas; não declara que os novos comandos já estão ativos.

A correção imediata cobre nomes legíveis no menu, remoção de Voltar na lista de produtos e animações nativas. O restante será entregue por fases com testes positivos, negativos e evidência real dos dois canais.

## Inventory and evidence boundary

Inventário de código em 04/11/2026. Backend inspecionado no checkout isolado feat/graph-rag-cypher-20261103, base a3b19946b. As telas do hub foram inventariadas no workspace AACP; há trabalho concorrente nessa pasta e este inventário não comprova que cada tela já esteja publicada. A produção deve ser comparada por revisão e comportamento a cada entrega.

Fontes principais:

- `apps/storefront/src/components/buyer-hub/tabs/{ProfileTab,PreferencesTab,OrdersTab,TrackingTab,LoyaltyTab,ConversationsTab,SettingsTab,AgentTab}.tsx`.
- `apps/storefront/src/lib/viewmodels/useBuyerHub/{types,useBuyerHub}.ts`.
- `apps/api/src/modules/buyer-account/presentation/http/buyer-{hub,addresses}.controller.ts` e casos de uso de perfil/endereço/preferências.
- `apps/api/src/modules/whatsapp-channel/domain/ui/{meta-store-actions,meta-ui-renderer}.ts` e integração de checkout/endereço salvo.
- `apps/api/src/modules/catalog/infrastructure/{public-graph-catalog.sources,graph-catalog-search}.ts`, repositório canônico e leitor de avaliações públicas.
- `apps/api/src/modules/graph-rag/domain/graph-query.ts` e contrato `shopping-search-plan.schemas.ts`.

## Present graph capabilities

Cypher é a linguagem de consulta. Embeddings representam semelhança de texto; não conhecem valores comerciais por conta própria. Hoje o sistema usa templates Cypher parametrizados e um gateway privado de consultas controladas no Neo4j Community. Não executa Cypher arbitrário produzido pelo modelo.

Releitura real às 17:47:43 UTC em 04/11: 33 fontes de catálogo, 13 produtos ativos, 6 documentos públicos e 39 projeções com versão/hash/modelo válidos. Gateway privado admitido e inferência local real de 384 dimensões. Este retrato não transforma registros inativos em produtos compráveis.

| Pergunta/dado | O que existe no código atual | Limite e próxima entrega |
| --- | --- | --- |
| Produtos de toda a loja | Leitor paginado por merchant para projeção de nome, descrição, categoria e atributos de variantes; fontes removidas/inativas deixam de ser elegíveis | Conferir cobertura/versionamento em runtime; nomear apenas itens públicos ativos |
| Busca pelo significado | Embedding multilíngue e busca limitada a 20 candidatos com releitura de fonte e variante | O grafo é fallback quando a busca canônica não encontra resultados. Não é o planejador universal de toda pergunta; informa seleção semântica parcial |
| Preço, estoque e atributos | Validação atual no PostgreSQL, na mesma variante, depois da recuperação | Embedding desatualizado nunca autoriza preço, disponibilidade ou adequação |
| Notas de avaliações | Filtros e agregados de avaliações públicas aprovadas no caminho canônico | O texto de todas as avaliações não é projetado/embeddado hoje; ausência de avaliações não equivale a nota zero |
| FAQ e políticas | Fontes públicas versionadas e revalidadas; o conteúdo simulado deve estar identificado | Remover/revogar conteúdo invalida sua evidência; política genérica não prova frete grátis para um carrinho |
| Frete grátis/até R$ X | Contrato de intenção já representa freeOnly e teto de frete | Falta cotar cada candidato e juntar elegibilidade por CEP, variante, quantidade e regra ativa |
| Entrega em até N dias | Intenção representa prazo máximo em dias úteis | Falta composição com cotação e corte operacional/produção. Estimativa do transportador não é garantia de entrega |
| Perguntas avançadas | Preço, nota, atributos e ordenação já têm estruturas; há caminhos semânticos e contexto | Não afirmar suporte geral a qualquer AND/OR, negação, preferência ou mudança de contexto sem os testes abaixo |

## Advanced query design

Exemplo alvo: “Quero hidratante sem perfume até R$ 100, avaliação acima de 4, frete até R$ 15 e entrega em 3 dias úteis no meu endereço”.

1. Interpretar a intenção num contrato tipado com consulta semântica, preço do produto, orçamento total se declarado, comparador de nota (`>` ou `>=`), atributo obrigatório, CEP/endereço autorizado, teto de frete, prazo útil e ordenação. Preservar unidade, moeda, quantidade, negações e expressões “ou”.
2. Perguntar somente o dado indispensável que está ausente ou ambíguo. Não pedir de novo endereço/preferência já reconhecidos. “Até R$ 100 com frete” significa orçamento total quando explícito; sem essa informação o produto e o frete são apresentados separadamente.
3. Recuperar candidatos lexicais e semânticos com limite explícito, deduplicação por variante, filtros seguros de loja/visibilidade e templates Cypher revisados. Nenhum texto recebido se torna um trecho de consulta.
4. Revalidar produto/variante ativos, estoque comprável, preço e atributos publicados. “Não informa perfume” é desconhecido e não comprova “sem perfume”. Verificar nota média aprovada e contagem/amostra.
5. Cotar frete para candidatos elegíveis com dimensões, peso, origem, quantidade e destino reais. Aplicar regras atuais de frete grátis, mínimos, região, modalidade, cupom e exclusões. Se a regra exigir carrinho mínimo, informar essa condição; não tratar o item isolado como gratuito.
6. Limitar concorrência, quantidade de candidatos e tempo total. Cache por loja/origem/destino/variante/quantidade/regra/versão, com validade curta. Invalidar por alteração comercial relevante. Timeout ou falta de cobertura retorna “não consegui confirmar o frete”, sem inventar zero ou prazo.
7. Cruzar filtros obrigatórios com todas as cotações elegíveis; preferências apenas ordenam. Calcular total final em centavos. Revalidar novamente ao entrar no checkout, pois uma pesquisa não reserva preço nem estoque.
8. Responder com nome, variante, preço, nota/contagem, frete, modalidade, prazo estimado, total e origem de cada condição. Se a seleção for limitada, dizer isso. Se nenhum item atender, oferecer alternativas semelhantes explicando qual critério precisa ser flexibilizado e solicitar a escolha do comprador.

Exemplo esperado, com dados efetivamente confirmados:

> 🤖 Encontrei estas opções dentro dos seus critérios.\n\n📦 *[Produto e variante]*\n💰 Produto: *R$ [valor]*\n⭐ [nota] / 5 · [n] avaliações publicadas\n🚚 Frete: *R$ [valor]* · [modalidade]\n📅 Previsão: [n] dias úteis após [condição operacional]\n🧾 Total: *R$ [valor]*\n\nQuer conhecer os detalhes ou adicionar esta opção?

Se nada atender: “Encontrei uma opção parecida que custa R$ [valor] e tem [característica comprovada]. O prazo estimado é de [n] dias úteis, acima dos 3 dias que você pediu. Quer ver essa alternativa ou manter o limite de prazo?” Nenhuma alteração no carrinho ocorre apenas porque a alternativa foi recomendada.

## Review embeddings

Criar uma projeção separada `PublicReview` para texto aprovado, nota, data, vínculo com produto/variante quando comprovado e indicador de compra verificada quando existir na origem. Não projetar e-mail, telefone, endereço ou conteúdo privado. Relacionar com produto e loja e manter versão/hash, moderação e tombstone.

Consultas como “quais compradores reclamaram da textura?” recuperam trechos públicos positivos e negativos, com proporção/amostra e limites. A resposta distingue descrição do produto, opinião de comprador e inferência. Nunca usa um comentário como evidência clínica ou prova universal. Moderação/revogação/exclusão precisa invalidar imediatamente a elegibilidade, inclusive após embedding antigo.

Seeds de QA permanecem marcados como simulados, com exemplos positivos e negativos de textura, perfume, embalagem, custo-benefício e entrega. Comentários sobre entrega não substituem cotação. Fixtures não alteram a nota pública de uma loja real sem controle explícito de seed e limpeza.

## Shortcuts information architecture

Entrada `/atalhos`, alias `/atalho`, com a mesma navegação acessível por linguagem natural. Mensagem inicial explica a conversa livre e os atalhos realmente disponíveis. O registro único de comandos contém aliases, descrição, estado de disponibilidade, operação tipada, permissões e parâmetros. O menu e a ajuda são gerados desse registro; não anunciar um comando antes de ele funcionar.

O menu raiz usa até 10 linhas por lista e grupos pequenos: *Comprar*, *Minhas compras*, *Meu cadastro*, *Preferências e benefícios*, *Ajuda e privacidade*. A compra rápida fica no primeiro nível. A volta é contextual nas subseções e não ocupa a lista de produtos. Nunca truncar nome, CEP, nota ou preço de forma que mude o significado.

## Hub parity matrix

| Área existente/inventariada | Atalho proposto | Operações e resposta esperada | Canal nativo ou passagem segura |
| --- | --- | --- | --- |
| Visão geral/perfil | `/dados` | Nome, e-mail, telefone reconhecido; editar campos permitidos e mostrar o resultado salvo | Texto/Flow; alteração de identidade exige reautenticação proporcional |
| Documentos de checkout | `/dados documento` | Consultar mascarado e preencher somente se necessário ao provedor/compra | Formulário seguro quando sensível; não expor documento inteiro em histórico |
| Endereços | `/enderecos` | Listar rótulo/CEP/cidade, adicionar, editar, excluir e definir padrão | Lista + Flow ou coleta conversacional; confirmação apenas na exclusão/efeito relevante |
| Pedidos/histórico | `/pedidos` | Paginação da loja atual, itens, valores discriminados e estado de pagamento/operacional | Lista e detalhe em texto; link apenas para compra do próprio usuário |
| Acompanhamento | `/rastreio` | Selecionar pedido, transportadora/código/link confiável e eventos com data | Consulta canônica, sem confundir etiqueta criada com pedido enviado |
| Recibo/segunda via | `/recibo` | Consultar pagamento existente e resumo discriminado, sem gerar nova cobrança | Releitura; entrega de segunda via tem identidade própria e não repete animação de sucesso |
| Carrinho | `/carrinho` | Itens, quantidade, subtotal, cupom aplicável, continuar e esvaziar | Operações atuais reutilizadas; esvaziar pede confirmação explícita |
| Catálogo/categorias/ofertas | `/produtos`, `/categorias`, `/ofertas` | Consultar e filtrar, escolher variante, preço/estoque atuais | Menu/cartões reais; catálogo nativo apenas quando asset Meta está ativo |
| Favoritos | `/favoritos` | Listar, adicionar/remover e escolher para compra | Reusar wishlist; escolher detalhe não adiciona sem consentimento |
| Compra rápida | `/comprarapida` | Comprar itens selecionados ou repetir pedido usando cadastro/endereço e preferências autorizados | Ver fluxo abaixo; cartão sempre no checkout protegido |
| Avaliações pessoais | `/avaliacoes` | Consultar próprias avaliações/estado de moderação e avaliar compra elegível | Texto/Flow; sem publicar conteúdo próprio como aprovado automaticamente |
| Perguntas sobre produtos | `/perguntas` | Minhas perguntas, respostas publicadas e enviar nova pergunta no produto correto | Reusar vínculo produto e usuário; não prometer resposta ainda não dada |
| Preferências de compra | `/preferencias compra` | Habilitar compra rápida; frete mais barato/rápido e Pix/cartão | Persistência real e confirmação breve do que foi salvo |
| Comunicação/idioma | `/preferencias` | Opt-in de e-mail/WhatsApp, idioma e negociação M2M | Não habilitar SMS indisponível. Push/biometria dependem do dispositivo/navegador |
| Perfil de interesse/consentimento | `/privacidade interesses` | Ver/revogar consentimento de personalização e explicação dos usos | Não expor scores internos como informação inventada ao comprador |
| Fidelidade/estatísticas | `/beneficios` | Benefícios disponíveis, conquistados e progresso; histórico agregado, categorias e marcas | Escopo da loja; não prometer cupom/nível que o backend não confirmou |
| Conversas | `/conversas` | Listar sessões próprias da loja, consultar mensagens e avaliar resposta útil/não útil | Paginação com privacidade, sem conteúdos de outras contas ou lojas |
| Agente pessoal | `/meuagente` | Nome/aparência, habilitar/desabilitar, configurações e atividade | Ajustes visuais com preview exigem página segura do comprador; não painel merchant |
| Tarefas do agente | `/meuagente tarefas` | Criar/listar/editar/pausar/retomar/encerrar monitoramento de preço, reposição, recompra, negociação e cesta com orçamento | Validar direito premium, limite, expiração e consentimento; oportunidade não efetua compra sozinha |
| Propostas do agente | `/meuagente oportunidades` | Ver motivo, condição, preço total e validade, revisar para comprar ou dispensar | Decisão explícita; checkout seguro existente, sem cobrança automática |
| Configurações de interface | `/configuracoes` | Tema/recursos do navegador e instruções do dispositivo | WhatsApp controla seu tema/animação; não anunciar controle remoto do app |
| Segurança/acesso | `/seguranca` | Gerenciar acesso e encerrar sessões quando suportado | Passkey/biometria por página segura no dispositivo; nunca pedir senha/código de cartão no chat |
| Exportação de dados | `/privacidade exportar` | Preparar arquivo só do comprador autenticado, entrega segura com expiração | Dados pessoais fora de URL pública; link assinado de uso limitado |
| Exclusão da conta | `/privacidade excluir` | Informar efeito real e retenções de pedidos, confirmar e executar anonimização existente | Reautenticação para ato sensível, confirmação inequívoca e idempotência |
| Ajuda/políticas/atendimento | `/ajuda` | FAQ/política pública atual, aviso de simulação quando aplicável e encaminhamento humano disponível | Pergunta livre com RAG, sem lista hardcoded fingindo resposta contextual |

Inventariar também todas as ações secundárias dentro de cada aba antes de fechar sua fase. O teste de paridade deve falhar se uma nova operação do hub não tiver atalho, passagem segura ou justificativa explícita de impossibilidade nativa.

## Buyer identity and data access

Resolver identidade pelo remetente verificado no webhook, configuração ativa e merchant. Não aceitar `buyerId`, telefone ou `merchantId` informado no texto como autoridade. Ambiguidade entre cadastros do mesmo telefone não pode misturar histórico; resolver ligação da conta antes de exibir dados protegidos. Cadastro inicial pode existir só por telefone; nome/e-mail/endereço são solicitados quando necessários.

Extrair casos de uso compartilhados com um principal tipado de comprador autenticado. Não simular JWT nem chamar HTTP interno com credenciais administrativas para reutilizar o hub. Perfil/endereços globais precisam de decisão explícita sobre alcance, pois os endpoints atuais usam globalUserId; pedidos/conversas/benefícios continuam restritos à loja ativa. Mudanças em dados compartilhados devem explicar que podem afetar outros canais.

Comandos mutáveis recebem token de ação ligado a usuário, conversa, loja, revisão e validade. Repetição de botão/webhook não duplica endereço, carrinho ou pagamento. Comandos de slash têm prioridade apenas fora da entrada livre de campo; não interpretar parte de um endereço, URL ou mensagem como comando. `/cancelar` encerra coleta pendente sem apagar dados já confirmados.

## Quick purchase behavior

1. Reconhecer comprador e carrinho/itens escolhidos. Sem itens, oferecer favoritos, última compra ou busca; escolher não adiciona silenciosamente.
2. Cadastro completo + endereço válido + preferências: cotar e escolher modalidade conforme preferência autorizada; apresentar resumo final e seguir para geração do pagamento pela ação explícita de compra. Não repetir confirmação de e-mail.
3. Cadastro completo sem preferência de entrega: mostrar opções de frete, pedir apenas a modalidade e avançar.
4. Múltiplos endereços sem padrão: pedir qual usar. Endereço padrão existente: reutilizar com opção de trocar; não recolher todos os campos de novo.
5. Comprador novo/incompleto: solicitar somente nome, e-mail e endereço faltantes, de modo progressivo. Pedido digital/serviço não requer entrega física sem motivo real.
6. Recompra revalida variante, preço, quantidade, disponibilidade, agenda/opções e benefícios. Mostrar alterações antes de confirmar. Sem item em estoque, apresentar alternativa semelhante e pedir aceitação.
7. Pix exibe subtotal, desconto, frete, taxa e total da cobrança, validade e código copiável intacto. Cartão usa página segura. Um pagamento pendente existente é recuperado quando válido; botão duplicado não cria outro.
8. Troca de frete/endereço/cupom invalida resumo e cotação antigos; cancelar/trocar pagamento segue identidade/versionamento atual. Aprovação por webhook concorre com edição e nunca é revertida pela conversa.
9. Após cada adição confirmada, executar regra ativa de cross-sell, apenas com estoque. Identificar produto escolhido, apresentar a recomendação como tal, até três motivos verificados e desconto somente se elegível. Nova adição aceita pode originar próxima recomendação sem loop ou duplicidade.

## Payment UI review

A implementação atual discrimina subtotal, desconto, frete, taxa de serviço e total pago no recibo canônico. A cobrança aprovada e o pedido precisam ter a mesma loja, sessão, provedor, moeda e valores; se o detalhamento divergir, informar somente o total comprovado e a indisponibilidade do detalhamento. Não preencher valores faltantes com zero.

Na compra QA já paga, o valor do pedido do lojista foi R$ 12,86, enquanto o comprador pagou R$ 13,85: R$ 3,00 de produtos − R$ 0,30 de desconto + R$ 10,16 de frete + R$ 0,99 de taxa. Releitura às 17:47:24 UTC em 04/11 confirmou o recibo discriminado. A conferência das 17:48:57 UTC preservou uma baixa de uma unidade, estoque 4/reserva 0, pedido aprovado e não enviado. Não houve nova cobrança ou alteração operacional.

A confirmação WhatsApp atual usa título em negrito, identificação da loja e pedido, lista dos itens, valores e próximos passos pela própria conversa. O e-mail permite voltar à área de compras da loja, sem apontar para painel do lojista. Nenhuma nova revisão deve prometer `/pedidos` antes da entrega desse comando.

| Estado | Mensagem/controle esperado | Condição proibida |
| --- | --- | --- |
| Dados/frete pendentes | Mostrar o que falta e total parcial, com opção contextual | Frete pendente apresentado como R$ 0 confirmado |
| Pix gerado | “Aguardando pagamento”, validade, total e código separado | Código alterado por markdown ou mensagem “pago” |
| Pagamento em análise | “Aguardando confirmação” e consulta/reaproveitamento | Criar cobrança nova por demora |
| Aprovado | Recibo discriminado + animação paga uma vez | Confundir aprovação com envio |
| Expirado/cancelado/recusado | Estado e ação real disponível, sem sucesso visual | Ressuscitar pagamento antigo ou reenviar automaticamente |
| Preparando | Andamento atual e suporte na conversa | Prometer rastreio ou despacho inexistente |
| Etiqueta criada | Identificar apenas preparação da entrega | Dizer “pedido enviado” antes do evento real |
| Enviado | Código/transportadora/evento atual + animação enviada uma vez | Alterar fulfillment apenas para testar a animação |
| Entregue | Evento confirmado e convite de avaliação elegível | Marcar entregue por inferência do texto |

## Native WhatsApp capabilities

Listas e botões mantêm navegação curta. Flows já têm infraestrutura no backend e podem coletar dados/endereço, mas publicação, validade e fallback precisam ser verificados por loja. Catálogo Meta/cartões dependem de asset ativo e associação correta de IDs/variantes; não substituem a consulta canônica. Localização pode ajudar a obter destino, sem inventar número/complemento. Respostas contextuais e links CTA só aparecem para ações suportadas.

Para animações, GIF real fica disponível para exportação e preview. O envio de produção usa WebP animado no payload `sticker`; GIF não vira vídeo suportado ao mudar a extensão. Nenhum som é necessário para comunicar estado. Texto e controles continuam utilizáveis se a animação estiver desativada ou não carregar. O cliente pode limitar reprodução; provar no WhatsApp Web e registrar necessidade de aceitação em Android/iOS.

Fontes oficiais consultadas: [Meta sticker API](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/sticker/) e [Meta video API](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/video/). Estas páginas do SDK estão arquivadas; a aceitação da API atual e a reprodução real são gates adicionais, não substituídos pela documentação.

Voz, lista e foto entram no mesmo contrato tipado de intenção. Voz exige credencial/provedor de transcrição válido e prova atual; o 401 anterior não está resolvido por esta mudança. Foto identifica candidatos com incerteza, sem afirmar estoque/propriedades por aparência. Lista exige resolver cada item/quantidade/variante e mostrar indisponíveis/substituições. Nenhum reconhecimento gera compra sem a escolha correspondente.

## Delivery sequence

| Fase | Entrega | Dependência | Gate de saída |
| --- | --- | --- | --- |
| 0 | Menu legível, Voltar removido no catálogo, cinco GIFs/stickers e recibo revisado | Escopo desta correção | Contratos, regressão, build, revisão independente e UI real |
| 1 | Principal WhatsApp seguro, registro único de atalhos e `/atalhos`, `/dados`, `/enderecos` | Identidade/casos de uso compartilhados | Cadastro novo, existente e ambíguo; CRUD completo, replays e isolamento |
| 2 | `/pedidos`, `/rastreio`, `/recibo`, `/carrinho`, catálogo/favoritos e ajuda | Fase 1 | Pedido existente/ausente, paginação e estados reais; nenhum falso sucesso |
| 3 | Preferências, compra rápida e cross-sell contínuo | Fases 1–2 e resumo/cotação versionados | Todos os ramos de cadastro/endereço/preferência, orçamento, estoque e consentimento |
| 4 | Benefícios, conversas, avaliações/perguntas próprias, privacidade e segurança | Principal seguro + APIs de cada área | Paridade com hub, direitos/premium e atos sensíveis reautenticados |
| 5 | Agente pessoal e tarefas/oportunidades | Fase 4, runtime e direitos do agente | Criar/pausar/retomar/encerrar, expiração e compra explícita por oportunidade |
| 6 | Planejador avançado comum aos canais, operadores de fronteira e follow-ups | Contratos atuais e corpus de avaliação | AND/OR/negação, preço item/total, moeda, quantidade e critérios obrigatórios/preferidos |
| 7 | Frete e prazo por candidato com cache limitado | Fase 6, origem/peso/dimensões/regra/provedor | Frete grátis condicional, teto inclusivo/exclusivo, prazo útil, cobertura e timeout |
| 8 | Embeddings de avaliações e evidência explicável | Fonte aprovada versionada e revogação | Busca positiva/negativa, moderação, exclusão, PII e amostra/confiança |
| 9 | Voz/foto/lista com os mesmos limites comerciais | Provedor válido + fases 6–8 aplicáveis | Transcrição/visão atuais, incerteza e confirmação dos itens |

Cada fase exige implementação e testes próprios. A correção de UI não ativa automaticamente as fases seguintes.

## Acceptance matrix

| Grupo | Casos positivos | Casos negativos/limite | Evidência mínima |
| --- | --- | --- | --- |
| Menu | Todos os produtos e páginas; nomes da captura; nomes longos/Unicode | Sem Voltar no catálogo, ≤10 linhas, títulos≤24, descrições≤72; ID antigo | Gesto real seleciona o produto esperado, fallback numérico preservado |
| Animação | Cinco arquivos multiframe, MIME correto, boas-vindas antes do robô | Falha/mutação incerta não mostra sucesso, navegação não repete, autoplay desativado | Tamanho/quadro/loop + aceite Meta + UI no receptor, sem simular estado pago/enviado |
| Identidade | Novo telefone, cadastro completo e reentrada | Cadastros duplicados, número não verificado, tenant/ID forjado | Estado anterior/posterior e resposta sem vazamento |
| Endereços | Criar/editar/padrão/excluir; múltiplos endereços | CEP inválido, complemento, remoção do padrão, webhook duplicado | Persistência e reutilização no checkout, uma gravação por ação |
| Compra rápida | Preferências completas; só endereço; dados faltantes; digital | Preço/estoque/frete mudam, variante inativa, endereço incompleto | Somente campos faltantes e resumo comercial correto antes do pagamento |
| Busca combinada | Produto≤100 + nota≥4 + frete≤15 + prazo≤3 | Valores exatamente na fronteira, nota desconhecida, sem CEP, negativa desconhecida, propósito não suportado | IDs e razões canônicas; cotações reais por candidato e critérios não atendidos declarados |
| Contexto | “E acima de 3?” preserva orçamento; “mais barato” preserva frete | Nova intenção substitui critérios antigos; não herdar endereço de outra conta | Plano tipado antes/depois e resultado nos dois canais |
| Avaliações | Positivas/negativas, recentes, compra verificada comprovada | Pendente/revogada/excluída, PII, poucas amostras, prompt injection | Releitura/moderação atuais; comentário não vira característica universal |
| Cross-sell | Produto escolhido identificado, motivos verificados, desconto elegível | Sem estoque/regra inativa, motivo inventado, rejeição, adição duplicada | Nenhuma escrita sem opt-in e uma nova recomendação por adição confirmada |
| Pagamento | Pix válido/aprovado, recibos comprador/lojista, valores discriminados | Expirado, recusado, montante divergente, replay/concorrrência | Cobrança única, estado canônico, uma baixa e notificações correlacionadas |
| Pós-compra | Preparando/enviado/entregue reais, rastreio e avaliação elegível | Etiqueta sem despacho, evento fora de ordem, outro comprador | Eventos e versões persistidos, sem transição por texto do modelo |
| Paridade do hub | Toda ação da matriz tem comando ou passagem segura | Recurso indisponível/premium, SMS/push/biometria sem suporte nativo | Inventário automatizado de operações e caminhada de cada ramo |
| Operação | Revisão exata em SUCCESS e readiness saudável | Fonte diferente, segredo em log, serviço público indevido, rollback | Hashes de source/runtime, receipts, health e preservação do pedido pago |

O plano de aceitação global anterior continua aberto: corrigir este menu e validar alguns fluxos não representa aprovação de todos os cenários pendentes. Evidências locais, mockadas, de provedor e de UI real recebem estados separados.

## Implementation increment: precise queries and buyer address hub

A evolução iniciada em 04/11 implementa o primeiro conjunto de atalhos e amplia os predicados das consultas. A evidência de publicação e aceitação fica em `.audit/graph-shortcuts-evolution-20261104`; implementação local não equivale à aceitação global.

O registro único oferece `/atalhos` (também `/atalho`), `/dados`, `/enderecos`, `/carrinho`, `/produtos`, `/categorias`, `/ofertas`, `/favoritos`, `/comprarapida`, `/ajuda` e `/cancelar`. Os comandos de compra reutilizam as operações existentes. `/dados` consulta nome, e-mail e identificação mascarada do telefone; editar identidade e demais áreas do hub continuam nas próximas fases. O menu não anuncia comandos de pedidos, recibos ou privacidade ainda indisponíveis.

`/enderecos` permite listar, adicionar, editar um campo, definir padrão e excluir com confirmação. Os mesmos registros aparecem no storefront. O remetente Meta precisa estar autenticado na mensagem com lease ativo, loja e conversa corretas; cadastros ambíguos pedem somente o e-mail para selecionar uma conta do telefone comprovado. Nenhum ID digitado pelo comprador concede acesso a outra conta.

Se o primeiro contato criou apenas a identidade da conversa, o acesso ao hub completa a conta somente com o telefone comprovado e a identidade canônica da loja. A criação não sobrescreve um perfil existente. O endereço salvo pode ser reaproveitado no checkout mesmo antes do primeiro e-mail real; nome e e-mail faltantes continuam sendo coletados normalmente, sem usar o e-mail técnico interno como dado do comprador.

Coletas têm validade de 15 minutos e podem ser encerradas com `/cancelar` ou `/atalhos`. Cada ação possui token, conta e versão do conjunto de endereços. Gravações usam transação serializável e bloqueio da conta, com verificações da revisão e do proprietário. Repetir uma inclusão não cria outro endereço. Há limite de cinco registros; a exclusão do padrão promove o endereço restante mais antigo. Excluir o último também remove o fallback de endereço legado, evitando que ele reapareça. Pedidos e pagamentos existentes conservam o endereço e os valores já confirmados.

As consultas agora aceitam `attributeAnyOf`: até seis grupos com até seis alternativas cada. As alternativas de um grupo usam OU; os grupos e os atributos obrigatórios usam E, na mesma variante. Exclusões continuam exigindo um atributo publicado; ausência não significa “sem perfume”, por exemplo. O contrato aceita dados e operadores enumerados, nunca texto executável de SQL ou Cypher.

`minPriceExclusive`, `maxPriceExclusive` e `minRatingExclusive` distinguem “acima/abaixo de” de “a partir de/até/pelo menos”. Planos antigos mantêm os limites inclusivos. O SQL aplica os operadores à leitura atual; a seleção com promoção reaplica os limites ao preço autorizado. O Cypher seleciona candidatos sem substituir preço, estoque ou avaliações públicas canônicas. O gateway admite temporariamente somente os hashes dos dois templates publicados para permitir atualização gradual; o hash anterior não aceita os novos grupos de alternativas.

Este incremento não conclui o planejador avançado inteiro. Frete e prazo por candidato, orçamento incluindo entrega, embeddings dos comentários de avaliações, tarefas do agente e voz continuam nas fases seguintes. Uma pergunta pode combinar somente as condições que os dados e as cotações atuais conseguem comprovar; o sistema continua declarando os requisitos não verificados.
