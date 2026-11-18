import type {AssistantKnowledgeDocument} from '../../domain/knowledge.port.js';

const source=(id:string)=>`/?tab=meta-ads-agent&help=${encodeURIComponent(id)}`;
function document(id:string,title:string,sections:AssistantKnowledgeDocument['sections'],externalSources:AssistantKnowledgeDocument['externalSources']=[],reviewedAt='2026-11-16'):AssistantKnowledgeDocument{
  // Policy provenance is the administrative approval of 16 November; revision2 retires initial autolaunch guidance.
  return {id,title,version:reviewedAt==='2026-11-16'?'2026-11-16.2':`${reviewedAt}.1`,context:'meta_ads',audience:'merchant',published:true,
    reviewedAt,validFrom:`${reviewedAt}T00:00:00Z`,validUntil:null,url:source(id),sections,externalSources};
}

/** Curated product guidance. Account facts and offer amounts must come from live scoped tools. */
export const META_ADS_MERCHANT_KNOWLEDGE:readonly AssistantKnowledgeDocument[]=[
  document('conexao-meta','Conectar a conta certa da Meta',[
    {id:'conta',keywords:['conectar','conexao','conta','facebook','instagram','oauth','permissao','pagina','aplicativo','zyon'],
      content:'Use Conectar Meta e autorize o aplicativo da Zyon com os ativos da sua loja. Selecione a conta de anúncios e a Página corretas. Catálogo, dataset e WhatsApp dependem do destino escolhido e das permissões efetivas. O nome de uma conta não comprova permissão para publicar.'},
    {id:'acesso',keywords:['token','senha','credencial','expirado','reconectar','desconectar','acesso'],
      content:'Não envie senha, token ou dados de cartão no chat. A conexão é feita no fluxo oficial da Meta. Permissão revogada, token expirado ou troca de conta podem exigir reconexão e invalidam autorizações anteriores. Desconectar interrompe novas ações do agente e não comprova que anúncios já ativos foram pausados.'},
  ]),
  document('pixel-e-catalogo','Configurar Pixel e catálogo sem complicação',[
    {id:'pixel',keywords:['pixel','medir','vendas','conversao','rastreamento','instalar','configurar','dados'],
      content:'O Pixel ajuda a Meta a medir ações na loja, como visitas e compras, respeitando o consentimento do comprador. Na Meta ele pode aparecer dentro de um conjunto de dados. Abra o Gerenciador de Eventos em https://business.facebook.com/events_manager2/ para criar ou localizar o Pixel e autorizar a conta de anúncios a usá-lo. Na Zyon, selecione esse Pixel em Anúncios com IA, Configurações, e coloque o mesmo ID em Configurações da loja, Busca e rastreamento, Pixels de conversão. Salve e confira os eventos na Meta. Selecionar um ID não comprova que eventos já estejam chegando.'},
    {id:'catalogo',keywords:['catalogo','produtos','commerce','criar','sincronizar','opcional'],
      content:'O catálogo da Zyon é onde estão os produtos da sua loja. A IA pode consultar esses produtos para montar anúncios. O catálogo da Meta é uma lista de produtos no Facebook e no Instagram, usada em anúncios de catálogo e experiências de compra; não é necessário para toda criação de anúncio a partir da Zyon. Para criar ou organizar esse catálogo, abra https://business.facebook.com/commerce/, confira a empresa correta e adicione os produtos. Depois volte à Zyon, carregue os ativos da conta e selecione o catálogo autorizado. Criar ou selecionar o catálogo não comprova sincronização nem permissão de publicação.'},
    {id:'conversa',keywords:['criar','anuncio','campanha','ajuda','comecar','objetivo','roas','motor'],
      content:'Para começar, a IA conduz uma decisão por vez e explica opções em linguagem simples. Ela pode consultar produtos reais para ajudar a escolher. Mais vendas prioriza compras; gastar menos por compra olha o custo médio de cada pedido; retorno por real investido compara as vendas atribuídas com a verba e também é chamado ROAS; lucro após anúncios depende de custos confiáveis. Não precisa saber esses nomes para criar. Um pedido completo é aproveitado sem refazer perguntas. O motor prepara textos e imagens dentro dos limites autorizados; todas as campanhas novas esperam revisão dos criativos e Aprovar e publicar. Nunca inventa orçamento ou datas nem compra extras por conta própria.'},
  ],[{title:'Meta: Gerenciador de Eventos',url:'https://business.facebook.com/events_manager2/'},{title:'Meta: Gerenciador de Comércio',url:'https://business.facebook.com/commerce/'}],'2026-11-18'),
  document('verba-e-pagamentos','Verba e pagamentos dos anúncios',[
    {id:'separacao',keywords:['verba','pagar','pago','pagamento','mensalidade','investimento','dinheiro','anuncios','pix'],
      content:'Sua assinatura da Zyon não inclui o investimento dos anúncios. Esse valor é pago diretamente à Meta. A Zyon ajuda a preparar e gerenciar campanhas; o orçamento de mídia é separado do plano, do adicional e dos créditos de criação de imagens.'},
    {id:'tipo',keywords:['fundos','saldo','pre','pos','prepago','pospago','cartao','recarga','cobranca','divida'],
      content:'Uma conta pré-paga precisa de fundos para veicular. Uma conta pós-paga cobra os anúncios na forma de pagamento cadastrada. Confira a situação em Pagamentos na Meta. Valor em aberto é uma dívida à Meta, não dinheiro disponível para anunciar.'},
    {id:'botao',keywords:['adicionar','depositar','carregar','credito','pagamentos','verificar','atualizar','bloqueio'],
      content:'Abrir pagamentos na Meta leva ao ambiente oficial para a conta conectada. A Zyon não recebe Pix ou cartão de mídia nesta versão. Depois de conferir ou pagar na Meta, use Verificar novamente. Clicar ou retornar não confirma crédito; somente uma nova leitura autorizada pode atualizar o diagnóstico. Bloqueio financeiro confirmado impede publicação automática.'},
  ],[{title:'Meta: campos da conta de anúncios',url:'https://developers.facebook.com/docs/graph-api/reference/ad-account/'}],'2026-11-18'),
  document('assinatura-e-franquia','Assinatura, franquia e créditos de criação',[
    {id:'oferta',keywords:['plano','growth','escala','assinar','assinatura','adicional','preco','valor','custo','quanto','149'],
      content:'Anúncios com IA é um adicional por loja elegível no Growth e no Escala. Consulte a oferta vigente e o contrato aceito para preço, período e condições; o assistente não pode alterar esses valores. Uma assinatura ou retorno do checkout só libera acesso depois do pagamento confirmado pelo servidor.'},
    {id:'imagens',keywords:['franquia','limite','imagens','creditos','30','extras','pacote','renovacao','carrossel'],
      content:'A oferta desta versão inclui até 30 novas imagens utilizáveis por período mensal pago. Cada imagem nova de carrossel consome um crédito. Reutilizar uma mídia salva não consome outra geração. Extras são opcionais e exigem compra expressa. A IA não compra extras sozinha. A franquia e o saldo atuais devem ser consultados na sua loja.'},
  ]),
  document('catalogo-e-produtos','Escolher produtos e objetivos',[
    {id:'selecao',keywords:['catalogo','produto','produtos','selecionar','escolher','estoque','variante','sku','preco'],
      content:'Você pode escolher produtos do catálogo ou pedir uma sugestão. O assistente consulta produtos, variantes, imagens, preço e estoque reais da sua loja. Produto indisponível ou alterado pode exigir nova revisão antes de gerar ou executar a campanha. O texto do chat não altera preço, estoque ou desconto cadastrado.'},
    {id:'objetivo',keywords:['objetivo','prioridade','vendas','compras','roas','margem','contribuicao','whatsapp','loja','destino'],
      content:'Escolha por campanha a prioridade: vendas pagas, custo por compra, ROAS ou contribuição após mídia. O destino pode ser a loja ou o WhatsApp. Uma conversa iniciada no WhatsApp não equivale a uma compra paga. A contribuição exige cobertura de custos confiável; o assistente deve avisar quando não houver dados suficientes.'},
  ]),
  document('criativos','Criar imagens, carrosséis e textos',[
    {id:'geracao',keywords:['criativo','criativos','imagem','imagens','arte','carrossel','anuncio','gerar','texto'],
      content:'O agente usa as imagens e os dados canônicos do produto para preparar textos, imagens e carrosséis. Os criativos precisam preservar aparência, preço e condições comerciais verificáveis. A IA não pode inventar cupom, frete grátis, desconto, estoque, parcelamento ou benefício não autorizado.'},
    {id:'preparo',keywords:['preparo','preparacao','interno','motor','desligado','permissao','pronta'],
      content:'Com o briefing completo, o motor inicia o preparo interno de textos e criativos na Zyon, dentro da franquia autorizada. As imagens precisam ser verificadas antes de a campanha ficar pronta para aprovação. Quando o motor estiver desligado, faltar permissão ou crédito, o rascunho é preservado com o motivo. Confira esse impedimento no painel para retomar. Imagens verificadas já salvas podem ser reutilizadas; extras dependem de contratação expressa.'},
    {id:'resultado',keywords:['reserva','consumo','falha','desconhecido','cobrado','duplicado','reutilizar'],
      content:'A geração reserva créditos antes de começar. O sistema concilia o resultado e o consumo antes de liberar ou concluir a reserva. Se a chamada ficar com resultado desconhecido, não é seguro reenviar como nova geração. Consulte o estado da operação; reutilizar uma mídia já verificada continua sendo um caminho sem nova criação.'},
  ]),
  document('aprovacao-e-automatico','Aprovação manual e modo automático',[
    {id:'manual',keywords:['aprovar','aprovacao','manual','revisar','aceitar','proposta','antes','depois'],
      content:'Toda campanha nova exige aprovação administrativa, inclusive com otimização automática habilitada. Revise produtos, imagens e ordem do carrossel, textos, destino, objetivo, público, datas e teto de gasto. Use Aprovar e publicar uma única vez para autorizar essa versão exata. Se os dados mudarem, será necessária nova revisão. Na otimização manual, cada alteração proposta também aguarda seu aceite no painel.'},
    {id:'automatico',keywords:['automatico','autonomia','autorizar','teto','limites','politica','redistribuir','escalar'],
      content:'As otimizações automáticas atuam em campanhas já aprovadas administrativamente, dentro de uma política aceita com conta, escopo, ações, tetos e validade. A IA pode pausar, trocar criativos e redistribuir orçamento das campanhas que gerencia dentro desses limites. O motor pode preparar novas propostas; toda campanha nova aguarda a aprovação inicial. A IA não eleva tetos, não compra extras e não assume campanhas externas. Controle de orçamento insuficiente impede a ação automática.'},
    {id:'revogar',keywords:['revogar','cancelar','parar','pausar','desativar','voltar','manual'],
      content:'Use Voltar para aprovação manual para revogar a política de novas escritas. Ações já enviadas precisam ser conciliadas e não podem ser prometidas como desfeitas. A mudança de modo de anúncios não habilita ou desabilita regras autônomas do checkout.'},
    {id:'avisos',keywords:['aviso','notificacao','contato','administrativo','whatsapp','pronta','modelo'],
      content:'Quando a campanha ficar pronta, o painel recebe um aviso de aprovação pendente. Para receber também pelo WhatsApp conectado da loja, cadastre o contato administrativo nas Configurações e autorize o recebimento. O destinatário deve ser diferente do número remetente. O envio usa um modelo aprovado pela Meta e elegível na conexão da própria loja. O link abre a revisão no painel autenticado da loja; o aceite ocorre em Aprovar e publicar.'},
    {id:'entrega',keywords:['aceito','entregue','recibo','confirmacao','mensagem'],
      content:'Aceito significa que a Meta recebeu o aviso; entregue depende da confirmação de entrega. Se o resultado do envio estiver incerto, a plataforma preserva a mesma tentativa para verificar o que ocorreu. Aviso impedido, falha ou resultado desconhecido do WhatsApp não removem o aviso no painel. Confira o contato, a conexão e o modelo indicado pelo impedimento. O recebimento de uma mensagem não aprova a campanha.'},
  ],[{title:'Meta: modelos de mensagem e status de aprovação',url:'https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview/'}]),
  document('publicacao','Preparar, publicar e acompanhar veiculação',[
    {id:'estados',keywords:['publicar','publicacao','veicular','veiculacao','ativo','pausado','rascunho','revisao','preparar'],
      content:'O preparo interno organiza textos e imagens na Zyon para revisão. Após Aprovar e publicar, a plataforma monta a estrutura pausada na Meta, confere os dados e solicita a ativação com a mesma aprovação. A Meta pode aplicar sua revisão e verificações próprias. O painel mostra o progresso e os objetos já criados. Enviado, em processamento ou ativo sem confirmação não comprovam veiculação ou vendas.'},
    {id:'orcamento',keywords:['orcamento','diario','total','periodo','dias','100','sete','data','inicio','fim'],
      content:'Informe o valor em reais, se ele é por dia ou para todo o período e as datas de início e fim. R$ 100 no total por sete dias é diferente de R$ 100 por dia. O assistente consulta o instante atual e o fuso da conta para interpretar datas relativas e esclarece valores ou datas ambíguos. O teto autorizado não é um depósito, saldo de conta ou prova de gasto já realizado.'},
  ],[{title:'Meta: orçamento e estado de campanhas',url:'https://developers.facebook.com/docs/graph-api/reference/adcampaigngroup/'}]),
  document('metricas','Métricas e análise diária',[
    {id:'rotina',keywords:['metricas','diaria','meia','noite','relatorio','fuso','dia','atualizacao','ontem'],
      content:'À meia-noite no fuso da conta de anúncios, o sistema inicia a análise do dia encerrado. O relatório mostra período, fuso e horário da coleta. A Meta pode atualizar números depois; dados ausentes ou uma coleta parcial devem ser indicados, sem preencher zeros como se estivessem confirmados.'},
    {id:'interpretacao',keywords:['roas','cpa','resultado','funciona','melhor','vencedor','receita','conversao','venda','retorno','otimizar'],
      content:'Gasto de mídia, receita atribuída pela Meta, compras conciliadas e conversas são medidas diferentes. A análise considera prioridade, janela, amostra e cobertura. Dados insuficientes não provam que um anúncio venceu ou fracassou. A IA pode propor ou executar uma otimização autorizada quando houver evidência suficiente, sem garantir vendas, lucro ou incremento causal.'},
  ]),
  document('erros-e-recuperacao','Resolver bloqueios e resultados desconhecidos',[
    {id:'bloqueio',keywords:['erro','bloqueado','nao','funciona','permissao','token','aplicativo','desenvolvimento','pagamento'],
      content:'O próximo passo depende do bloqueio confirmado: conexão/permissão exige revisar o acesso; falta de método ou pendência financeira exige conferir pagamentos na Meta; aplicativo incorreto exige usar a conexão Zyon. Uma orientação geral não comprova que o problema específico da sua conta já foi resolvido.'},
    {id:'incerto',keywords:['timeout','demora','desconhecido','falhou','repetir','tentar','conciliar','duplicar'],
      content:'Se a resposta se perder após o envio, o resultado pode ser desconhecido. O sistema mantém a identidade e a reserva e busca confirmação antes de reenviar. Consultar histórico ou estado é diferente de criar outra campanha. O chat deve explicar o que foi confirmado, o que continua pendente e qual ação segura está disponível.'},
  ]),
];
