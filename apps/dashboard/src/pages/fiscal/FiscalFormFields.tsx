import React, { useId } from "react";
import { FormField as Field, FormSelect as Select, FormTextarea as Textarea,
  type FormFieldProps, type FormSelectProps, type FormTextareaProps } from "../../components/FormField.js";

const meanings: Record<string, string> = {
  "Ambiente fiscal": "Escolhe onde consultar e emitir notas. Em produção, as notas têm validade fiscal.",
  "Emissor fiscal": "Sistema que sua empresa usa para emitir a nota e obter a autorização da SEFAZ.",
  "CNPJ da empresa emitente": "Identifica a empresa que vai emitir a nota. Deve ser o mesmo CNPJ cadastrado no emissor.",
  "Conexão Bling existente": "Escolha a conta Bling da empresa que vai emitir as notas.",
  "Identificação do aplicativo Omie": "Copie o identificador da empresa no Omie, chamado app_hash. Ele indica qual empresa a integração pode acessar.",
  "Token de renovação fiscal": "Copie o refresh_token da mesma integração Omie. Ele permite renovar o acesso sem preencher tudo novamente.",
  "Token fiscal válido até": "Informe a data de vencimento do token recebido da Omie. Esta data não prolonga a autorização do ERP.",
  "Token fiscal do aplicativo Omie": "Copie o token da integração da sua empresa no Omie. Ele autoriza a Zyon a acessar os dados permitidos.",
  "Token da empresa Focus NF-e": "Chave de acesso da empresa na Focus NF-e. Use o token da empresa que emitirá as notas.",
  "Responsável pelo estoque": "Escolha quem registra a baixa do estoque para evitar descontar a mesma venda duas vezes.",
  "Responsável pelo e-mail": "Escolha quem envia a nota por e-mail ao comprador para evitar mensagens duplicadas.",
  "Responsável pelo WhatsApp": "Escolha quem envia a nota pelo WhatsApp ao comprador, respeitando a autorização e o modelo aprovado.",
  "Identificação da empresa na Focus": "Código que a Focus usa para localizar a empresa emissora. Copie do cadastro da empresa na Focus.",
  "Fuso horário fiscal": "Horário local usado para registrar a emissão. Exemplo: America/Sao_Paulo para o horário de Brasília.",
  "Nome do cabeçalho do webhook Focus": "Nome do campo de segurança que acompanha os avisos da Focus. Use o mesmo nome configurado no provedor.",
  "Segredo do webhook Focus": "Senha usada para confirmar que os avisos vieram da Focus. Cadastre o mesmo valor nos dois sistemas.",
  "Revisão da configuração fiscal ERP": "Nome para identificar a versão das regras conferidas no ERP. Ao mudar as regras, salve e confirme uma nova revisão.",
  "Regime tributário": "Forma de tributação da sua empresa. Confirme a opção correta com a contabilidade.",
  "Natureza da operação": "Descrição da operação na nota, como venda de mercadoria. Use a descrição aprovada pela contabilidade.",
  "Tipo do documento": "Indica se a nota registra entrada ou saída de mercadorias. Use o código orientado pela contabilidade.",
  "Finalidade da emissão": "Motivo da nota, como emissão normal, complemento ou devolução. Use o código correto para a operação.",
  "Destino da operação": "Indica se a venda acontece dentro do estado, para outro estado ou para o exterior.",
  "Indicador de consumidor final": "Informa se o comprador vai usar o produto ou revendê-lo. Confirme o código com a contabilidade.",
  "Presença do comprador": "Indica como a compra foi feita, por exemplo, pela internet. Use o código fiscal da operação.",
  "Modalidade do frete": "Indica quem paga ou contrata o transporte. Use a opção fiscal correspondente ao frete da venda.",
  "Frete por conta": "Indica quem é responsável pelo transporte na nota. Confirme o código usado no Bling.",
  "Indicador de inscrição estadual": "Indica a situação do comprador em relação à inscrição estadual. Use a classificação conferida pela contabilidade.",
  "Código da loja no Bling": "Identifica a loja ou canal da venda dentro do Bling. Copie o código cadastrado no ERP.",
  "Código do regime tributário": "Código fiscal do regime da empresa no Bling. Copie o valor confirmado pela contabilidade.",
  "Código de cupom fiscal": "Identificador de cupom usado na configuração do Bling. Confira com o responsável se a operação exige esse campo.",
  "Etapa do pedido": "Fase em que o pedido será criado no Omie. Escolha a etapa configurada para suas vendas.",
  "Código da parcela": "Condição de pagamento do Omie, como à vista ou parcelado. Copie o código cadastrado no ERP.",
  "Código do cenário de impostos": "Conjunto de regras de impostos já preparado no Omie. Confirme o código com a contabilidade.",
  "Código da categoria": "Categoria financeira que organiza a venda no Omie. Copie o código da categoria no ERP.",
  "Código da conta corrente": "Conta bancária ou caixa usado no registro financeiro do Omie. Copie o código cadastrado no ERP.",
  "Contribuinte": "Informa se o comprador é contribuinte do ICMS. Confirme a opção com a contabilidade.",
  "Indicador de intermediário": "Informa se a venda teve um intermediário. Use a classificação fiscal indicada para a operação.",
  "CNPJ do intermediário (quando aplicável)": "Preencha somente se houver um intermediário na venda, com o CNPJ informado por ele.",
  "Identificação do intermediário (quando aplicável)": "Código que identifica sua conta no intermediário, quando a operação exigir essa informação.",
  "Fuso horário da operação": "Horário local usado nas datas da venda enviadas ao ERP. Exemplo: America/Sao_Paulo.",
  "Código da natureza de operação": "Identifica as regras fiscais da venda no Tiny/Olist. Copie o código da natureza preparada no ERP.",
  "Código do e-commerce": "Identifica a sua loja virtual dentro do Tiny/Olist. Copie o código cadastrado no ERP.",
  "Consumidor final": "Indique se o comprador vai usar o produto, em vez de revendê-lo.",
  "Nome do país no ERP": "Nome do país conforme o cadastro do Tiny/Olist, para que o endereço seja reconhecido.",
  "SKU do produto": "Código que identifica o produto no catálogo da Zyon. Ele deve corresponder ao produto vendido.",
  "NCM": "Classifica o tipo de mercadoria na nota. Copie o código de 8 dígitos do cadastro fiscal do produto.",
  "CFOP": "Identifica a operação fiscal da venda, como venda dentro ou fora do estado. Use o código indicado pela contabilidade.",
  "Origem da mercadoria": "Indica se a mercadoria é nacional ou importada. Copie o código do cadastro fiscal do produto.",
  "Unidade comercial": "Como o produto é vendido na nota. Exemplos: UN para unidade e KG para quilo.",
  "Código do produto no ERP": "Número que identifica este mesmo produto no ERP. Ele conecta o item vendido ao cadastro fiscal correto.",
  "Código da natureza do produto no Bling": "Regra fiscal que o Bling deve aplicar a este produto. Copie o código conferido no ERP.",
  "Revisar esta confirmação até": "Data limite para conferir novamente as regras do ERP. Depois dela, será necessário renovar esta confirmação.",
  "Certificado válido até": "Data de vencimento do certificado digital cadastrado no ERP. Consulte essa data no painel do emissor.",
  "Pagamento de referência": "Escolha um pagamento original para conferir como ele deve ser informado na nota. O comprovante não é alterado aqui.",
  "Ambiente da conta de pagamento": "Indica se o pagamento é real ou de teste. Deve corresponder à conta que recebeu o valor.",
  "CNPJ da credenciadora (quando exigido)": "CNPJ da empresa que processou o cartão, quando exigido na nota. Consulte o provedor de pagamento.",
  "Fuso horário do pagamento (quando exigido)": "Horário local usado na confirmação do pagamento, quando essa informação for exigida.",
  "Descrição fiscal de cripto (quando aplicável)": "Descrição da forma de pagamento em cripto que deve aparecer na nota. Confirme o texto com a contabilidade.",
  "Assunto do e-mail fiscal": "Título do e-mail que o comprador recebe com o acesso à nota. Os campos entre chaves são preenchidos pela Zyon.",
  "Mensagem do e-mail fiscal": "Texto enviado ao comprador com o link da nota. Preserve os campos entre chaves que deseja preencher automaticamente.",
  "Modelo fiscal do WhatsApp": "Mensagem usada para avisar o comprador sobre a nota. O envio depende da aprovação do modelo e da autorização do cliente.",
  "URL de redirecionamento do aplicativo": "Copie este endereço para a configuração de redirecionamento do aplicativo Tiny/Olist. Ele permite voltar à Zyon após autorizar.",
  "Identificação do aplicativo Tiny/Olist": "Copie o Client ID gerado no aplicativo da sua empresa no Tiny/Olist.",
  "Segredo do aplicativo Tiny/Olist": "Copie o Client Secret do mesmo aplicativo. Essa chave protege a conexão e deve permanecer em segredo.",
  "URL privada de notificação Tiny/Olist": "Endereço que recebe os avisos de atualização das notas. Copie para a configuração de Webhooks do Tiny/Olist.",
  "Estado fiscal": "Filtra as notas pela situação da emissão, como autorizada, em processamento ou com pendência.",
  "Buscar pedido ou destinatário": "Digite o pedido ou o nome do comprador para encontrar a nota correspondente.",
  "Justificativa do cancelamento fiscal": "Explique por que a nota deve ser cancelada. O emissor analisará a solicitação conforme as regras fiscais.",
};

