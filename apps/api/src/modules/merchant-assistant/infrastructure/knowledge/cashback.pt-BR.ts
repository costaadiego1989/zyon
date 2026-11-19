import type {AssistantKnowledgeDocument} from '../../domain/knowledge.port.js';
import type {MerchantGuideSource,MerchantGuideSourcesPort} from '../../../graph-rag/domain/merchant-guide-sources.port.js';

function document(topic:string,title:string,keywords:readonly string[],content:string):AssistantKnowledgeDocument{
  const id=`cashback-${topic}`;
  return {id,title,version:'2026-11-18.1',context:'cashback',audience:'merchant',published:true,reviewedAt:'2026-11-18',
    validFrom:'2026-11-18T00:00:00Z',validUntil:null,url:`/?tab=cashback&help=${id}`,externalSources:[],
    sections:[{id:topic,keywords,content}]};
}

/** Reviewed product rules from the approved cashback specification. Store amounts
 * and publication state must always come from an authorized canonical read. */
export const CASHBACK_MERCHANT_KNOWLEDGE:readonly AssistantKnowledgeDocument[]=[
  document('ganhos','Como o cliente ganha cashback',['ganho','ganhos','ganhar','percentual','taxa','mínimo','pedido','produtos','planos'],
    'Cashback é crédito para uma compra futura na mesma loja, conforme as regras publicadas pelo lojista. O módulo atende produtos físicos, serviços, produtos digitais e comida, em todos os planos. O percentual de ganho, o mínimo de compra, o máximo por pedido e o limite mensal por cliente são decisões explícitas do lojista. O assistente consulta a configuração canônica para informar os valores da sua loja; uma explicação ou exemplo não preenche esses campos. O programa começa desligado e precisa de revisão e publicação para novos ganhos.'),
  document('liberacao','Quando o crédito fica disponível',['liberação','liberar','pendente','disponível','pagamento','entrega','prazo'],
    'O crédito pendente ainda não está disponível para uso. A regra publicada determina o evento de liberação, como pagamento confirmado ou pedido concluído, e a espera escolhida pelo lojista. Consulte a configuração canônica para saber o gatilho e o prazo da sua loja. O assistente não deve prometer liberação imediata nem inventar um prazo. Saldo reservado já está comprometido em uma compra em andamento e não equivale ao saldo disponível.'),
  document('validade','Validade dos créditos',['validade','vencimento','vencer','expirar','expiração','dias'],
    'O lojista escolhe explicitamente a validade do crédito ou a opção sem expiração, quando permitida pela configuração. A regra publicada e os lotes da carteira determinam o vencimento real. Não deduza uma data de validade sem consultar os dados canônicos. Alterar um rascunho não reescreve créditos já concedidos nem comprova que uma nova regra foi publicada. Informe as condições no regulamento para que o cliente conheça a validade aplicável.'),
  document('uso','Como usar o cashback',['uso','usar','utilizar','resgate','resgatar','mínimo','compra','desconto'],
    'O cliente usa o saldo disponível como crédito em uma compra futura na mesma loja, de acordo com a regra publicada e a cotação canônica do checkout. O mínimo do pedido, o percentual máximo de uso e o limite em dinheiro dependem das escolhas do lojista. Ter saldo não garante que todo o saldo será usado naquele pedido. Reserva e uso confirmado são etapas diferentes; o chat não movimenta a carteira nem confirma um pagamento.'),
  document('cupons','Cashback junto com cupons',['cupom','cupons','combinar','combinação','benefícios','permitir'],
    'Combinar cashback com cupons depende de uma decisão explícita do lojista nas regras de combinação publicadas. Não presuma que todo cupom é cumulativo. A configuração e a cotação atual do checkout determinam se a combinação é permitida e qual teto se aplica. Permitir cupons não elimina os demais limites. O assistente pode explicar e montar um rascunho com a escolha informada; a publicação exige revisão e o gesto Publicar e ativar no formulário.'),
  document('regras-avancadas','Cashback junto com regras avançadas',['regra','regras','avançadas','automático','descontos','combinação'],
    'A combinação de cashback com descontos de regras avançadas é uma escolha independente da permissão para cupons. Consulte as permissões publicadas e a cotação canônica para o pedido. A autorização de uma combinação não autoriza a outra e não aumenta nenhum teto de desconto. Uma resposta ambígua deve ser esclarecida antes de salvar o rascunho. O chat de cashback não habilita regras autônomas do checkout e não altera campanhas ou políticas de anúncios.'),
  document('tetos','Limites de desconto e orçamento',['teto','tetos','limite','limites','orçamento','mensal','geral','específico'],
    'O lojista escolhe se a combinação respeita o teto geral da loja ou um teto específico de cashback, com limites percentuais e em dinheiro quando aplicáveis. Esses tetos são diferentes dos limites de ganho, de uso por pedido e do orçamento mensal para novos créditos. Consulte as escolhas publicadas e o limite geral canônico; não trate um campo ausente como ilimitado nem preencha um valor sugerido. O orçamento mostrado no painel pertence ao mês corrente de Brasília, independentemente do período de movimentações selecionado.'),
  document('carteira','Uma carteira no site e no WhatsApp',['carteira','saldo','compartilhado','site','whatsapp','conta','mesma'],
    'Na mesma loja, o cliente usa a mesma conta e a mesma carteira no site e no WhatsApp. As regras publicadas da loja se aplicam aos dois canais. A identidade canônica do cliente e a loja definem o saldo; o canal de atendimento não cria uma segunda carteira. Créditos de outra loja não se misturam. Consulte os valores canônicos para informar saldo pendente, disponível ou reservado e seu instante de leitura. Esta ajuda não concede autoridade para transferir saldo ou executar ajustes financeiros pelo chat.'),
  document('pausa','Pausar novos ganhos e revisar a configuração',['pausa','pausar','encerrar','desativar','ativar','publicar','rascunho','regulamento'],
    'Pausar ou encerrar novos ganhos preserva os créditos já concedidos, que continuam sendo honrados conforme as regras aplicáveis. O lojista revisa o regulamento e usa a confirmação específica no painel para mudar o estado do programa. O assistente orienta e salva apenas escolhas explícitas no rascunho; pedir para ativar no chat não publica o programa. Revise o snapshot persistido no formulário e confirme Publicar e ativar. Se o rascunho mudar depois da revisão, carregue e revise novamente antes de publicar.'),
];

export function cashbackGuideSource(merchantId:string,doc:AssistantKnowledgeDocument):MerchantGuideSource{
  const revision=/^(\d{4}-\d{2}-\d{2})\.(\d{1,5})$/.exec(doc.version);
  if(!revision||doc.context!=='cashback'||doc.audience!=='merchant')throw Error('cashback_guide_version_invalid');
  return {kind:'merchant_help',merchantId,audience:'merchant',context:'cashback',sourceType:'merchant_guide',id:doc.id,
    version:Date.parse(`${revision[1]}T00:00:00Z`)+Number(revision[2]),active:doc.published,
    chunks:doc.sections.map(section=>({id:section.id,content:section.content}))};
}
export const cashbackMerchantGuideSources:MerchantGuideSourcesPort={
  async listMerchantGuides(merchantId){return CASHBACK_MERCHANT_KNOWLEDGE.map(doc=>cashbackGuideSource(merchantId,doc));},
};
