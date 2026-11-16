import type {AssistantKnowledgeDocument} from '../../domain/knowledge.port.js';

const source=(id:string)=>`/?tab=meta-ads-agent&help=${encodeURIComponent(id)}`;
function document(id:string,title:string,sections:AssistantKnowledgeDocument['sections'],externalSources:AssistantKnowledgeDocument['externalSources']=[]):AssistantKnowledgeDocument{
  return {id,title,version:'2026-11-16.1',context:'meta_ads',audience:'merchant',published:true,
    reviewedAt:'2026-11-16',validFrom:'2026-11-16T00:00:00Z',validUntil:null,url:source(id),sections,externalSources};
}

/** Curated product guidance. Account facts and offer amounts must come from live scoped tools. */
export const META_ADS_MERCHANT_KNOWLEDGE:readonly AssistantKnowledgeDocument[]=[
  document('conexao-meta','Conectar a conta certa da Meta',[
    {id:'conta',keywords:['conectar','conexao','conta','facebook','instagram','oauth','permissao','pagina','aplicativo','zyon'],
      content:'Use Conectar Meta e autorize o aplicativo da Zyon com os ativos da sua loja. Selecione a conta de anúncios e a Página corretas. Catálogo, dataset e WhatsApp dependem do destino escolhido e das permissões efetivas. O nome de uma conta não comprova permissão para publicar.'},
    {id:'acesso',keywords:['token','senha','credencial','expirado','reconectar','desconectar','acesso'],
      content:'Não envie senha, token ou dados de cartão no chat. A conexão é feita no fluxo oficial da Meta. Permissão revogada, token expirado ou troca de conta podem exigir reconexão e invalidam autorizações anteriores. Desconectar interrompe novas ações do agente e não comprova que anúncios já ativos foram pausados.'},
  ]),
  document('verba-e-pagamentos','Verba e pagamentos dos anúncios',[
    {id:'separacao',keywords:['verba','pagar','pago','pagamento','mensalidade','investimento','dinheiro','anuncios','pix'],
      content:'Sua assinatura da Zyon não inclui o investimento dos anúncios. Esse valor é pago diretamente à Meta. A Zyon ajuda a preparar e gerenciar campanhas; o orçamento de mídia é separado do plano, do adicional e dos créditos de criação de imagens.'},
    {id:'tipo',keywords:['fundos','saldo','pre','pos','prepago','pospago','cartao','recarga','cobranca','divida'],
      content:'Uma conta pré-paga precisa de fundos para veicular. Uma conta pós-paga usa seu fluxo de cobrança e método de pagamento. Se a consulta autorizada não identificar o tipo ou a situação, confirme os pagamentos na Meta. O campo balance da API representa valor devido e não saldo de fundos disponível.'},
    {id:'botao',keywords:['adicionar','depositar','carregar','credito','pagamentos','verificar','atualizar','bloqueio'],
      content:'Abrir pagamentos na Meta leva ao ambiente oficial para a conta conectada. A Zyon não recebe Pix ou cartão de mídia nesta versão. Depois de conferir ou pagar na Meta, use Verificar novamente. Clicar ou retornar não confirma crédito; somente uma nova leitura autorizada pode atualizar o diagnóstico. Bloqueio financeiro confirmado impede publicação automática.'},
  ],[{title:'Meta: campos da conta de anúncios',url:'https://developers.facebook.com/docs/graph-api/reference/ad-account/'}]),
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
    {id:'resultado',keywords:['reserva','consumo','falha','desconhecido','cobrado','duplicado','reutilizar'],
      content:'A geração reserva créditos antes de começar. O sistema concilia o resultado e o consumo antes de liberar ou concluir a reserva. Se a chamada ficar com resultado desconhecido, não é seguro reenviar como nova geração. Consulte o estado da operação; reutilizar uma mídia já verificada continua sendo um caminho sem nova criação.'},
  ]),
  document('aprovacao-e-automatico','Aprovação manual e modo automático',[
    {id:'manual',keywords:['aprovar','aprovacao','manual','revisar','aceitar','proposta','antes','depois'],
      content:'O modo padrão é manual. Cada alteração externa precisa da aprovação da proposta exata, com produtos, valores e objetos revisados. Preparar a campanha, aprovar sua publicação e confirmar a veiculação são etapas distintas. Uma mensagem genérica no chat não autoriza um aumento de verba ou outra versão da proposta.'},
    {id:'automatico',keywords:['automatico','autonomia','autorizar','teto','limites','politica','redistribuir','escalar'],
      content:'O automático exige aceite explícito de uma política com conta, escopo, ações, tetos e validade. Dentro dela a IA pode criar, publicar, pausar, trocar criativos e redistribuir orçamento das campanhas que gerencia. Ela não eleva tetos, não compra extras e não assume campanhas externas. Se não houver controle remoto de orçamento suficiente, a publicação automática fica bloqueada para revisão.'},
    {id:'revogar',keywords:['revogar','cancelar','parar','pausar','desativar','voltar','manual'],
      content:'Use Voltar para aprovação manual para revogar a política de novas escritas. Ações já enviadas precisam ser conciliadas e não podem ser prometidas como desfeitas. A mudança de modo de anúncios não habilita ou desabilita regras autônomas do checkout.'},
  ]),
  document('publicacao','Preparar, publicar e acompanhar veiculação',[
    {id:'estados',keywords:['publicar','publicacao','veicular','veiculacao','ativo','pausado','rascunho','revisao','preparar'],
      content:'A preparação cria estrutura em rascunho ou pausada. Publicar envia a solicitação à Meta, que pode aplicar revisão e verificações próprias. Enviado, em processamento e ativo sem confirmação não significam veiculação comprovada. O painel deve apresentar o estado recebido da Meta e os objetos que já foram criados.'},
    {id:'orcamento',keywords:['orcamento','diario','total','periodo','dias','100','sete','data','inicio','fim'],
      content:'Informe o valor em reais, se ele é por dia ou para todo o período e as datas de início e fim. R$ 100 no total por sete dias é diferente de R$ 100 por dia. O assistente deve esclarecer valores ou datas ambíguos. O teto autorizado não é um depósito, saldo de conta ou prova de gasto já realizado.'},
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