export function fiscalFieldMeaning(label: string): string | undefined {
  if (meanings[label]) return meanings[label];
  if (/^Tributo \d+ do produto \d+$/.test(label)) return "Escolha qual imposto ou situação tributária será informado para este produto. Use a configuração revisada pela contabilidade.";
  if (/^Valor do tributo \d+ do produto \d+$/.test(label)) return "Valor ou código do imposto selecionado. Copie o dado conferido pela contabilidade, sem estimar alíquotas.";
  if (/^Tipo do valor \d+ do produto \d+$/.test(label)) return "Use Código / texto para classificações que preservam zeros e Número / alíquota para valores numéricos.";
  if (/^Código fiscal do pagamento \d+$/.test(label)) return "Forma de pagamento que aparece na nota, como Pix, cartão ou boleto. Relacione à forma usada na venda.";
  if (/^Código da forma de pagamento no ERP \d+$/.test(label)) return "Código da forma de pagamento cadastrada no ERP para esta opção fiscal.";
  if (/^Código da forma de recebimento Olist \d+$/.test(label)) return "Código da forma de recebimento no Tiny/Olist, que indica como o dinheiro entra no ERP.";
  return undefined;
}
function hintFor(label: string, extra?: string) {
  const meaning = fiscalFieldMeaning(label);
  return meaning && extra && extra !== meaning ? `${meaning} ${extra}` : meaning ?? extra;
}
export const FormField = (props: FormFieldProps) => <div className="fiscal-form-field"><Field {...props} hint={hintFor(props.label, props.hint)} /></div>;
export const FormSelect = (props: FormSelectProps) => <div className="fiscal-form-field"><Select {...props} hint={hintFor(props.label, props.hint)} /></div>;
export const FormTextarea = (props: FormTextareaProps) => <div className="fiscal-form-field"><Textarea {...props} hint={hintFor(props.label, props.hint)} /></div>;

export const fiscalEffectLabels: Record<string, string> = {
  stockOnSave: "Baixa estoque ao salvar pedido", stockOnAuthorize: "Baixa estoque ao autorizar nota", stockOnCancel: "Estorna estoque ao cancelar nota",
  accountsOnSave: "Gera financeiro ao salvar pedido", accountsOnAuthorize: "Gera financeiro ao autorizar nota", accountsOnCancel: "Estorna financeiro ao cancelar nota",
  automaticEmail: "ERP envia e-mail automaticamente", automaticInvoiceGeneration: "ERP gera nota automaticamente", automaticInvoiceAuthorization: "ERP autoriza nota automaticamente",
};
export const fiscalEffectHints: Record<string, string> = {
  stockOnSave: "Marque se o ERP já desconta os produtos quando o pedido é salvo.",
  stockOnAuthorize: "Marque se o ERP desconta os produtos quando a nota é autorizada.",
  stockOnCancel: "Marque se o ERP devolve os produtos ao estoque quando a nota é cancelada.",
  accountsOnSave: "Marque se salvar o pedido já cria o lançamento de recebimento no ERP.",
  accountsOnAuthorize: "Marque se autorizar a nota cria o lançamento de recebimento no ERP.",
  accountsOnCancel: "Marque se cancelar a nota desfaz o lançamento financeiro no ERP.",
  automaticEmail: "Marque se o próprio ERP já envia a nota por e-mail ao comprador.",
  automaticInvoiceGeneration: "Marque se o ERP já cria a nota a partir do pedido, sem um novo comando da Zyon.",
  automaticInvoiceAuthorization: "Marque se o ERP já envia a nota criada para autorização na SEFAZ automaticamente.",
};

export function FiscalCheckbox({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return <div className="fiscal-check-field"><label className="fiscal-check" htmlFor={id}><input id={id} type="checkbox" checked={checked} aria-describedby={id + "-help"} onChange={e => onChange(e.target.checked)} />{label}</label><span id={id + "-help"} className="form-field-hint">{hint}</span></div>;
}
